import { env } from "cloudflare:workers";
import { enforceRateLimit, readTextBody, requireSameOrigin } from "@/lib/http-security";
import { createOAuthProof, oauthCookies, setupForm } from "@/lib/oauth-security";
import { getBookingConfig } from "@/lib/runtime-config";

export async function GET() {
  if (!env.MICROSOFT_CLIENT_ID || !env.CALENDAR_SETUP_KEY) return new Response("Not found", { status: 404 });
  return new Response(setupForm("Microsoft"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const publicOrigin = getBookingConfig().publicOrigin;
  if (!env.MICROSOFT_CLIENT_ID || !env.CALENDAR_SETUP_KEY) return new Response("Not found", { status: 404 });
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await enforceRateLimit(request, "microsoft-setup", 5, 10 * 60);
  if (limited) return limited;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return new Response("Unsupported request", { status: 415 });
  let body: string;
  try { body = await readTextBody(request, 1_024); } catch { return new Response("Invalid request", { status: 400 }); }
  if (new URLSearchParams(body).get("key") !== env.CALENDAR_SETUP_KEY) return new Response("Not found", { status: 404 });

  const proof = await createOAuthProof();
  const redirectUri = `${publicOrigin}/api/integrations/microsoft/callback`;
  const authorize = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
  authorize.search = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "offline_access User.Read Calendars.ReadWrite",
    state: proof.state,
    prompt: "consent",
    code_challenge: proof.challenge,
    code_challenge_method: "S256",
  }).toString();
  const headers = new Headers({ location: authorize.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" });
  for (const cookie of oauthCookies("microsoft", proof.state, proof.verifier)) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}
