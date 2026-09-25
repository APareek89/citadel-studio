import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCase } from "../server/workflows.js";
import { addCredential, redact } from "../server/providers.js";
test("deterministic assertion failures differ from infrastructure errors", () => {
  assert.deepEqual(
    checkCase(
      {
        id: "a",
        input: "x",
        assertions: [
          { type: "contains", value: "hello" },
          { type: "not-contains", value: "forbidden" },
        ],
      },
      "Hello world",
    ),
    [],
  );
  assert.equal(
    checkCase(
      {
        id: "a",
        input: "x",
        assertions: [{ type: "contains", value: "hello" }],
      },
      "bye",
    ).length,
    1,
  );
});
test("malicious regex cannot monopolize server", () => {
  const start = Date.now();
  assert.throws(
    () =>
      checkCase(
        {
          id: "a",
          input: "x",
          assertions: [{ type: "regex", value: "(a+)+$" }],
        },
        "a".repeat(30000) + "!",
      ),
    /time limit/,
  );
  assert.ok(Date.now() - start < 1000);
});
test("credential values are redacted from stored evidence", () => {
  const secret = "workbench-unit-secret-123456789";
  const c = addCredential("gemini", "test", secret);
  assert.ok(!JSON.stringify(c).includes(secret));
  assert.equal(
    redact("provider echoed " + secret),
    "provider echoed [REDACTED]",
  );
});
