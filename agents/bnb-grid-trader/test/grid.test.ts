import { describe, expect, it } from "vitest";

import { createGridPlan } from "../src/grid.js";

describe("createGridPlan", () => {
  const request = {
    chainId: 97 as const,
    pair: "BNB/USDT" as const,
    capitalCap: "25",
    lowerPrice: "550",
    upperPrice: "700",
    gridLevels: 6,
    durationHours: 24,
  };

  it("creates bounded, evenly spaced price levels", () => {
    const plan = createGridPlan(request, new Date("2026-09-05T00:00:00.000Z"));
    expect(plan.levels).toEqual(["550", "580", "610", "640", "670", "700"]);
    expect(plan.priceStep).toBe("30");
    expect(plan.maximumExecutions).toBe(12);
    expect(plan.minimumSecondsBetweenExecutions).toBe(900);
    expect(plan.expiresAt).toBe("2026-09-06T00:00:00.000Z");
  });

  it("rejects an unsafe price range", () => {
    expect(() => createGridPlan({ ...request, upperPrice: "550" })).toThrow(
      "Upper price must be greater than lower price",
    );
  });

  it("accepts values posted from an HTML requirements form", () => {
    const plan = createGridPlan({
      ...request,
      gridLevels: "5",
      durationHours: "4",
    });
    expect(plan.gridLevels).toBe(5);
    expect(plan.levels).toHaveLength(5);
  });
});
