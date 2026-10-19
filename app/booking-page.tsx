import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import BookingApp from "@/components/booking-app";
import { getBookingConfig } from "@/lib/runtime-config";
import { toBookingUiConfig } from "@/lib/booking-config";
import { turnstileTestSiteKey } from "@/lib/turnstile-config";

export type BookingSearchParams = Promise<{ rates?: string | string[] }>;

export function ratesAreVisible(rates: string | string[] | undefined) {
  return Array.isArray(rates) ? rates.includes("true") : rates === "true";
}

export default async function BookingPage({
  fixedDuration,
  showRates,
}: {
  fixedDuration?: 30 | 60;
  showRates: boolean;
}) {
  const hostname = (await headers()).get("host")?.split(":", 1)[0];
  const localDevelopment = hostname === "localhost" || hostname === "127.0.0.1";
  const siteKey = env.TURNSTILE_SITE_KEY ?? (localDevelopment ? turnstileTestSiteKey : null);
  const bookingConfig = getBookingConfig();

  return (
    <BookingApp
      config={toBookingUiConfig(bookingConfig)}
      fixedDuration={fixedDuration}
      showRates={showRates}
      turnstileSiteKey={siteKey}
    />
  );
}
