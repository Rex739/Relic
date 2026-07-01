import { createHash } from "node:crypto";
import type { ReviewResult, SafetyCertificate } from "./types";

type CertificatePayload = Omit<SafetyCertificate, "receiptHash">;

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }

  return value;
}

export function stableSerialize(payload: unknown): string {
  return JSON.stringify(sortValue(payload));
}

export function hashCertificatePayload(payload: CertificatePayload): string {
  return createHash("sha256").update(stableSerialize(payload)).digest("hex");
}

export function createSafetyCertificate(review: Omit<ReviewResult, "certificate">): SafetyCertificate {
  const failedTests = review.regressionResults.filter((result) => result.status === "failed");
  const affectedAccountCount = failedTests.reduce((total, result) => total + (result.affectedAccounts ?? 0), 0);
  const evidenceReferences = review.evidence.map((item) => item.id).sort();

  const payload: CertificatePayload = {
    reviewId: review.reviewId,
    systemName: review.changeRequest.systemName,
    requestedChange: review.changeRequest.requestedChange,
    finalDecision: review.decision,
    riskLevel: failedTests.some((result) => result.severity === "critical") ? "critical" : "medium",
    impactedComponentCount: review.impactAnalysis.impactedComponents.length,
    criticalComponentCount: review.impactAnalysis.criticalComponentCount,
    failedTestCount: failedTests.length,
    affectedAccountCount,
    requiredHumanSignOffs: review.requiredHumanSignOffs,
    generatedTimestamp: "2026-07-01T09:14:00.000Z",
    evidenceReferences,
  };

  return {
    ...payload,
    receiptHash: hashCertificatePayload(payload),
  };
}
