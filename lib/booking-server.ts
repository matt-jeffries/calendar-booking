import { env } from "cloudflare:workers";
import { getBookingConfig } from "./runtime-config";

export type BookingRow = {
  id: string; name: string; email: string; context: string;
  start_local: string; end_local: string; timezone: string;
  duration_minutes: number; status: string; calendar_event_id: string | null;
  video_event_id: string | null;
  meeting_url: string | null; integration_status: string;
};

export async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function addMinutes(startLocal: string, minutes: number) {
  const date = new Date(`${startLocal.slice(0, 19)}Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 19);
}

export function slotStarts(startLocal: string, endLocal: string) {
  const bookingConfig = getBookingConfig();
  const slots: string[] = [];
  for (let cursor = startLocal; cursor < endLocal; cursor = addMinutes(cursor, bookingConfig.slotIntervalMinutes)) slots.push(cursor);
  return slots;
}

export function londonNowLocal() {
  const bookingConfig = getBookingConfig();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: bookingConfig.timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}`;
}

export function validateSlot(startLocal: string, duration: number) {
  const bookingConfig = getBookingConfig();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(startLocal)) return "Choose a valid date and time.";
  if (!bookingConfig.meetingDurations.some((item) => item.minutes === duration)) return "Choose a supported meeting length.";
  const [date, time] = startLocal.split("T");
  const parsed = new Date(`${startLocal}Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== startLocal) return "Choose a valid date and time.";
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!bookingConfig.workingDays.includes(day as 1 | 2 | 3 | 4 | 5)) return "Choose a weekday.";
  const toMinutes = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
  const startMinutes = toMinutes(time);
  if (startMinutes < toMinutes(bookingConfig.workingHours.start) || startMinutes + duration > toMinutes(bookingConfig.workingHours.end)) return `Choose a time between ${bookingConfig.workingHours.start} and ${bookingConfig.workingHours.end}.`;
  if ((startMinutes - toMinutes(bookingConfig.workingHours.start)) % bookingConfig.slotIntervalMinutes !== 0) return "Choose one of the available start times.";
  if (startLocal < addMinutes(londonNowLocal(), bookingConfig.minimumNoticeMinutes)) return `Please choose a time at least ${bookingConfig.minimumNoticeMinutes} minutes from now.`;
  if (startLocal > addMinutes(londonNowLocal(), bookingConfig.maximumAdvanceDays * 24 * 60)) return `Please choose a time within the next ${bookingConfig.maximumAdvanceDays} days.`;
  return null;
}

export async function hasConflict(startLocal: string, endLocal: string, excludeId?: string) {
  if (!env.DB) throw new Error("Database unavailable");
  const sql = `SELECT id FROM bookings WHERE status = 'active' AND start_local < ?1 AND end_local > ?2${excludeId ? " AND id <> ?3" : ""} LIMIT 1`;
  const statement = env.DB.prepare(sql).bind(endLocal, startLocal, ...(excludeId ? [excludeId] : []));
  return Boolean(await statement.first());
}

export async function bookingByToken(token: string) {
  if (!env.DB) throw new Error("Database unavailable");
  if (!/^[0-9a-f-]{68}$/i.test(token)) return null;
  return env.DB.prepare("SELECT * FROM bookings WHERE manage_token_hash = ?1 LIMIT 1").bind(await tokenHash(token)).first<BookingRow>();
}
