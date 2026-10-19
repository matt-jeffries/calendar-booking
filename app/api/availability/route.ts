import { env } from "cloudflare:workers";
import { calendarBusyTimes } from "@/lib/calendar-availability";
import { getBookingConfig } from "@/lib/runtime-config";
import { addMinutes, bookingByToken, londonNowLocal } from "@/lib/booking-server";
import { enforceIdentifierRateLimit, enforceRateLimit } from "@/lib/http-security";
import { ukLocalToUtcIso } from "@/lib/client-time";

const maximumRangeDays = 46;
const calendarPaddingDays = 46;
const pad = (value: number) => String(value).padStart(2, "0");
const formatTime = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const toMinutes = (value: string) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
const parseDateKey = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : null;
};
const addDateDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export async function GET(request: Request) {
  const bookingConfig = getBookingConfig();
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const duration = Number(url.searchParams.get("duration"));
  const fromDate = from ? parseDateKey(from) : null;
  const toDate = to ? parseDateKey(to) : null;
  const spanDays = fromDate && toDate ? Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) : -1;
  const nowLocal = londonNowLocal();
  const today = nowLocal.slice(0, 10);
  const bookingHorizon = addMinutes(nowLocal, bookingConfig.maximumAdvanceDays * 24 * 60);
  const lastBookableDate = bookingHorizon.slice(0, 10);
  const earliestRequestedDate = addDateDays(today, -calendarPaddingDays);
  const latestRequestedDate = addDateDays(lastBookableDate, calendarPaddingDays);
  if (!from || !to || !fromDate || !toDate || spanDays < 0 || spanDays > maximumRangeDays
    || from < earliestRequestedDate || to > latestRequestedDate || to < today || from > lastBookableDate
    || !bookingConfig.meetingDurations.some((item) => item.minutes === duration)) {
    return Response.json({ error: "Choose a valid availability range." }, { status: 400 });
  }
  if (!env.DB) return Response.json({ error: "Availability is unavailable." }, { status: 503 });
  const limited = await enforceRateLimit(request, "availability", 30, 10 * 60);
  if (limited) return limited;
  const globallyLimited = await enforceIdentifierRateLimit("availability-global", "all-availability", 300, 10 * 60);
  if (globallyLimited) return globallyLimited;

  try {
    const manageToken = request.headers.get("x-booking-token");
    const excludedBooking = manageToken ? await bookingByToken(manageToken) : null;
    const effectiveFrom = from < today ? today : from;
    const effectiveTo = to > lastBookableDate ? lastBookableDate : to;
    const rangeStart = `${effectiveFrom}T00:00:00`;
    const rangeEnd = `${effectiveTo}T23:59:59`;
    const [calendarBusy, bookings] = await Promise.all([
      calendarBusyTimes(ukLocalToUtcIso(rangeStart), ukLocalToUtcIso(rangeEnd)),
      env.DB.prepare(`SELECT start_local AS start, end_local AS end FROM bookings WHERE status = 'active' AND start_local < ?1 AND end_local > ?2${excludedBooking ? " AND id <> ?3" : ""}`)
        .bind(rangeEnd, rangeStart, ...(excludedBooking ? [excludedBooking.id] : [])).all<{ start: string; end: string }>(),
    ]);
    const busy = [...calendarBusy.filter((item) => item.provider !== "microsoft" || item.id !== excludedBooking?.calendar_event_id), ...bookings.results]
      .map((item) => ({ start: item.start.slice(0, 19), end: item.end.slice(0, 19) }));
    const available: Record<string, string[]> = {};
    const cursor = new Date(`${effectiveFrom}T12:00:00Z`);
    const final = new Date(`${effectiveTo}T12:00:00Z`);
    const earliestStart = addMinutes(londonNowLocal(), bookingConfig.minimumNoticeMinutes);
    const dayStart = toMinutes(bookingConfig.workingHours.start);
    const dayEnd = toMinutes(bookingConfig.workingHours.end);

    while (cursor <= final) {
      const date = cursor.toISOString().slice(0, 10);
      const weekday = cursor.getUTCDay();
      const slots: string[] = [];
      if (bookingConfig.workingDays.includes(weekday as 1 | 2 | 3 | 4 | 5)) {
        for (let start = dayStart; start + duration <= dayEnd; start += bookingConfig.slotIntervalMinutes) {
          const startLocal = `${date}T${formatTime(start)}:00`;
          const endLocal = `${date}T${formatTime(start + duration)}:00`;
          if (startLocal >= earliestStart && startLocal <= bookingHorizon
            && !busy.some((item) => item.start < endLocal && item.end > startLocal)) slots.push(formatTime(start));
        }
      }
      available[date] = slots;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const slots = Object.entries(available).flatMap(([date, times]) => times.map((time) => ({ startUk: `${date}T${time}:00` })));
    return Response.json({ slots }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Live calendar availability is temporarily unavailable." }, { status: 503 });
  }
}
