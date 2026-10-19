import { env } from "cloudflare:workers";

const encoder = new TextEncoder();

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pseudonymousKey(scope: string, bucket: number, identifier: string) {
  const value = encoder.encode(`${scope}:${bucket}:${identifier}`);
  if (env.CALENDAR_TOKEN_KEY) {
    const rawKey = Uint8Array.from(atob(env.CALENDAR_TOKEN_KEY), (character) => character.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey("raw", rawKey, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({
      name: "HKDF", hash: "SHA-256", salt: encoder.encode("booking-calendar-v1"), info: encoder.encode("anonymous-rate-limit"),
    }, keyMaterial, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
    return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, value)));
  }
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

async function applyRateLimit(scope: string, identifier: string, limit: number, windowSeconds: number) {
  if (!env.DB) return Response.json({ error: "This service is temporarily unavailable." }, { status: 503 });
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSeconds);
  const key = `${scope}:${bucket}:${await pseudonymousKey(scope, bucket, identifier)}`;
  await env.DB.prepare("DELETE FROM request_rate_limits WHERE expires_at < ?1").bind(now).run();
  const result = await env.DB.prepare(`INSERT INTO request_rate_limits (rate_key, request_count, expires_at)
    VALUES (?1, 1, ?2)
    ON CONFLICT(rate_key) DO UPDATE SET request_count = request_count + 1, expires_at = excluded.expires_at
    RETURNING request_count`)
    .bind(key, (bucket + 1) * windowSeconds).first<{ request_count: number }>();
  if ((result?.request_count ?? limit + 1) <= limit) return null;
  const retryAfter = Math.max(1, (bucket + 1) * windowSeconds - now);
  return Response.json({ error: "Too many requests. Please wait and try again." }, {
    status: 429,
    headers: { "cache-control": "no-store", "retry-after": String(retryAfter) },
  });
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "This request was not accepted." }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  return null;
}

export async function enforceRateLimit(request: Request, scope: string, limit: number, windowSeconds: number) {
  return applyRateLimit(scope, request.headers.get("cf-connecting-ip") ?? "local", limit, windowSeconds);
}

export async function enforceIdentifierRateLimit(scope: string, identifier: string, limit: number, windowSeconds: number) {
  return applyRateLimit(scope, identifier, limit, windowSeconds);
}

export async function readTextBody(request: Request, maximumBytes = 8_192) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new RangeError("Request body is too large");
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new RangeError("Request body is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function readJsonBody(request: Request, maximumBytes = 8_192) {
  return JSON.parse(await readTextBody(request, maximumBytes)) as unknown;
}
