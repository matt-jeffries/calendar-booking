import { appleBusyTimes } from "./apple-calendar";
import { addMinutes, type BookingRow } from "./booking-server";
import { getBookingConfig } from "./runtime-config";
import { googleBusyTimes } from "./google-calendar";
import { microsoftBusyTimes } from "./microsoft-calendar";
import { decoyBusyTimes } from "./decoy-busy";

export type CalendarBusyTime = {
  provider: "microsoft" | "google" | "apple" | "decoy";
  id: string;
  start: string;
  end: string;
};

export async function calendarBusyTimes(start: string, end: string, options: { freshApple?: boolean } = {}) {
  const [microsoft, google, apple] = await Promise.all([
    microsoftBusyTimes(start, end),
    googleBusyTimes(start, end),
    appleBusyTimes(start, end, { fresh: options.freshApple }),
  ]);
  return [
    ...microsoft.map((item) => ({ ...item, provider: "microsoft" as const })),
    ...google.map((item) => ({ ...item, provider: "google" as const })),
    ...apple.map((item) => ({ ...item, provider: "apple" as const })),
    ...decoyBusyTimes(start, end).map((item) => ({ ...item, provider: "decoy" as const })),
  ];
}

// Real meetings keep a buffer either side; decoy blocks don't. Times are local, as "YYYY-MM-DDTHH:MM:SS".
export function blocksSlot(item: { start: string; end: string; provider?: string }, startLocal: string, endLocal: string) {
  const buffer = item.provider === "decoy" ? 0 : getBookingConfig().bufferMinutes;
  return item.start.slice(0, 19) < addMinutes(endLocal, buffer) && item.end.slice(0, 19) > addMinutes(startLocal, -buffer);
}

/** The window to check around a slot so buffered meetings are included. */
export function bufferedRange(startLocal: string, endLocal: string) {
  const buffer = getBookingConfig().bufferMinutes;
  return { start: addMinutes(startLocal, -buffer), end: addMinutes(endLocal, buffer) };
}

// A booking's own calendar events should not block it from being rescheduled.
export function isBookingEvent(item: CalendarBusyTime, booking: BookingRow | null | undefined) {
  if (!booking) return false;
  return (item.provider === "microsoft" && item.id === booking.calendar_event_id)
    || (item.provider === "google" && item.id === booking.video_event_id);
}
