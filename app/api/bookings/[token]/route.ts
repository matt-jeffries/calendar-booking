import { env } from "cloudflare:workers";
import { addMinutes, bookingByToken, hasConflict, slotStarts, validateSlot, type BookingRow } from "@/lib/booking-server";
import { cancelGoogleMeeting, updateGoogleMeeting } from "@/lib/google-calendar";
import { cancelMicrosoftMeeting, updateMicrosoftMeeting } from "@/lib/microsoft-calendar";
import { blocksSlot, bufferedRange, calendarBusyTimes, isBookingEvent } from "@/lib/calendar-availability";
import { enforceRateLimit, readJsonBody, requireSameOrigin } from "@/lib/http-security";
import { ukLocalToUtcIso } from "@/lib/client-time";
import { getBookingConfig } from "@/lib/runtime-config";

function publicBooking(booking: BookingRow) {
  return {
    name: booking.name,
    start_local: booking.start_local,
    end_local: booking.end_local,
    duration_minutes: booking.duration_minutes,
    status: booking.status,
    meeting_url: booking.meeting_url,
  };
}

async function acquireMutationLock(bookingId: string) {
  if (!env.DB) return null;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 120;
  const lock = await env.DB.prepare(`INSERT INTO booking_mutation_locks (booking_id, expires_at)
    VALUES (?1, ?2)
    ON CONFLICT(booking_id) DO UPDATE SET expires_at = excluded.expires_at
    WHERE booking_mutation_locks.expires_at < ?3
    RETURNING expires_at`)
    .bind(bookingId, expiresAt, now).first<{ expires_at: number }>();
  return lock?.expires_at ?? null;
}

async function releaseMutationLock(bookingId: string, expiresAt: number) {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM booking_mutation_locks WHERE booking_id = ?1 AND expires_at = ?2").bind(bookingId, expiresAt).run();
}

async function releaseSlots(bookingId: string, slots: string[]) {
  if (!env.DB || !slots.length) return;
  await env.DB.batch(slots.map((slot) => env.DB.prepare("DELETE FROM booking_slot_locks WHERE slot_start_local = ?1 AND booking_id = ?2").bind(slot, bookingId)));
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!env.DB) return Response.json({ error: "Bookings are temporarily unavailable. Try again later." }, { status: 503 });
  const limited = await enforceRateLimit(request, "manage-read", 120, 10 * 60);
  if (limited) return limited;
  const booking = await bookingByToken((await context.params).token);
  if (!booking) return Response.json({ error: "This booking link is not valid." }, { status: 404 });
  return Response.json({ booking: publicBooking(booking) }, { headers: { "cache-control": "private, no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ token: string }> }) {
  const bookingConfig = getBookingConfig();
  if (!env.DB) return Response.json({ error: "Bookings are temporarily unavailable. Try again later." }, { status: 503 });
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Send booking changes as JSON." }, { status: 415 });
  }
  const limited = await enforceRateLimit(request, "manage-change", 12, 60 * 60);
  if (limited) return limited;
  const { token } = await context.params;
  const booking = await bookingByToken(token);
  if (!booking) return Response.json({ error: "This booking link is not valid." }, { status: 404 });

  let value: unknown;
  try { value = await readJsonBody(request, 2_048); }
  catch (error) { return Response.json({ error: error instanceof RangeError ? "That request is too large." : "Choose cancel or reschedule." }, { status: error instanceof RangeError ? 413 : 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return Response.json({ error: "Choose cancel or reschedule." }, { status: 400 });
  const body = value as Record<string, unknown>;
  const action = body.action;
  const startLocal = typeof body.startLocal === "string" ? body.startLocal : "";
  if (action !== "cancel" && action !== "reschedule") return Response.json({ error: "Choose cancel or reschedule." }, { status: 400 });
  if (action === "reschedule" && !startLocal) return Response.json({ error: "Choose a new meeting time." }, { status: 400 });
  if (action === "reschedule" && startLocal === booking.start_local) return Response.json({ error: "Choose a different meeting time." }, { status: 400 });
  if (booking.status === "cancelled") return Response.json({ booking: publicBooking(booking) });
  const mutationLease = await acquireMutationLock(booking.id);
  if (!mutationLease) return Response.json({ error: "This meeting is already being updated. Wait a moment and try again." }, { status: 409 });

  const manageUrl = `${bookingConfig.publicOrigin}/manage/${token}`;
  try {
    if (action === "cancel") {
      try {
        if (booking.calendar_provider === "microsoft") await cancelMicrosoftMeeting(booking.calendar_event_id);
      } catch {
        return Response.json({ error: "We couldn’t update the calendar. Try again." }, { status: 502 });
      }
      let integrationStatus = "connected";
      try { await cancelGoogleMeeting(booking.video_event_id); }
      catch {
        integrationStatus = "needs_cleanup";
        console.error("Google Calendar cleanup is required", { bookingId: booking.id });
      }
      await env.DB.batch([
        env.DB.prepare("UPDATE bookings SET status = 'cancelled', integration_status = ?1, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?2").bind(integrationStatus, booking.id),
        env.DB.prepare("INSERT INTO booking_changes (booking_id, action, previous_start_local) VALUES (?1, 'cancelled', ?2)").bind(booking.id, booking.start_local),
        env.DB.prepare("DELETE FROM booking_slot_locks WHERE booking_id = ?1").bind(booking.id),
      ]);
      return Response.json({ booking: publicBooking({ ...booking, status: "cancelled" }) });
    }

    const validationError = validateSlot(startLocal, booking.duration_minutes);
    if (validationError) return Response.json({ error: validationError }, { status: 400 });
    const endLocal = addMinutes(startLocal, booking.duration_minutes);
    const checkRange = bufferedRange(startLocal, endLocal);
    try {
      const busy = await calendarBusyTimes(ukLocalToUtcIso(checkRange.start), ukLocalToUtcIso(checkRange.end), { freshApple: true });
      if (busy.some((item) => !isBookingEvent(item, booking) && blocksSlot(item, startLocal, endLocal))) {
        return Response.json({ error: "That time has just been taken. Choose another." }, { status: 409 });
      }
    } catch {
      return Response.json({ error: "We couldn’t check the calendars. Try again." }, { status: 503 });
    }
    if (await hasConflict(checkRange.start, checkRange.end, booking.id)) return Response.json({ error: "That time has just been taken. Choose another." }, { status: 409 });

    const oldSlots = slotStarts(booking.start_local, booking.end_local);
    const targetSlots = slotStarts(startLocal, endLocal);
    const addedSlots = targetSlots.filter((slot) => !oldSlots.includes(slot));
    try {
      if (addedSlots.length) {
        await env.DB.batch(addedSlots.map((slot) => env.DB.prepare("INSERT INTO booking_slot_locks (slot_start_local, booking_id) VALUES (?1, ?2)").bind(slot, booking.id)));
      }
    } catch {
      await releaseSlots(booking.id, addedSlots);
      return Response.json({ error: "That time has just been taken. Choose another." }, { status: 409 });
    }

    const updated: BookingRow = { ...booking, start_local: startLocal, end_local: endLocal };
    let googleUpdated = false;
    let integrationStatus = "connected";
    try {
      await updateMicrosoftMeeting(updated, manageUrl);
    } catch {
      await releaseSlots(booking.id, addedSlots);
      return Response.json({ error: "We couldn’t update the calendar. Try again." }, { status: 502 });
    }
    try {
      await updateGoogleMeeting(updated, manageUrl);
      googleUpdated = true;
    } catch {
      integrationStatus = "needs_cleanup";
      console.error("Google Calendar reschedule cleanup is required", { bookingId: booking.id });
    }

    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE bookings SET start_local = ?1, end_local = ?2, integration_status = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4").bind(startLocal, endLocal, integrationStatus, booking.id),
        env.DB.prepare("INSERT INTO booking_changes (booking_id, action, previous_start_local, new_start_local) VALUES (?1, 'rescheduled', ?2, ?3)").bind(booking.id, booking.start_local, startLocal),
        ...oldSlots.filter((slot) => !targetSlots.includes(slot)).map((slot) => env.DB.prepare("DELETE FROM booking_slot_locks WHERE slot_start_local = ?1 AND booking_id = ?2").bind(slot, booking.id)),
      ]);
    } catch {
      try { await updateMicrosoftMeeting(booking, manageUrl); } catch { /* Best-effort compensation. */ }
      if (googleUpdated) { try { await updateGoogleMeeting(booking, manageUrl); } catch { /* Best-effort compensation. */ } }
      await releaseSlots(booking.id, addedSlots);
      return Response.json({ error: "We couldn’t save the new time. Try again." }, { status: 502 });
    }
    return Response.json({ booking: publicBooking(updated) });
  } finally {
    await releaseMutationLock(booking.id, mutationLease);
  }
}
