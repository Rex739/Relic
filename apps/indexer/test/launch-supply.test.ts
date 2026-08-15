import type { ScanAgent } from "@relic/blockchain";
import { describe, expect, it } from "vitest";

import {
  assertCandidateTransition,
  targetedCategoryEvidence,
  verificationLevelRank,
} from "../src/launch-supply.js";

const agent = (overrides: Partial<ScanAgent> = {}): ScanAgent => ({
  id: "scan-1",
  token_id: "1",
  chain_id: 56,
  contract_address: `0x${"1".repeat(40)}`,
  supported_protocols: [],
  ...overrides,
});

describe("launch supply evidence and state boundaries", () => {
  it("retains semantic-only search results as research leads", () => {
    expect(
      targetedCategoryEvidence(
        agent({ name: "General assistant", description: "Research helper" }),
        "grid-trading",
      ),
    ).toEqual({ confidence: "research-lead", matched: [] });
  });

  it("accepts explicit category evidence without making it actionable", () => {
    expect(
      targetedCategoryEvidence(
        agent({ name: "Health Factor Monitor" }),
        "health-factor-monitoring",
      ).confidence,
    ).toBe("medium");
  });

  it("rejects lifecycle jumps and orders verification levels", () => {
    expect(() =>
      assertCandidateTransition("REVIEW_PENDING", "ACTIONABLE"),
    ).toThrow(/Invalid launch-candidate transition/);
    expect(() =>
      assertCandidateTransition("SERVICE_IDENTIFIED", "SERVICE_OBSERVED"),
    ).not.toThrow();
    expect(() =>
      assertCandidateTransition("ACTIONABLE", "STALE"),
    ).not.toThrow();
    expect(verificationLevelRank("PAYMENT_UNDERSTOOD")).toBeGreaterThan(
      verificationLevelRank("ENDPOINT_OBSERVED"),
    );
  });
});
