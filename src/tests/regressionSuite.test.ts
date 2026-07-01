import { describe, expect, it } from "vitest";
import { runRegressionSuite } from "@/lib/relic/regressionSuite";

describe("regression suite", () => {
  it("detects the critical duplicate-charge condition", () => {
    const results = runRegressionSuite();
    const duplicateCharge = results.find((result) => result.id === "commercial-volume-discount-duplicate");

    expect(duplicateCharge).toBeDefined();
    expect(duplicateCharge?.status).toBe("failed");
    expect(duplicateCharge?.severity).toBe("critical");
    expect(duplicateCharge?.affectedAccounts).toBe(842);
    expect(duplicateCharge?.details).toContain("duplicate-charge condition");
  });
});
