import { describe, expect, it } from "vitest";

import {
  completionRateStats,
  sellerReadinessProjection,
  type SellerReadinessFacts,
} from "../src/marketplace.js";

describe("marketplace completion rate", () => {
  it("uses completed eligible accepted jobs as the numerator and denominator", () => {
    expect(
      completionRateStats({
        eligibleAcceptedJobs: 50,
        successfullyCompletedJobs: 47,
      }),
    ).toEqual({
      eligibleAcceptedJobCount: 50,
      completedCommerceJobCount: 47,
      completionRatePercent: 94,
    });
  });

  it("does not fabricate 100% when no eligible history exists", () => {
    expect(
      completionRateStats({
        eligibleAcceptedJobs: 0,
        successfullyCompletedJobs: 0,
      }).completionRatePercent,
    ).toBeNull();
  });

  it("counts accepted failures against completion", () => {
    expect(
      completionRateStats({
        eligibleAcceptedJobs: 2,
        successfullyCompletedJobs: 1,
      }).completionRatePercent,
    ).toBe(50);
  });

  it("rejects impossible or negative history", () => {
    expect(() =>
      completionRateStats({
        eligibleAcceptedJobs: 1,
        successfullyCompletedJobs: 2,
      }),
    ).toThrow(/Invalid completion-rate history/);
  });
});

const readyFacts: SellerReadinessFacts = {
  agentId: "01945b1e-7e80-7000-8000-000000000001",
  serviceId: "01945b1e-7e80-7000-8000-000000000002",
  name: "Production monitor",
  description: "Monitors lending risk.",
  imageUrl: null,
  category: "health-factor-monitoring",
  chainId: 97,
  externalAgentId: "1840",
  identityVerified: true,
  serviceAvailable: true,
  verificationPassed: true,
  lastVerifiedAt: "2026-08-27T12:00:00.000Z",
  commerceValidated: true,
  activeOffer: true,
  publicEligible: true,
};

describe("seller marketplace readiness", () => {
  it("projects a fully eligible agent as public and hireable", () => {
    expect(sellerReadinessProjection(readyFacts)).toMatchObject({
      marketplaceStatus: "PUBLIC",
      hireable: true,
      requirements: {
        identity: { state: "complete" },
        service: { state: "complete" },
        verification: { state: "complete" },
        commerce: { state: "complete" },
        offer: { state: "complete" },
      },
    });
  });

  it.each([
    ["verificationPassed", false, "verification"],
    ["commerceValidated", false, "commerce"],
    ["activeOffer", false, "offer"],
  ] as const)(
    "keeps an agent out of hireability when %s is incomplete",
    (field, value, requirement) => {
      const result = sellerReadinessProjection({
        ...readyFacts,
        [field]: value,
        publicEligible: false,
      });
      expect(result.hireable).toBe(false);
      expect(result.requirements[requirement].state).not.toBe("complete");
    },
  );

  it("never promotes an explicitly labelled test deployment", () => {
    const result = sellerReadinessProjection({
      ...readyFacts,
      name: "Grid Trader — test deployment",
      description: "Not for production use.",
    });
    expect(result).toMatchObject({
      testDeployment: true,
      marketplaceStatus: "NOT_READY",
      hireable: false,
    });
  });
});
