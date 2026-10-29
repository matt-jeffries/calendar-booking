import { env } from "cloudflare:workers";
import type { BookingRow } from "./booking-server";
import { calendarConnectionHasScope, loadCalendarRefreshToken, saveCalendarConnection } from "./calendar-connections";
import { microsoftConfigured } from "./microsoft-calendar";
import { meetingTitle } from "./meeting-topic";

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

// Without Microsoft, the Google event is the attendee's invitation as well as the Meet link.
function googleSendsInvites() {
  return !microsoftConfigured();
}

function sendUpdates() {
  return googleSendsInvites() ? "all" : "none";
}

function eventBody(booking: BookingRow, manageUrl: string) {
  if (!googleSendsInvites()) {
    return {
      summary: meetingTitle(booking),
      description: `Manage, reschedule or cancel this booking: ${manageUrl}`,
      start: { dateTime: booking.start_local, timeZone: booking.timezone },
      end: { dateTime: booking.end_local, timeZone: booking.timezone },
    };
  }
  const context = booking.context ? `${booking.context}\n\n` : "";
  return {
    summary: meetingTitle(booking),
    description: `${context}Reschedule or cancel this meeting: ${manageUrl}`,
    start: { dateTime: booking.start_local, timeZone: booking.timezone },
    end: { dateTime: booking.end_local, timeZone: booking.timezone },
    attendees: [{ email: booking.email, displayName: booking.name }],
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] },
  };
}

type GoogleEvent = {
  id: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export async function googleBusyTimes(start: string, end: string) {
  if (!await googleCalendarConfigured()) return [];
  const token = await accessToken();
  const busy: Array<{ id: string; start: string; end: string }> = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: "true", maxResults: "2500", timeZone: "Europe/London" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Google Calendar read failed (${response.status})`);
    const payload = await response.json() as { items?: GoogleEvent[]; nextPageToken?: string };
    for (const event of payload.items ?? []) {
      if (event.status === "cancelled" || event.transparency === "transparent") continue;
      // All-day events count only when they are marked busy, which Google does not do by default.
      const eventStart = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00` : null);
      const eventEnd = event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T00:00:00` : null);
      if (eventStart && eventEnd) busy.push({ id: event.id, start: eventStart, end: eventEnd });
    }
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);
  return busy;
}

export async function createGoogleMeeting(booking: BookingRow, manageUrl: string) {
  if (!await googleCalendarConfigured()) return null;
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${sendUpdates()}`, {
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
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(booking.video_event_id)}?conferenceDataVersion=1&sendUpdates=${sendUpdates()}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(eventBody(booking, manageUrl)),
  });
  if (!response.ok) throw new Error("Google Calendar event update failed");
}

export async function cancelGoogleMeeting(eventId: string | null) {
  if (!await googleCalendarConfigured() || !eventId) return;
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates()}`, {
    method: "DELETE", headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error("Google Calendar event cancellation failed");
}

export async function saveGoogleConnection(refreshToken: string, accountEmail: string | null, scope?: string) {
  await saveCalendarConnection(provider, refreshToken, accountEmail, scope);
}
