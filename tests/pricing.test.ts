import { test } from "node:test";
import assert from "node:assert/strict";
import { estimate } from "../server/pricing.js";

test("pricing keeps Gemini variants, long contexts, and scheduled changes distinct", () => {
  assert.equal(estimate("gemini", "gemini-3.5-flash", 1000000, 1000000), 10.5);
  assert.equal(
    estimate("gemini", "gemini-3.5-flash-lite", 1000000, 1000000),
    2.8,
  );
  assert.equal(estimate("gemini", "gemini-2.5-pro", 200000, 1000), 0.26);
  assert.equal(estimate("gemini", "gemini-2.5-pro", 200001, 1000), 0.5150025);
  assert.equal(
    estimate(
      "gemini",
      "gemini-3.8-flash",
      1000000,
      1000000,
      new Date("2026-12-31T23:59:59Z"),
    ),
    4.5,
  );
  assert.equal(
    estimate(
      "gemini",
      "gemini-3.8-flash",
      1000000,
      1000000,
      new Date("2027-01-01T00:00:00Z"),
    ),
    9,
  );
  assert.equal(estimate("openai", "gpt-unknown", 100, 100), undefined);
  assert.equal(estimate("gemini", "gemini-flash-latest", 100, 100), undefined);
});
