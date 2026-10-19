import { env } from "cloudflare:workers";

type ConnectionRow = {
  encrypted_refresh_token: string;
  token_iv: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function tokenKey() {
  if (!env.CALENDAR_TOKEN_KEY) throw new Error("Calendar token encryption is not configured");
  return crypto.subtle.importKey("raw", base64ToBytes(env.CALENDAR_TOKEN_KEY), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(), new TextEncoder().encode(token));
  return { encrypted: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

async function decryptToken(encrypted: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await tokenKey(), base64ToBytes(encrypted));
  return new TextDecoder().decode(plaintext);
}

export async function saveCalendarConnection(provider: string, refreshToken: string, accountEmail: string | null, scope?: string) {
  if (!env.DB) throw new Error("Database unavailable");
  const token = await encryptToken(refreshToken);
  await env.DB.prepare(`INSERT INTO calendar_connections (provider, account_email, encrypted_refresh_token, token_iv, scope, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
    ON CONFLICT(provider) DO UPDATE SET account_email = COALESCE(excluded.account_email, calendar_connections.account_email), encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_iv = excluded.token_iv, scope = excluded.scope, updated_at = CURRENT_TIMESTAMP`)
    .bind(provider, accountEmail, token.encrypted, token.iv, scope ?? null).run();
}

export async function loadCalendarRefreshToken(provider: string) {
  if (!env.DB) throw new Error("Database unavailable");
  const connection = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv FROM calendar_connections WHERE provider = ?1")
    .bind(provider).first<ConnectionRow>();
  if (!connection) throw new Error(`${provider} Calendar is not connected`);
  return decryptToken(connection.encrypted_refresh_token, connection.token_iv);
}

export async function calendarConnectionExists(provider: string) {
  if (!env.DB) return false;
  return Boolean(await env.DB.prepare("SELECT 1 AS connected FROM calendar_connections WHERE provider = ?1").bind(provider).first());
}

export async function calendarConnectionHasScope(provider: string, requiredScope: string) {
  if (!env.DB) return false;
  const connection = await env.DB.prepare("SELECT scope FROM calendar_connections WHERE provider = ?1")
    .bind(provider).first<{ scope: string | null }>();
  return Boolean(connection?.scope?.split(/\s+/).includes(requiredScope));
}

export async function calendarConnectionEmail(provider: string) {
  if (!env.DB) return null;
  const connection = await env.DB.prepare("SELECT account_email FROM calendar_connections WHERE provider = ?1")
    .bind(provider).first<{ account_email: string | null }>();
  return connection?.account_email ?? null;
}
