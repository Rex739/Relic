import { describe, expect, it } from "vitest";

import { createLpRangeRebalancePlan } from "../src/rebalance.js";

describe("createLpRangeRebalancePlan", () => {
  const request = {
    chainId: 97 as const,
    pair: "BNB/USDT" as const,
    positionTokenId: "12345",
    capitalCap: "50",
    currentPrice: "700",
    currentLowerPrice: "620",
    currentUpperPrice: "680",
    rangeWidthBps: 1_000,
    durationHours: 24,
    lastRebalanceAt: null,
  };

  it("proposes a bounded replacement range only after price exits", () => {
    const plan = createLpRangeRebalancePlan(
      request,
      new Date("2026-09-06T00:00:00.000Z"),
    );
    expect(plan.decision).toBe("REBALANCE");
    expect(plan.proposedRange).toEqual({ lowerPrice: "630", upperPrice: "770" });
    expect(plan.minimumSecondsBetweenRebalances).toBe(3_600);
    expect(plan.executionSteps).toHaveLength(5);
  });

  it("holds while the position remains in range", () => {
    const plan = createLpRangeRebalancePlan({ ...request, currentPrice: "650" });
    expect(plan.decision).toBe("HOLD");
    expect(plan.executionSteps).toEqual([]);
  });

  it("holds during the one-hour cooldown", () => {
    const plan = createLpRangeRebalancePlan(
      { ...request, lastRebalanceAt: "2026-09-06T00:30:00.000Z" },
      new Date("2026-09-06T01:00:00.000Z"),
    );
    expect(plan.decision).toBe("HOLD");
    expect(plan.reason).toContain("cooldown");
  });
});
