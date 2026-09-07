import test from "node:test";
import assert from "node:assert/strict";
import { decideMigration } from "./yieldDecision.js";

const now = new Date("2026-09-07T12:00:00.000Z");

test("migrates only after costs and threshold", () => {
  const decision = decideMigration({
    source: { observedAt: now, supplyApyBps: 300n, availableLiquidityBaseUnits: 1_000n },
    target: { observedAt: now, supplyApyBps: 500n, availableLiquidityBaseUnits: 1_000n },
    amountBaseUnits: 100n, estimatedCostBps: 50n, minimumAdvantageBps: 100n, maxObservationAgeSeconds: 60, now,
  });
  assert.equal(decision.action, "migrate");
  assert.equal(decision.netAdvantageBps, 150n);
});

test("holds when market data is stale", () => {
  const decision = decideMigration({
    source: { observedAt: new Date("2026-09-07T11:58:00.000Z"), supplyApyBps: 300n, availableLiquidityBaseUnits: 1_000n },
    target: { observedAt: now, supplyApyBps: 900n, availableLiquidityBaseUnits: 1_000n },
    amountBaseUnits: 100n, estimatedCostBps: 0n, minimumAdvantageBps: 1n, maxObservationAgeSeconds: 60, now,
  });
  assert.deepEqual(decision, { action: "hold", reason: "yield evidence is stale", netAdvantageBps: 0n });
});
