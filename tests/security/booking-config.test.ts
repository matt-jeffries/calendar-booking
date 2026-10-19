import assert from "node:assert/strict";
import test from "node:test";
import { defaultBookingConfig, parseBookingConfig, toBookingUiConfig } from "../../lib/booking-config.ts";

test("uses safe generic defaults without runtime configuration", () => {
  const config = parseBookingConfig(undefined);
  assert.equal(config.name, "Your Name");
  assert.equal(config.branding.avatarUrl, "/profile-placeholder.svg");
  assert.deepEqual(config.appleCalendarNames, []);
});

test("rejects malformed and unsafe configuration", () => {
  assert.throws(() => parseBookingConfig("[]"), /JSON object/);
  assert.throws(() => parseBookingConfig(JSON.stringify({ timezone: "Not/A_Zone" })), /IANA timezone/);
  assert.equal(parseBookingConfig(JSON.stringify({ publicOrigin: "http://example.com" })).publicOrigin, defaultBookingConfig.publicOrigin);
  assert.equal(parseBookingConfig(JSON.stringify({ branding: { avatarUrl: "https://attacker.example/avatar.png" } })).branding.avatarUrl, "/profile-placeholder.svg");
});

test("does not expose integration-only configuration to the browser", () => {
  const config = parseBookingConfig(JSON.stringify({ appleCalendarNames: ["Private calendar"] }));
  const publicConfig = toBookingUiConfig(config) as Record<string, unknown>;
  assert.equal("appleCalendarNames" in publicConfig, false);
  assert.equal("publicOrigin" in publicConfig, false);
});
