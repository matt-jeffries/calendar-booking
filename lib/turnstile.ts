import { env } from "cloudflare:workers";
import { turnstileAction } from "./turnstile-config";
import { getBookingConfig } from "./runtime-config";
import { isValidTurnstileSiteverifyResponse } from "./turnstile-validation";

const testSecretKey = "1x0000000000000000000000000000000AA";

export type TurnstileResult = "valid" | "invalid" | "unavailable";

export async function verifyTurnstile(request: Request, token: unknown): Promise<TurnstileResult> {
  if (typeof token !== "string" || !token || token.length > 2_048) return "invalid";

  const requestHostname = new URL(request.url).hostname;
  const localDevelopment = requestHostname === "localhost" || requestHostname === "127.0.0.1";
  const secret = env.TURNSTILE_SECRET_KEY ?? (localDevelopment ? testSecretKey : null);
  if (!secret) return "unavailable";

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(8_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: request.headers.get("cf-connecting-ip") ?? "",
        idempotency_key: crypto.randomUUID(),
      }),
    });
    if (!response.ok) return "unavailable";
    const result: unknown = await response.json();
    const configuredHostname = new URL(getBookingConfig().publicOrigin).hostname;
    if (!isValidTurnstileSiteverifyResponse(result, {
      expectedAction: turnstileAction,
      expectedHostname: configuredHostname,
      requireExpectedHostname: !localDevelopment,
    })) return "invalid";
    return "valid";
  } catch {
    return "unavailable";
  }
}

