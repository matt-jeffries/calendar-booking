import { env } from "cloudflare:workers";
import { getBookingConfig } from "./runtime-config";
import {
  arrayOf,
  isAllowedAppleCalDavUrl,
  multistatusResponses,
  parseExpandedCalendarData,
  selectAppleCalendarCollections,
  successfulProperties,
  textValue,
  type AppleCalendarCollection,
  type AppleBusyTime,
} from "./apple-calendar-data";

type DiscoveryCache = {
  username: string;
  expiresAt: number;
  calendars: AppleCalendarCollection[];
};

type BusyCacheEntry = {
  expiresAt: number;
  busy: AppleBusyTime[];
};

const endpoint = "https://caldav.icloud.com/";
const discoveryTtlMs = 10 * 60 * 1_000;
const busyTtlMs = 45 * 1_000;
let discoveryCache: DiscoveryCache | null = null;
const busyCache = new Map<string, BusyCacheEntry>();

function credentials() {
  const username = env.APPLE_CALDAV_USERNAME?.trim();
  const password = env.APPLE_CALDAV_PASSWORD?.trim();
  if (!username && !password) return null;
  if (!username || !password) throw new Error("Apple Calendar credentials are incomplete");
  return { username, password };
}

async function davRequest(urlValue: string, method: "PROPFIND" | "REPORT", body: string, depth: "0" | "1") {
  const auth = credentials();
  if (!auth) throw new Error("Apple Calendar is not configured");
  let url = new URL(urlValue, endpoint);

  for (let redirect = 0; redirect < 4; redirect += 1) {
    if (!isAllowedAppleCalDavUrl(url.toString())) throw new Error("Apple Calendar returned an unsafe address");
    const response = await fetch(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}`,
        "content-type": "application/xml; charset=utf-8",
        depth,
      },
      body,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Apple Calendar returned an invalid redirect");
      url = new URL(location, url);
      continue;
    }
    return { response, url };
  }
  throw new Error("Apple Calendar redirected too many times");
}

async function propfind(url: string, properties: string, depth: "0" | "1") {
  const { response, url: finalUrl } = await davRequest(url, "PROPFIND", `<?xml version="1.0" encoding="utf-8"?>
    <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop>${properties}</d:prop>
    </d:propfind>`, depth);
  if (response.status !== 207) throw new Error(`Apple Calendar discovery failed (${response.status})`);
  return { responses: multistatusResponses(await response.text()), finalUrl };
}

function hrefFromProperty(properties: Record<string, unknown>[], name: string) {
  for (const property of properties) {
    const value = property[name];
    if (value && typeof value === "object") {
      const href = textValue((value as { href?: unknown }).href);
      if (href) return href;
    }
  }
  return null;
}

function hasResourceType(property: Record<string, unknown>, name: string) {
  const resourceType = property.resourcetype;
  return Boolean(resourceType && typeof resourceType === "object" && Object.hasOwn(resourceType, name));
}

function supportsEvents(property: Record<string, unknown>) {
  const supported = property["supported-calendar-component-set"];
  if (!supported || typeof supported !== "object") return false;
  return arrayOf((supported as { comp?: unknown }).comp).some((component) => {
    if (!component || typeof component !== "object") return false;
    return String((component as { "@_name"?: unknown })["@_name"] ?? "").toUpperCase() === "VEVENT";
  });
}

async function discoverCalendars(username: string) {
  const bookingConfig = getBookingConfig();
  if (discoveryCache?.username === username && discoveryCache.expiresAt > Date.now()) return discoveryCache.calendars;

  const root = await propfind(endpoint, "<d:current-user-principal />", "0");
  const principalHref = hrefFromProperty(root.responses.flatMap(successfulProperties), "current-user-principal");
  if (!principalHref) throw new Error("Apple Calendar principal was not found");
  const principalUrl = new URL(principalHref, root.finalUrl).toString();

  const principal = await propfind(principalUrl, "<c:calendar-home-set />", "0");
  const homeHref = hrefFromProperty(principal.responses.flatMap(successfulProperties), "calendar-home-set");
  if (!homeHref) throw new Error("Apple Calendar home was not found");
  const homeUrl = new URL(homeHref, principal.finalUrl).toString();

  const home = await propfind(homeUrl, `
    <d:resourcetype />
    <d:displayname />
    <c:supported-calendar-component-set />`, "1");
  const discoveredCalendars = home.responses.flatMap((response) => {
    if (!response || typeof response !== "object") return [];
    const href = textValue((response as { href?: unknown }).href);
    const properties = successfulProperties(response);
    const eventCalendar = properties.some((property) => hasResourceType(property, "calendar") && supportsEvents(property));
    const name = properties.map((property) => textValue(property.displayname)).find(Boolean);
    if (!href || !name || !eventCalendar) return [];
    const url = new URL(href, home.finalUrl).toString();
    if (!isAllowedAppleCalDavUrl(url)) throw new Error("Apple Calendar returned an unsafe calendar address");
    return [{ name, url }];
  });
  const calendars = selectAppleCalendarCollections(discoveredCalendars, bookingConfig.appleCalendarNames);
  if (!calendars.length) throw new Error("No Apple event calendars were found");

  discoveryCache = { username, calendars, expiresAt: Date.now() + discoveryTtlMs };
  return calendars;
}

function toIcalUtc(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function queryCalendar(calendar: AppleCalendarCollection, start: string, end: string) {
  const startIcal = toIcalUtc(start);
  const endIcal = toIcalUtc(end);
  const { response } = await davRequest(calendar.url, "REPORT", `<?xml version="1.0" encoding="utf-8"?>
    <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop>
        <d:getetag />
        <c:calendar-data><c:expand start="${startIcal}" end="${endIcal}" /></c:calendar-data>
      </d:prop>
      <c:filter>
        <c:comp-filter name="VCALENDAR">
          <c:comp-filter name="VEVENT">
            <c:time-range start="${startIcal}" end="${endIcal}" />
          </c:comp-filter>
        </c:comp-filter>
      </c:filter>
    </c:calendar-query>`, "1");
  if (response.status !== 207) throw new Error(`Apple Calendar availability failed (${response.status})`);
  const rangeStart = new Date(start);
  const rangeEnd = new Date(end);
  const responses = multistatusResponses(await response.text());
  return responses.flatMap((item) => successfulProperties(item).flatMap((property) => {
    const calendarData = textValue(property["calendar-data"]);
    return calendarData ? parseExpandedCalendarData(calendarData, rangeStart, rangeEnd) : [];
  }));
}

export async function appleBusyTimes(start: string, end: string, options: { fresh?: boolean } = {}) {
  const auth = credentials();
  if (!auth) return [];
  const cacheKey = `${start}|${end}`;
  const cached = busyCache.get(cacheKey);
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.busy;

  const calendars = await discoverCalendars(auth.username);
  const busy = (await Promise.all(calendars.map((calendar) => queryCalendar(calendar, start, end)))).flat();
  busyCache.set(cacheKey, { busy, expiresAt: Date.now() + busyTtlMs });
  if (busyCache.size > 8) busyCache.delete(busyCache.keys().next().value!);
  return busy;
}
