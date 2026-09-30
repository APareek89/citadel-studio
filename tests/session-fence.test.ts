import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionFence } from "../web/session-fence.js";

test("delayed account-A 401 cannot expire account B after logout and login", async () => {
  const fence = createSessionFence();
  let visibleOwner: string | null = "account-a";
  fence.accept(visibleOwner);
  const fromA = fence.capture();
  let resolveOldRequest!: () => void;
  const oldRequest = new Promise<void>(resolve => { resolveOldRequest = resolve; }).then(() =>
    fence.runIfCurrent(fromA, () => { visibleOwner = null; fence.accept(null); }),
  );
  visibleOwner = null; fence.accept(null);
  visibleOwner = "account-b"; fence.accept(visibleOwner);
  resolveOldRequest();
  assert.equal(await oldRequest, false);
  assert.equal(visibleOwner, "account-b");
});

test("same-account session refresh keeps legitimate current-session 401 effective", () => {
  const fence = createSessionFence();
  fence.accept("account-b");
  const request = fence.capture();
  fence.accept("account-b");
  let expired = 0;
  assert.equal(fence.runIfCurrent(request, () => { expired++; fence.accept(null); }), true);
  assert.equal(expired, 1);
  assert.equal(fence.runIfCurrent(request, () => expired++), false);
  assert.equal(expired, 1);
});

test("returning to the same account does not revive requests from its earlier session", () => {
  const fence = createSessionFence();
  fence.accept("account-a");
  const oldRequest = fence.capture();
  fence.accept(null); fence.accept("account-a");
  assert.equal(fence.runIfCurrent(oldRequest, () => assert.fail("stale request expired new session")), false);
  assert.equal(fence.runIfCurrent(fence.capture(), () => {}), true);
});
