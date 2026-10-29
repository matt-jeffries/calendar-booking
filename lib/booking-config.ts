export type MeetingDuration = { minutes: number; label: string };

export type BookingConfig = {
  name: string;
  firstName: string;
  publicOrigin: string;
  timezone: string;
  locale: string;
  timezoneLabel: string;
  workingDays: number[];
  workingHours: { start: string; end: string };
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  slotIntervalMinutes: number;
  meetingDurations: MeetingDuration[];
  videoProvider: string;
  appleCalendarNames: string[];
  rates: { hourly: string; professionalDay: string };
  /** Share of free working time (0 to 0.8) shown as busy, reshuffled weekly. 0 turns it off. */
  decoyBusyShare: number;
  /** Minutes kept clear before and after real meetings (not decoy blocks). */
  bufferMinutes: number;
  branding: {
    avatarUrl: string;
    socialImageUrl: string | null;
    faviconUrl: string;
  };
};

export type BookingUiConfig = Pick<BookingConfig,
  | "name"
  | "firstName"
  | "locale"
  | "timezoneLabel"
  | "workingHours"
  | "slotIntervalMinutes"
  | "meetingDurations"
  | "videoProvider"
  | "rates"
  | "branding"
>;

export function toBookingUiConfig(config: BookingConfig): BookingUiConfig {
  return {
    name: config.name,
    firstName: config.firstName,
    locale: config.locale,
    timezoneLabel: config.timezoneLabel,
    workingHours: config.workingHours,
    slotIntervalMinutes: config.slotIntervalMinutes,
    meetingDurations: config.meetingDurations,
    videoProvider: config.videoProvider,
    rates: config.rates,
    branding: config.branding,
  };
}

export const defaultBookingConfig: BookingConfig = {
  name: "Your Name",
  firstName: "you",
  publicOrigin: "http://localhost:5173",
  timezone: "Europe/London",
  locale: "en-GB",
  timezoneLabel: "UK time",
  workingDays: [1, 2, 3, 4, 5],
  workingHours: { start: "09:00", end: "17:00" },
  minimumNoticeMinutes: 60,
  maximumAdvanceDays: 90,
  slotIntervalMinutes: 30,
  meetingDurations: [
    { minutes: 30, label: "Quick conversation" },
    { minutes: 60, label: "Longer conversation" },
  ],
  videoProvider: "Google Meet",
  appleCalendarNames: [],
  rates: { hourly: "", professionalDay: "" },
  decoyBusyShare: 0,
  bufferMinutes: 0,
  branding: {
    avatarUrl: "/profile-placeholder.svg",
    socialImageUrl: null,
    faviconUrl: "/favicon.svg",
  },
};

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const assetPattern = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, fallback: string, maximum = 160) {
  return typeof value === "string" && value.trim() && value.trim().length <= maximum ? value.trim() : fallback;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : fallback;
}

function assetPath(value: unknown, fallback: string | null) {
  if (value === null) return null;
  return typeof value === "string" && value.length <= 200 && assetPattern.test(value) ? value : fallback;
}

export function parseBookingConfig(raw: string | undefined): BookingConfig {
  if (!raw) return defaultBookingConfig;
  if (raw.length > 16_384) throw new Error("BOOKING_CONFIG_JSON is too large");
  let input: Record<string, unknown>;
  try {
    const parsedRecord = record(JSON.parse(raw));
    if (!parsedRecord) throw new Error();
    input = parsedRecord;
  } catch {
    throw new Error("BOOKING_CONFIG_JSON must be a JSON object");
  }

  const workingHours = record(input.workingHours);
  const rates = record(input.rates);
  const branding = record(input.branding);
  const originValue = text(input.publicOrigin, defaultBookingConfig.publicOrigin, 300);
  let publicOrigin = defaultBookingConfig.publicOrigin;
  try {
    const url = new URL(originValue);
    if ((url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.origin === originValue) publicOrigin = url.origin;
  } catch { /* Keep the safe local default. */ }

  const workingDays = Array.isArray(input.workingDays)
    ? [...new Set(input.workingDays.filter((day): day is number => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6))]
    : defaultBookingConfig.workingDays;
  const meetingDurations = Array.isArray(input.meetingDurations)
    ? input.meetingDurations.flatMap((entry) => {
        const item = record(entry);
        if (!item) return [];
        const minutes = integer(item.minutes, 0, 15, 480);
        if (!minutes) return [];
        return [{ minutes, label: text(item.label, `${minutes} minute meeting`, 80) }];
      }).slice(0, 6)
    : defaultBookingConfig.meetingDurations;

  const start = workingHours && typeof workingHours.start === "string" && timePattern.test(workingHours.start)
    ? workingHours.start : defaultBookingConfig.workingHours.start;
  const end = workingHours && typeof workingHours.end === "string" && timePattern.test(workingHours.end)
    ? workingHours.end : defaultBookingConfig.workingHours.end;
  if (start >= end) throw new Error("Working hours must end after they start");
  if (!workingDays.length) throw new Error("At least one working day is required");
  if (!meetingDurations.length) throw new Error("At least one meeting duration is required");

  const name = text(input.name, defaultBookingConfig.name, 100);
  const timezone = text(input.timezone, defaultBookingConfig.timezone, 100);
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
  catch { throw new Error("timezone must be a valid IANA timezone"); }
  return {
    name,
    firstName: text(input.firstName, name.split(/\s+/)[0] ?? defaultBookingConfig.firstName, 60),
    publicOrigin,
    timezone,
    locale: text(input.locale, defaultBookingConfig.locale, 20),
    timezoneLabel: text(input.timezoneLabel, defaultBookingConfig.timezoneLabel, 40),
    workingDays,
    workingHours: { start, end },
    minimumNoticeMinutes: integer(input.minimumNoticeMinutes, defaultBookingConfig.minimumNoticeMinutes, 0, 10_080),
    maximumAdvanceDays: integer(input.maximumAdvanceDays, defaultBookingConfig.maximumAdvanceDays, 1, 730),
    slotIntervalMinutes: integer(input.slotIntervalMinutes, defaultBookingConfig.slotIntervalMinutes, 5, 240),
    meetingDurations,
    videoProvider: text(input.videoProvider, defaultBookingConfig.videoProvider, 80),
    appleCalendarNames: Array.isArray(input.appleCalendarNames)
      ? input.appleCalendarNames.filter((value): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 200).map((value) => value.trim()).slice(0, 20)
      : defaultBookingConfig.appleCalendarNames,
    rates: {
      hourly: rates ? text(rates.hourly, "", 40) : defaultBookingConfig.rates.hourly,
      professionalDay: rates ? text(rates.professionalDay, "", 40) : defaultBookingConfig.rates.professionalDay,
    },
    bufferMinutes: integer(input.bufferMinutes, 0, 0, 240),
    decoyBusyShare: typeof input.decoyBusyShare === "number" && Number.isFinite(input.decoyBusyShare) ? Math.min(0.8, Math.max(0, input.decoyBusyShare)) : 0,
    branding: {
      avatarUrl: assetPath(branding?.avatarUrl, defaultBookingConfig.branding.avatarUrl)!,
      socialImageUrl: assetPath(branding?.socialImageUrl, defaultBookingConfig.branding.socialImageUrl),
      faviconUrl: assetPath(branding?.faviconUrl, defaultBookingConfig.branding.faviconUrl)!,
    },
  };
}
