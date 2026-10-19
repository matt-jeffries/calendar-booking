export function ukLocalToDate(value: string) {
  const [date, time] = value.slice(0, 19).split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = wallClock;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = Object.fromEntries(parts.map((item) => [item.type, item.value]));
    const represented = Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), Number(part.hour), Number(part.minute), Number(part.second));
    instant = wallClock - (represented - instant);
  }
  return new Date(instant);
}

export function ukLocalToUtcIso(value: string) {
  return ukLocalToDate(value).toISOString();
}

export function localDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return `${part.year}-${part.month}-${part.day}`;
}

export function localTimeLabel(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function localZoneLabel() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const short = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
  return zone === "Europe/London" ? "UK time" : `${short ?? zone} · your time`;
}
