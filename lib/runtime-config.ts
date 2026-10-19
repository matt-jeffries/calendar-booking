import { env } from "cloudflare:workers";
import { parseBookingConfig } from "./booking-config";

let cachedRaw: string | undefined;
let cachedConfig: ReturnType<typeof parseBookingConfig> | undefined;

export function getBookingConfig() {
  if (!cachedConfig || cachedRaw !== env.BOOKING_CONFIG_JSON) {
    cachedRaw = env.BOOKING_CONFIG_JSON;
    cachedConfig = parseBookingConfig(cachedRaw);
  }
  return cachedConfig;
}
