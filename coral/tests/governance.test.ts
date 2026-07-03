import { describe, expect, it } from "vitest";
import {
  CANONICAL_MERIDIAN_REQUEST,
  ROLE_BOUNDARIES,
  evaluateReleasePolicy,
  normalizeRelicReviewResult,
  reviewEndpoint,
  validateEvidencePackage,
  validateMeridianRequest,
} from "../lib/governance.mjs";

const blockedReview = {
  reviewId: "REL-MER-2026-0701-001",
  decision: "BLOCKED",
  affectedAccountCount: 842,
  requiredHumanSignOffs: ["Finance Systems Owner", "Billing Policy Lead"],
  impactAnalysis: {
    impactedComponents: Array.from({ length: 8 }, (_, index) => ({ id: `component-${index}` })),
    criticalPathCount: 5,
  },
  regressionResults: [
    { id: "passed-1", status: "passed" },
    { id: "failed-1", status: "failed" },
  ],
  certificate: {
    receiptHash: "review-evidence-digest",
  },
};

describe("CoralOS Relic governance adapters", () => {
  it("validates the canonical Meridian request payload", () => {
    expect(validateMeridianRequest(CANONICAL_MERIDIAN_REQUEST)).toBe(CANONICAL_MERIDIAN_REQUEST);
    expect(() => validateMeridianRequest("Review something else")).toThrow(/canonical Meridian Grid/);
  });

  it("uses the existing Relic review endpoint without inventing a new path", () => {
    expect(reviewEndpoint("https://relic-brown.vercel.app")).toBe("https://relic-brown.vercel.app/api/review/run");
  });

  it("normalizes valid BLOCKED Relic evidence", () => {
    expect(normalizeRelicReviewResult(blockedReview)).toMatchObject({
      reviewId: "REL-MER-2026-0701-001",
      verdict: "BLOCKED",
      impactedComponents: 8,
      criticalPaths: 5,
      failedRegressionCount: 1,
      affectedAccounts: 842,
      evidenceDigest: "review-evidence-digest",
      requiredSignOffs: ["Finance Systems Owner", "Billing Policy Lead"],
    });
  });

  it("verification bridge rejects malformed or missing evidence", () => {
    expect(() => normalizeRelicReviewResult(null)).toThrow(/missing or malformed/);
    expect(() => validateEvidencePackage({ verdict: "BLOCKED" })).toThrow(/missing reviewId/);
  });

  it("verification bridge rejects a non-BLOCKED response for the Meridian demo", () => {
    expect(() => normalizeRelicReviewResult({ ...blockedReview, decision: "APPROVED" })).toThrow(/expects a BLOCKED/);
  });

  it("release policy guard returns REMEDIATION_REQUIRED for BLOCKED", () => {
    const evidence = normalizeRelicReviewResult(blockedReview);
    expect(evaluateReleasePolicy(evidence)).toMatchObject({
      result: "REMEDIATION_REQUIRED",
      releaseReady: false,
      message: "This blocked review cannot be released by an agent. A separate clean review is required after remediation.",
    });
  });

  it("release policy guard cannot return RELEASE_READY for BLOCKED", () => {
    const evidence = normalizeRelicReviewResult(blockedReview);
    expect(evaluateReleasePolicy(evidence).result).not.toBe("RELEASE_READY");
  });

  it("handles a missing workspace URL safely", () => {
    const evidence = normalizeRelicReviewResult(blockedReview, "");
    expect(evidence.workspaceUrl).toBeNull();
  });

  it("represents scoped agent role boundaries in typed code", () => {
    expect(ROLE_BOUNDARIES.reviewGovernor.mustNot).toContain("issue release approval");
    expect(ROLE_BOUNDARIES.verificationBridge.mustNot).toContain("call wallet or blockchain services");
    expect(ROLE_BOUNDARIES.releasePolicyGuard.mustNot).toContain("emit RELEASE_READY for BLOCKED");
  });
});
