import { env } from "cloudflare:workers";
import { addMinutes, hasConflict, slotStarts, tokenHash, validateSlot, type BookingRow } from "@/lib/booking-server";
import { getBookingConfig } from "@/lib/runtime-config";
import { cancelGoogleMeeting, createGoogleMeeting, googleCalendarConfigured } from "@/lib/google-calendar";
import { cancelMicrosoftMeeting, createMicrosoftMeeting } from "@/lib/microsoft-calendar";
import { calendarBusyTimes } from "@/lib/calendar-availability";
import { sendNewBookingNotification } from "@/lib/booking-notifications";
import { enforceIdentifierRateLimit, enforceRateLimit, readJsonBody, requireSameOrigin } from "@/lib/http-security";
import { ukLocalToUtcIso } from "@/lib/client-time";
import { verifyTurnstile } from "@/lib/turnstile";

async function deleteLocalBooking(bookingId: string) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM booking_changes WHERE booking_id = ?1").bind(bookingId),
    env.DB.prepare("DELETE FROM booking_slot_locks WHERE booking_id = ?1").bind(bookingId),
    env.DB.prepare("DELETE FROM bookings WHERE id = ?1").bind(bookingId),
  ]);
}

export async function POST(request: Request) {
  const bookingConfig = getBookingConfig();
  if (!env.DB) return Response.json({ error: "Bookings are temporarily unavailable. Try again later." }, { status: 503 });
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Send booking details as JSON." }, { status: 415 });
  }
  const limited = await enforceRateLimit(request, "create-booking", 8, 60 * 60);
  if (limited) return limited;
  let value: unknown;
  try { value = await readJsonBody(request); }
  catch (error) { return Response.json({ error: error instanceof RangeError ? "That request is too large." : "Add valid booking details." }, { status: error instanceof RangeError ? 413 : 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return Response.json({ error: "Add valid booking details." }, { status: 400 });
  const body = value as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const context = typeof body.context === "string" ? body.context.trim() : "";
  const startLocal = typeof body.startLocal === "string" ? body.startLocal : "";
  const duration = typeof body.duration === "number" ? body.duration : Number.NaN;
  const turnstileToken = body.turnstileToken;
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name) || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || context.length > 2000 || !startLocal) {
    return Response.json({ error: "Add a valid name, email and meeting time." }, { status: 400 });
  }
  const slotError = validateSlot(startLocal, duration);
  if (slotError) return Response.json({ error: slotError }, { status: 400 });
  const turnstileResult = await verifyTurnstile(request, turnstileToken);
  if (turnstileResult === "invalid") return Response.json({ error: "Complete the security check and try again." }, { status: 403 });
  if (turnstileResult === "unavailable") return Response.json({ error: "The security check is unavailable. Try again later." }, { status: 503 });
  const recipientLimited = await enforceIdentifierRateLimit("booking-recipient", email, 4, 24 * 60 * 60);
  if (recipientLimited) return recipientLimited;
  const globallyLimited = await enforceIdentifierRateLimit("booking-global", "all-bookings", 100, 24 * 60 * 60);
  if (globallyLimited) return globallyLimited;
  if (!await googleCalendarConfigured()) return Response.json({ error: "Online booking is not available yet. Try again later." }, { status: 503 });
  const endLocal = addMinutes(startLocal, duration);
  if (await hasConflict(startLocal, endLocal)) return Response.json({ error: "That time has just been taken. Choose another." }, { status: 409 });

  const id = crypto.randomUUID();
  const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO bookings (id, manage_token_hash, name, email, context, start_local, end_local, timezone, duration_minutes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
        .bind(id, await tokenHash(token), name, email, context, startLocal, endLocal, bookingConfig.timezone, duration),
      env.DB.prepare("INSERT INTO booking_changes (booking_id, action, new_start_local) VALUES (?1, 'created', ?2)").bind(id, startLocal),
      ...slotStarts(startLocal, endLocal).map((slot) => env.DB.prepare("INSERT INTO booking_slot_locks (slot_start_local, booking_id) VALUES (?1, ?2)").bind(slot, id)),
    ]);
  } catch {
    return Response.json({ error: "That time has just been taken. Choose another." }, { status: 409 });
  }

  try {
    const busy = await calendarBusyTimes(ukLocalToUtcIso(startLocal), ukLocalToUtcIso(endLocal), { freshApple: true });
    if (busy.some((item) => item.start.slice(0, 19) < endLocal && item.end.slice(0, 19) > startLocal)) {
      await deleteLocalBooking(id);
      return Response.json({ error: "That time has just been taken. Choose another." }, { status: 409 });
    }
  } catch {
    await deleteLocalBooking(id);
    return Response.json({ error: "We couldn’t check the calendars. Try again." }, { status: 503 });
  }

  const manageUrl = `${bookingConfig.publicOrigin}/manage/${token}`;
  let googleEventId: string | null = null;
  let microsoftEventId: string | null = null;
  let meetingUrl: string | null = null;
  let googlePersisted = false;
  try {
    const row = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?1").bind(id).first<BookingRow>();
    const event = row ? await createGoogleMeeting(row, manageUrl) : null;
    if (!event?.meetingUrl || !row) throw new Error("Meeting link creation failed");
    googleEventId = event.eventId;
    meetingUrl = event.meetingUrl;
    await env.DB.prepare("UPDATE bookings SET video_event_id = ?1, meeting_url = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3")
      .bind(googleEventId, meetingUrl, id).run();
    googlePersisted = true;
    microsoftEventId = await createMicrosoftMeeting(row, manageUrl, meetingUrl);
    // Without Microsoft, the Google event already carries the invitation.
    await env.DB.prepare("UPDATE bookings SET calendar_provider = ?1, calendar_event_id = ?2, integration_status = 'connected', updated_at = CURRENT_TIMESTAMP WHERE id = ?3")
      .bind(microsoftEventId ? "microsoft" : "google", microsoftEventId ?? googleEventId, id).run();
  } catch {
    if (googlePersisted && meetingUrl) {
      try {
        await env.DB.prepare("UPDATE bookings SET calendar_provider = 'microsoft', calendar_event_id = ?1, integration_status = 'needs_attention', updated_at = CURRENT_TIMESTAMP WHERE id = ?2")
          .bind(microsoftEventId, id).run();
        const row = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?1").bind(id).first<BookingRow>();
        if (row) {
          try { await sendNewBookingNotification(row, manageUrl); }
          catch (error) { console.error("Booking attention notification could not be sent", error); }
        }
        return Response.json({ manageUrl, meetingUrl, integrationStatus: "needs_attention" }, { status: 202, headers: { "cache-control": "no-store" } });
      } catch { /* Fall through to provider and local cleanup if the pending state cannot be persisted. */ }
    }
    if (microsoftEventId) { try { await cancelMicrosoftMeeting(microsoftEventId); } catch { /* Best-effort cleanup. */ } }
    if (googleEventId) { try { await cancelGoogleMeeting(googleEventId); } catch { /* Best-effort cleanup. */ } }
    await deleteLocalBooking(id);
    return Response.json({ error: "We couldn’t create the calendar invitation. Try again." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  try {
    const row = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?1").bind(id).first<BookingRow>();
    if (row) await sendNewBookingNotification(row, manageUrl);
  } catch (error) {
    console.error("New booking notification could not be sent", error);
  }
  return Response.json({ manageUrl, meetingUrl, integrationStatus: "connected" }, { status: 201, headers: { "cache-control": "no-store" } });
}
