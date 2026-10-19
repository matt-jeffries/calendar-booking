import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthProof, oauthCookies } from "../../lib/oauth-security.ts";

test("creates a fresh PKCE proof for every calendar connection", async () => {
  const first = await createOAuthProof();
  const second = await createOAuthProof();

  assert.match(first.state, /^[0-9a-f-]{36}$/i);
  assert.match(first.verifier, /^[A-Za-z0-9_-]{64}$/);
  assert.match(first.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.verifier, second.verifier);
});

test("limits OAuth cookies to the provider callback and browser security controls", () => {
  const cookies = oauthCookies("google", "state", "verifier");

  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.match(cookie, /Path=\/api\/integrations\/google\/callback/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=600/);
  }
});
