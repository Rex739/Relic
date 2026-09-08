import { describe, expect, it } from "vitest";

import { checkoutInputSchemaFor, healthGuardCheckoutSchema, yieldOptimizerCheckoutSchema } from "./checkout-input-validation";

describe("Yield Optimizer checkout limits", () => {
  const valid = {
    capitalCap: "1",
    executionAmount: "0.1",
    maxFeeBnb: "0.0001",
    durationHours: "2",
  };

  it("accepts a bounded, tiny testnet execution", () => {
    expect(yieldOptimizerCheckoutSchema.safeParse(valid).success).toBe(true);
    expect(checkoutInputSchemaFor("yield-optimisation")).toBe(yieldOptimizerCheckoutSchema);
  });

  it("rejects an execution that exceeds the buyer's supply cap", () => {
    const result = yieldOptimizerCheckoutSchema.safeParse({
      ...valid,
      executionAmount: "1.000000000000000001",
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toContain("cannot exceed");
  });
});

describe("Health Guard checkout limits", () => {
  const valid = {
    threshold: "1.20", target: "1.50", maximumRepay: "25", aggregateRepayLimit: "100",
    maxFeeBnb: "0.002", durationHours: "168",
  };

  it("accepts bounded Mainnet repayment settings", () => {
    expect(healthGuardCheckoutSchema.safeParse(valid).success).toBe(true);
    expect(checkoutInputSchemaFor("health-factor-monitoring", true)).toBe(healthGuardCheckoutSchema);
  });

  it("rejects a target below the trigger and an aggregate cap below one action", () => {
    const result = healthGuardCheckoutSchema.safeParse({ ...valid, target: "1.20", aggregateRepayLimit: "24" });
    expect(result.success).toBe(false);
  });
});
