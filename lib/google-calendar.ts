import { env } from "cloudflare:workers";
import type { BookingRow } from "./booking-server";
import { calendarConnectionHasScope, loadCalendarRefreshToken, saveCalendarConnection } from "./calendar-connections";

const provider = "google";
const calendarEventsScope = "https://www.googleapis.com/auth/calendar.events";

export async function googleCalendarConfigured() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.CALENDAR_TOKEN_KEY && await calendarConnectionHasScope(provider, calendarEventsScope));
}

async function accessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: await loadCalendarRefreshToken(provider), grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new Error("Google authentication failed");
  return (await response.json() as { access_token: string }).access_token;
}

function eventBody(booking: BookingRow, manageUrl: string) {
  return {
    summary: `Meeting with ${booking.name}`,
    description: `Manage, reschedule or cancel this booking: ${manageUrl}`,
    start: { dateTime: booking.start_local, timeZone: booking.timezone },
    end: { dateTime: booking.end_local, timeZone: booking.timezone },
  };
}

export async function createGoogleMeeting(booking: BookingRow, manageUrl: string) {
  if (!await googleCalendarConfigured()) return null;
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ ...eventBody(booking, manageUrl), conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }),
  });
  if (!response.ok) throw new Error("Google Calendar event creation failed");
  const event = await response.json() as { id: string; hangoutLink?: string };
  return { eventId: event.id, meetingUrl: event.hangoutLink ?? null };
}

export async function updateGoogleMeeting(booking: BookingRow, manageUrl: string) {
  if (!await googleCalendarConfigured() || !booking.video_event_id) return;
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(booking.video_event_id)}?conferenceDataVersion=1&sendUpdates=none`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(eventBody(booking, manageUrl)),
  });
  if (!response.ok) throw new Error("Google Calendar event update failed");
}

export async function cancelGoogleMeeting(eventId: string | null) {
  if (!await googleCalendarConfigured() || !eventId) return;
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
    method: "DELETE", headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error("Google Calendar event cancellation failed");
}

export async function saveGoogleConnection(refreshToken: string, accountEmail: string | null, scope?: string) {
  await saveCalendarConnection(provider, refreshToken, accountEmail, scope);
}
