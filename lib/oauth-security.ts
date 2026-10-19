const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function cookieValue(request: Request, name: string) {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function createOAuthProof() {
  const state = crypto.randomUUID();
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
  return { state, verifier, challenge };
}

export function oauthCookies(provider: "google" | "microsoft", state: string, verifier: string) {
  const path = `/api/integrations/${provider}/callback`;
  return [
    `${provider}_oauth_state=${encodeURIComponent(state)}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    `${provider}_oauth_verifier=${encodeURIComponent(verifier)}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  ];
}

export function clearOAuthCookies(provider: "google" | "microsoft") {
  const path = `/api/integrations/${provider}/callback`;
  return [
    `${provider}_oauth_state=; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    `${provider}_oauth_verifier=; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  ];
}

export function setupForm(provider: "Google" | "Microsoft") {
  return `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect ${provider} Calendar</title><style>body{margin:0;background:#f8f5fa;color:#21152e;font:16px system-ui;min-height:100vh;display:grid;place-items:center}.card{width:min(420px,calc(100vw - 40px));background:white;padding:32px;border-radius:18px;box-shadow:0 24px 70px #25123820}h1{margin-top:0;font-size:28px}label{display:block;font-weight:650;font-size:13px}input{box-sizing:border-box;width:100%;margin:8px 0 18px;padding:12px;border:1px solid #d8cfdd;border-radius:8px}button{width:100%;padding:13px;border:0;border-radius:9px;background:#21152e;color:white;font-weight:700}</style><main class="card"><h1>Connect ${provider} Calendar</h1><form method="post"><label>Setup key<input name="key" type="password" required autocomplete="off"></label><button type="submit">Connect calendar</button></form></main></html>`;
}
