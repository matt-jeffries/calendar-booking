import { appleBusyTimes } from "./apple-calendar";
import type { BookingRow } from "./booking-server";
import { googleBusyTimes } from "./google-calendar";
import { microsoftBusyTimes } from "./microsoft-calendar";

export type CalendarBusyTime = {
  provider: "microsoft" | "google" | "apple";
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
  ];
}

// A booking's own calendar events should not block it from being rescheduled.
export function isBookingEvent(item: CalendarBusyTime, booking: BookingRow | null | undefined) {
  if (!booking) return false;
  return (item.provider === "microsoft" && item.id === booking.calendar_event_id)
    || (item.provider === "google" && item.id === booking.video_event_id);
}
