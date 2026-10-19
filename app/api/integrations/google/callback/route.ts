import { env } from "cloudflare:workers";
import { saveGoogleConnection } from "@/lib/google-calendar";
import { calendarConnectionEmail } from "@/lib/calendar-connections";
import { clearOAuthCookies, cookieValue } from "@/lib/oauth-security";
import { getBookingConfig } from "@/lib/runtime-config";

function oauthError(message: string, status: number) {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of clearOAuthCookies("google")) headers.append("set-cookie", cookie);
  return new Response(message, { status, headers });
}

export async function GET(request: Request) {
  const publicOrigin = getBookingConfig().publicOrigin;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const verifier = cookieValue(request, "google_oauth_verifier");
  if (!code || !state || !verifier || state !== cookieValue(request, "google_oauth_state") || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return oauthError("Google connection could not be verified.", 400);
  }
  const redirectUri = `${publicOrigin}/api/integrations/google/callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
  });
  if (!tokenResponse.ok) return oauthError("Google connection failed.", 502);
  const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; scope?: string };
  if (!tokens.refresh_token) return oauthError("Google did not provide ongoing calendar access.", 502);
  const grantedScopes = new Set(tokens.scope?.split(/\s+/).filter(Boolean));
  if (!grantedScopes.has("https://www.googleapis.com/auth/calendar.events")) {
    return oauthError("Google Calendar event access was not granted. Reconnect and allow this booking calendar to create and edit events.", 403);
  }
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` } });
  const profile = profileResponse.ok ? await profileResponse.json() as { email?: string } : {};
  if (!profile.email) return oauthError("The Google account could not be verified.", 403);
  const connectedEmail = await calendarConnectionEmail("google");
  if (connectedEmail && connectedEmail.toLowerCase() !== profile.email.toLowerCase()) return oauthError("This is not the Google account already connected to the booking calendar.", 403);
  await saveGoogleConnection(tokens.refresh_token, profile.email, tokens.scope);
  const headers = new Headers({ location: `${publicOrigin}/?google=connected`, "cache-control": "no-store" });
  for (const cookie of clearOAuthCookies("google")) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}
