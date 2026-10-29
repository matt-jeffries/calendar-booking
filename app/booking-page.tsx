import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import BookingApp from "@/components/booking-app";
import { getBookingConfig } from "@/lib/runtime-config";
import { toBookingUiConfig } from "@/lib/booking-config";
import { turnstileTestSiteKey } from "@/lib/turnstile-config";

export type BookingSearchParams = Promise<{ rates?: string | string[]; embed?: string | string[] }>;

export function ratesAreVisible(rates: string | string[] | undefined) {
  return Array.isArray(rates) ? rates.includes("true") : rates === "true";
}

export function isEmbedded(embed: string | string[] | undefined) {
  return Array.isArray(embed) ? embed.includes("1") : embed === "1";
}

export default async function BookingPage({
  fixedDuration,
  showRates,
  embedded = false,
}: {
  fixedDuration?: 30 | 60;
  showRates: boolean;
  embedded?: boolean;
}) {
  const hostname = (await headers()).get("host")?.split(":", 1)[0];
  const localDevelopment = hostname === "localhost" || hostname === "127.0.0.1";
  const siteKey = env.TURNSTILE_SITE_KEY ?? (localDevelopment ? turnstileTestSiteKey : null);
  const bookingConfig = getBookingConfig();
  const embedOrigins = ((env as { EMBED_ORIGINS?: string }).EMBED_ORIGINS ?? "").split(/\s+/).filter((origin) => origin.startsWith("https://"));

  return (
    <BookingApp
      config={toBookingUiConfig(bookingConfig)}
      fixedDuration={fixedDuration}
      showRates={showRates}
      turnstileSiteKey={siteKey}
      embedded={embedded}
      embedOrigins={embedOrigins}
    />
  );
}
