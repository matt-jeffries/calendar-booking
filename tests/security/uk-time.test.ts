import test from "node:test";
import assert from "node:assert/strict";
import { ukLocalToUtcIso } from "../../lib/client-time.ts";

test("UK winter wall time converts to GMT", () => {
  assert.equal(ukLocalToUtcIso("2026-01-16T16:00:00"), "2026-01-16T16:00:00.000Z");
});

test("UK summer wall time converts to BST", () => {
  assert.equal(ukLocalToUtcIso("2026-07-16T16:00:00"), "2026-07-16T15:00:00.000Z");
});

test("UK daylight-saving boundaries use the correct offset", () => {
  assert.equal(ukLocalToUtcIso("2026-03-29T08:00:00"), "2026-03-29T07:00:00.000Z");
  assert.equal(ukLocalToUtcIso("2026-10-25T08:00:00"), "2026-10-25T08:00:00.000Z");
});
