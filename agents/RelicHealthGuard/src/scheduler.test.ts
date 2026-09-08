import assert from "node:assert/strict";
import test from "node:test";
import { deliveryId, HealthGuardScheduler } from "./scheduler.js";

test("uses the same delivery ID for safe retries within a schedule slot", () => {
  assert.equal(deliveryId("8183", 42), deliveryId("8183", 42));
  assert.notEqual(deliveryId("8183", 42), deliveryId("8183", 43));
});

test("continues isolated jobs when one delivery requires recovery", async () => {
  const calls: string[] = [];
  const scheduler = new HealthGuardScheduler(
    { list: async () => ["1", "2"] },
    { runCycle: async ({ commerceJobId }) => {
      calls.push(commerceJobId);
      return commerceJobId === "1" ? { status: 409, body: {} } : { status: 200, body: {} };
    } },
    { pollSeconds: 60 },
    () => new Date("2026-09-08T00:00:00.000Z"),
  );
  assert.deepEqual(await scheduler.tick(), { attempted: 2, succeeded: 1, recoveryRequired: 1, failed: 0 });
  assert.deepEqual(calls, ["1", "2"]);
});
