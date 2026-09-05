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
  verifiedPrice: {
    chainId: 97,
    tokenAddress: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
    decimals: 18,
    amountBaseUnits: "1000000000",
    symbol: "U",
  },
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
        commerce: { state: "complete", label: "Commerce history available" },
        offer: { state: "complete" },
      },
    });
  });

  it.each([
    ["verificationPassed", false, "verification"],
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

  it("does not require commerce history before an agent is hireable", () => {
    const result = sellerReadinessProjection({
      ...readyFacts,
      commerceValidated: false,
      activeOffer: true,
      publicEligible: true,
    });
    expect(result).toMatchObject({
      hireable: true,
      requirements: {
        commerce: {
          state: "complete",
          label: "Commerce history starts after hiring",
        },
        offer: { state: "complete" },
      },
    });
  });

  it("keeps service inspection Relic-managed when a newly claimed agent has not been checked", () => {
    const result = sellerReadinessProjection({
      ...readyFacts,
      serviceAvailable: false,
      verificationPassed: false,
      lastVerifiedAt: null,
      commerceValidated: false,
      activeOffer: false,
      publicEligible: false,
    });

    expect(result.requirements.service).toMatchObject({
      state: "attention",
      label: "Relic is checking the service",
      nextAction: "Relic check in progress",
    });
    expect(result.requirements.verification).toMatchObject({
      label: "Relic has not checked the service yet",
      nextAction: "Waiting for Relic’s check",
    });
    expect(result.requirements.service.explanation).not.toMatch(/document/i);
    expect(result.requirements.service.nextAction).not.toMatch(/publish/i);
  });

  it("fails closed when no verified seller price is available", () => {
    const result = sellerReadinessProjection({
      ...readyFacts,
      verifiedPrice: null,
      commerceValidated: false,
      activeOffer: false,
      publicEligible: true,
    });
    expect(result).toMatchObject({
      hireable: false,
      requirements: {
        offer: {
          state: "blocked",
          nextAction: "Waiting for verified seller quote",
        },
      },
    });
  });

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

  it("uses the canonical buyer-facing hireability result when supplied", () => {
    const result = sellerReadinessProjection({
      ...readyFacts,
      activeOffer: true,
      listingIsHireable: true,
      publicEligible: true,
      marketplaceHireable: false,
    });
    expect(result.hireable).toBe(false);
  });
});
