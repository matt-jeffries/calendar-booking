import { env } from "cloudflare:workers";
import { loadCalendarRefreshToken, saveCalendarConnection } from "./calendar-connections";

const provider = "microsoft";
const tokenEndpoint = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
};

type CachedAccessToken = { value: string; expiresAt: number };

let cachedAccessToken: CachedAccessToken | null = null;
let tokenRefresh: Promise<string> | null = null;

export function microsoftConfigured() {
  return Boolean(env.DB && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.CALENDAR_TOKEN_KEY);
}

export async function saveMicrosoftConnection(refreshToken: string, accountEmail: string | null, scope?: string) {
  await saveCalendarConnection(provider, refreshToken, accountEmail, scope);
}

async function requestAccessToken() {
  if (!microsoftConfigured() || !env.DB) throw new Error("Microsoft Calendar is not configured");
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID!,
      client_secret: env.MICROSOFT_CLIENT_SECRET!,
      refresh_token: await loadCalendarRefreshToken(provider),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Microsoft token refresh failed (${response.status})`);
  const result = await response.json() as TokenResponse;
  if (result.refresh_token) await saveMicrosoftConnection(result.refresh_token, null, result.scope);
  if (Number.isFinite(result.expires_in) && result.expires_in! > 120) {
    cachedAccessToken = { value: result.access_token, expiresAt: Date.now() + (result.expires_in! - 60) * 1_000 };
  }
  return result.access_token;
}

async function accessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) return cachedAccessToken.value;
  if (!tokenRefresh) {
    tokenRefresh = requestAccessToken().finally(() => { tokenRefresh = null; });
  }
  return tokenRefresh;
}

function invalidateAccessToken(value: string) {
  if (cachedAccessToken?.value === value) cachedAccessToken = null;
}

async function microsoftFetch(path: string, init: RequestInit = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await accessToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    });
    if (response.status !== 401 || attempt === 1) return response;
    invalidateAccessToken(token);
  }
  throw new Error("Microsoft Calendar authentication failed");
}

export async function microsoftBusyTimes(start: string, end: string) {
  if (!microsoftConfigured()) return [];
  const query = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    "$select": "id,start,end,showAs,isCancelled",
    "$top": "1000",
  });
  const response = await microsoftFetch(`/me/calendarView?${query}`, {
    headers: {
      prefer: 'outlook.timezone="Europe/London"',
    },
  });
  if (!response.ok) throw new Error(`Microsoft Calendar read failed (${response.status})`);
  const payload = await response.json() as { value: Array<{ id: string; start: { dateTime: string }; end: { dateTime: string }; showAs?: string; isCancelled?: boolean }> };
  return payload.value
    .filter((event) => !event.isCancelled && event.showAs !== "free")
    .map((event) => ({ id: event.id, start: event.start.dateTime, end: event.end.dateTime }));
}

function eventBody(booking: import("./booking-server").BookingRow, manageUrl: string, meetingUrl: string) {
  const context = booking.context ? `<p>${booking.context.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>` : "";
  return {
    subject: `Meeting with ${booking.name}`,
    body: {
      contentType: "HTML",
      content: `${context}<p><a href="${meetingUrl}">Join Google Meet</a></p><p><a href="${manageUrl}">Reschedule or cancel this meeting</a></p>`,
    },
    start: { dateTime: booking.start_local, timeZone: "GMT Standard Time" },
    end: { dateTime: booking.end_local, timeZone: "GMT Standard Time" },
    location: { displayName: "Google Meet", locationUri: meetingUrl },
    attendees: [{ emailAddress: { address: booking.email, name: booking.name }, type: "required" }],
    isReminderOn: true,
    reminderMinutesBeforeStart: 15,
  };
}

async function graphRequest(path: string, init: RequestInit) {
  const response = await microsoftFetch(path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  if (!response.ok) throw new Error(`Microsoft Calendar update failed (${response.status})`);
  return response;
}

export async function createMicrosoftMeeting(booking: import("./booking-server").BookingRow, manageUrl: string, meetingUrl: string) {
  if (!microsoftConfigured()) return null;
  const request = {
    method: "POST",
    body: JSON.stringify({ ...eventBody(booking, manageUrl, meetingUrl), transactionId: booking.id }),
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await graphRequest("/me/events", request);
      const event = await response.json() as { id: string };
      return event.id;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function updateMicrosoftMeeting(booking: import("./booking-server").BookingRow, manageUrl: string) {
  if (booking.calendar_provider !== "microsoft" || !booking.calendar_event_id || !booking.meeting_url) return;
  await graphRequest(`/me/events/${encodeURIComponent(booking.calendar_event_id)}`, {
    method: "PATCH",
    body: JSON.stringify(eventBody(booking, manageUrl, booking.meeting_url)),
  });
}

export async function cancelMicrosoftMeeting(eventId: string | null) {
  if (!eventId || !microsoftConfigured()) return;
  const response = await microsoftFetch(`/me/events/${encodeURIComponent(eventId)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment: "This meeting has been cancelled." }),
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Microsoft Calendar cancellation failed (${response.status})`);
  }
}
