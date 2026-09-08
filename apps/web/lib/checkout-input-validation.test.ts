import { describe, expect, it } from "vitest";

import { checkoutInputSchemaFor, yieldOptimizerCheckoutSchema } from "./checkout-input-validation";

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
