import { env } from "cloudflare:workers";
import { getBookingConfig } from "./runtime-config";

// Optional "look busier" blocks: hides a share of free working time in realistic 60–90 minute blocks.
// The pattern is fixed for a week (so returning visitors see the same diary), reshuffles every Monday,
// and is seeded with a private key so it can't be predicted from outside.

const pad = (value: number) => String(value).padStart(2, "0");
const toMinutes = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
const formatTime = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function weekBlocks(monday: Date, share: number) {
  const config = getBookingConfig();
  const unit = config.slotIntervalMinutes;
  const dayStart = toMinutes(config.workingHours.start);
  const units = Math.floor((toMinutes(config.workingHours.end) - dayStart) / unit);
  const next = random(hash(`${env.CALENDAR_TOKEN_KEY ?? ""}:decoy:${dayKey(monday)}`));
  const blocks: Array<{ id: string; start: string; end: string }> = [];
  const days = Array.from({ length: 7 }, (_, offset) => { const date = new Date(monday); date.setUTCDate(date.getUTCDate() + offset); return date; })
    .filter((date) => config.workingDays.includes(date.getUTCDay()));
  // One day a week, sometimes two, is busy enough to show as "Limited"; the rest sit a little under the share to balance it.
  const heavy = new Set([Math.floor(next() * days.length)]);
  const second = Math.floor(next() * days.length);
  if (next() < 0.35 && [...heavy].every((day) => Math.abs(day - second) > 1)) heavy.add(second);
  for (const [position, date] of days.entries()) {
    // Normal days land within 15% either side of the share, and always keep some free time.
    const dayShare = heavy.has(position)
      ? Math.max(share, 0.62 + next() * 0.1)
      : Math.min(0.8, Math.max(0, share - 0.05 + (next() - 0.5) * 0.3));
    const target = Math.round(units * dayShare);
    const busy = new Array<boolean>(units).fill(false);
    let covered = 0;
    for (let attempt = 0; covered < target && attempt < 200; attempt += 1) {
      const length = Math.max(1, Math.min(Math.round((next() < 0.7 ? 60 : 90) / unit), target - covered));
      const start = Math.floor(next() * (units - length + 1));
      if (busy.slice(start, start + length).some(Boolean)) continue;
      busy.fill(true, start, start + length);
      covered += length;
    }
    // Close leftover gaps by growing existing blocks, so busy days reach their share.
    for (let index = 0; covered < target && index < units; index += 1) {
      if (!busy[index] && (busy[index - 1] || busy[index + 1])) { busy[index] = true; covered += 1; }
    }
    const key = dayKey(date);
    for (let index = 0; index < units; index += 1) {
      if (!busy[index] || busy[index - 1]) continue;
      let end = index;
      while (busy[end]) end += 1;
      blocks.push({ id: `decoy-${key}-${index}`, start: `${key}T${formatTime(dayStart + index * unit)}:00`, end: `${key}T${formatTime(dayStart + end * unit)}:00` });
    }
  }
  return blocks;
}

/** Busy blocks in local time for every working day that overlaps the given UTC range. */
export function decoyBusyTimes(start: string, end: string) {
  const share = getBookingConfig().decoyBusyShare;
  if (!share) return [];
  const first = new Date(`${start.slice(0, 10)}T12:00:00Z`);
  first.setUTCDate(first.getUTCDate() - 1);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const last = new Date(`${end.slice(0, 10)}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 1);
  const blocks = [];
  for (const monday = first; monday <= last; monday.setUTCDate(monday.getUTCDate() + 7)) blocks.push(...weekBlocks(new Date(monday), share));
  return blocks;
}
