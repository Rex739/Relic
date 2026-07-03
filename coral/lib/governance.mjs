import { createHash } from "node:crypto";

export const CANONICAL_MERIDIAN_REQUEST =
  "Review Meridian Grid’s proposed 7% regulatory surcharge for commercial customers above 10,000 kWh. Check for billing and ledger regression risk.";

export const DEFAULT_RELIC_API_BASE_URL = "https://relic-brown.vercel.app";
export const DEFAULT_RELIC_WORKSPACE_URL = "https://relic-brown.vercel.app/review/meridian-billing";
export const REVIEW_ENDPOINT_PATH = "/api/review/run";

export const ROLE_BOUNDARIES = Object.freeze({
  reviewGovernor: Object.freeze({
    may: ["create isolated review thread", "delegate evidence verification", "request policy guard decision"],
    mustNot: ["issue release approval", "set RELEASE_READY", "acknowledge for human owners", "modify review findings"],
  }),
  verificationBridge: Object.freeze({
    may: ["call existing Relic review endpoint", "return deterministic review evidence"],
    mustNot: ["produce release approval", "mutate review response", "access secrets", "call wallet or blockchain services"],
  }),
  releasePolicyGuard: Object.freeze({
    may: ["evaluate verified evidence", "emit constrained governance conclusion"],
    mustNot: ["emit RELEASE_READY for BLOCKED", "issue release approval", "modify Kaspa state", "submit transactions"],
  }),
});

export function validateMeridianRequest(request) {
  if (typeof request !== "string" || request.trim().length === 0) {
    throw new Error("Meridian governance request is required.");
  }

  if (request !== CANONICAL_MERIDIAN_REQUEST) {
    throw new Error("Only the canonical Meridian Grid review request is supported by this local demo.");
  }

  return request;
}

export function reviewEndpoint(baseUrl = DEFAULT_RELIC_API_BASE_URL) {
  const parsed = new URL(baseUrl);
  parsed.pathname = REVIEW_ENDPOINT_PATH;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function normalizeRelicReviewResult(review, workspaceUrl = DEFAULT_RELIC_WORKSPACE_URL) {
  if (!review || typeof review !== "object") {
    throw new Error("Relic review response is missing or malformed.");
  }

  const failedRegressionCount = Array.isArray(review.regressionResults)
    ? review.regressionResults.filter((result) => result?.status === "failed").length
    : undefined;
  const impactedComponents = review.impactAnalysis?.impactedComponents?.length;
  const criticalPaths = review.impactAnalysis?.criticalPathCount;
  const requiredSignOffs = review.requiredHumanSignOffs;

  const evidence = {
    reviewId: review.reviewId,
    verdict: review.decision,
    impactedComponents,
    criticalPaths,
    failedRegressionCount,
    affectedAccounts: review.affectedAccountCount,
    evidenceDigest: review.certificate?.receiptHash ?? deterministicDigest(review),
    requiredSignOffs,
    workspaceUrl: workspaceUrl || null,
  };

  validateEvidencePackage(evidence);
  return evidence;
}

export function validateEvidencePackage(evidence) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error("Evidence package is missing.");
  }

  const required = ["reviewId", "verdict", "impactedComponents", "criticalPaths", "failedRegressionCount", "affectedAccounts"];
  for (const key of required) {
    if (evidence[key] === undefined || evidence[key] === null || evidence[key] === "") {
      throw new Error(`Evidence package is missing ${key}.`);
    }
  }

  if (evidence.reviewId !== "REL-MER-2026-0701-001") {
    throw new Error("Unexpected review id for Meridian governance demo.");
  }

  if (evidence.verdict !== "BLOCKED") {
    throw new Error("Meridian governance demo expects a BLOCKED deterministic review result.");
  }

  if (
    evidence.impactedComponents !== 8 ||
    evidence.criticalPaths !== 5 ||
    evidence.failedRegressionCount !== 1 ||
    evidence.affectedAccounts !== 842
  ) {
    throw new Error("Meridian governance evidence does not match the deterministic Relic review result.");
  }

  if (!Array.isArray(evidence.requiredSignOffs) || evidence.requiredSignOffs.length < 2) {
    throw new Error("Evidence package must include required human sign-offs.");
  }

  if (!evidence.requiredSignOffs.includes("Finance Systems Owner") || !evidence.requiredSignOffs.includes("Billing Policy Lead")) {
    throw new Error("Evidence package is missing required Meridian sign-off roles.");
  }

  return true;
}

export function evaluateReleasePolicy(evidence) {
  validateEvidencePackage(evidence);

  if (evidence.verdict === "BLOCKED") {
    return {
      result: "REMEDIATION_REQUIRED",
      releaseReady: false,
      message: "This blocked review cannot be released by an agent. A separate clean review is required after remediation.",
      requiredHumanOwners: ["Finance Systems Owner", "Billing Policy Lead"],
    };
  }

  return {
    result: "HUMAN_ACKNOWLEDGEMENT_REQUIRED",
    releaseReady: false,
    message: "A human release owner must review the verified evidence before release approval.",
    requiredHumanOwners: evidence.requiredSignOffs,
  };
}

export async function fetchRelicEvidence({ baseUrl = DEFAULT_RELIC_API_BASE_URL, workspaceUrl = DEFAULT_RELIC_WORKSPACE_URL, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(reviewEndpoint(baseUrl), { method: "POST" });
  if (!response.ok) {
    throw new Error(`Relic review endpoint returned HTTP ${response.status}.`);
  }

  return normalizeRelicReviewResult(await response.json(), workspaceUrl);
}

function deterministicDigest(payload) {
  return createHash("sha256").update(stableSerialize(payload)).digest("hex");
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
