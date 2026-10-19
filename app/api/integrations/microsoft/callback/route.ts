import { env } from "cloudflare:workers";
import { saveMicrosoftConnection } from "@/lib/microsoft-calendar";
import { clearOAuthCookies, cookieValue } from "@/lib/oauth-security";
import { getBookingConfig } from "@/lib/runtime-config";

function oauthError(message: string, status: number) {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of clearOAuthCookies("microsoft")) headers.append("set-cookie", cookie);
  return new Response(message, { status, headers });
}

export async function GET(request: Request) {
  const publicOrigin = getBookingConfig().publicOrigin;
  const expectedAccount = env.MICROSOFT_EXPECTED_ACCOUNT?.trim().toLowerCase();
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const verifier = cookieValue(request, "microsoft_oauth_verifier");
  if (!code || !state || !verifier || state !== cookieValue(request, "microsoft_oauth_state")) {
    return oauthError("We couldn’t verify the Microsoft connection. Start again.", 400);
  }
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !expectedAccount) return oauthError("Microsoft is not configured.", 503);

  const redirectUri = `${publicOrigin}/api/integrations/microsoft/callback`;
  const tokenResponse = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: "offline_access User.Read Calendars.ReadWrite",
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) return oauthError("Microsoft authentication failed. Start again.", 502);
  const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; scope?: string };
  if (!tokens.refresh_token) return oauthError("Microsoft did not provide ongoing calendar access.", 502);

  const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = profileResponse.ok ? await profileResponse.json() as { mail?: string; userPrincipalName?: string } : {};
  const accountEmail = profile.mail ?? profile.userPrincipalName;
  if (!accountEmail || accountEmail.toLowerCase() !== expectedAccount) return oauthError("This is not the approved Microsoft account.", 403);
  await saveMicrosoftConnection(tokens.refresh_token, accountEmail, tokens.scope);

  const headers = new Headers({ location: `${publicOrigin}/?microsoft=connected`, "cache-control": "no-store" });
  for (const cookie of clearOAuthCookies("microsoft")) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}
