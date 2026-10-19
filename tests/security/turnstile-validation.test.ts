import test from "node:test";
import assert from "node:assert/strict";
import { isValidTurnstileSiteverifyResponse } from "../../lib/turnstile-validation.ts";

const productionOptions = {
  expectedAction: "create_booking",
  expectedHostname: "booking.example.com",
  requireExpectedHostname: true,
};

test("accepts a successful response with the expected action and production hostname", () => {
  assert.equal(isValidTurnstileSiteverifyResponse({
    success: true,
    action: "create_booking",
    hostname: "booking.example.com",
  }, productionOptions), true);
});

test("rejects a successful response issued for a different action", () => {
  assert.equal(isValidTurnstileSiteverifyResponse({
    success: true,
    action: "manage_booking",
    hostname: "booking.example.com",
  }, productionOptions), false);
});

test("rejects a successful response issued for a different production hostname", () => {
  assert.equal(isValidTurnstileSiteverifyResponse({
    success: true,
    action: "create_booking",
    hostname: "attacker.example",
  }, productionOptions), false);
});

test("rejects malformed responses without throwing", () => {
  const malformedResponses = [
    null,
    [],
    "success",
    { success: "true", action: "create_booking", hostname: "booking.example.com" },
    { success: true, hostname: "booking.example.com" },
  ];

  for (const response of malformedResponses) {
    assert.equal(isValidTurnstileSiteverifyResponse(response, productionOptions), false);
  }
});
