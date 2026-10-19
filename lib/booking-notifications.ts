import { env } from "cloudflare:workers";
import type { BookingRow } from "./booking-server";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function dateLabel(startLocal: string) {
  return new Intl.DateTimeFormat("en-GB", {
    // The stored value is already a UK wall-clock time; UTC prevents a second DST conversion while formatting it.
    timeZone: "UTC",
    weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(`${startLocal}Z`));
}

export async function sendNewBookingNotification(booking: BookingRow, manageUrl: string) {
  const notificationSender = env.NOTIFICATION_FROM?.trim();
  const notificationRecipient = env.NOTIFICATION_TO?.trim();
  if (!env.RESEND_API_KEY || !notificationSender || !notificationRecipient) return false;
  const context = booking.context ? `<p><strong>Context</strong><br>${escapeHtml(booking.context).replaceAll("\n", "<br>")}</p>` : "";
  const needsAttention = booking.integration_status !== "connected";
  const attention = needsAttention ? "<p><strong>Action needed:</strong> the time is reserved, but the Microsoft invitation could not be confirmed automatically. Check the calendars and contact the attendee if needed.</p>" : "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: notificationSender,
      to: [notificationRecipient],
      subject: `${needsAttention ? "Action needed — " : ""}New booking: ${booking.name} — ${dateLabel(booking.start_local)}`,
      html: `<h2>New meeting booked</h2>${attention}<p><strong>${escapeHtml(booking.name)}</strong> (${escapeHtml(booking.email)}) has booked ${booking.duration_minutes} minutes with you.</p><p><strong>When</strong><br>${escapeHtml(dateLabel(booking.start_local))} UK time</p>${context}<p><a href="${escapeHtml(manageUrl)}">View or manage the booking</a></p>`,
    }),
  });
  if (!response.ok) throw new Error(`Booking notification failed (${response.status})`);
  return true;
}
