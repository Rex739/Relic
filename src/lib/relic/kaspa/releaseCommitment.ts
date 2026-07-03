import { createHash } from "node:crypto";
import { stableSerialize } from "../receipt";
import type { ReviewDecision } from "../types";

export type CommitmentStatus =
  | "AWAITING_ACKNOWLEDGEMENTS"
  | "FINANCE_ACKNOWLEDGED"
  | "REMEDIATION_REQUIRED"
  | "RELEASE_READY"
  | "SUPERSEDED";

export type CommitmentRole =
  | "FINANCE_SYSTEMS_OWNER"
  | "BILLING_POLICY_LEAD"
  | "RELIC_REVIEW_ATTESTOR";

export type KaspaNetwork = "KASPA_TESTNET_12";
export type CovenantStatus = "NOT_DEPLOYED" | "PROTOTYPE_ONLY" | "COMMITTED";

export interface ReleaseCommitment {
  commitmentId: string;
  reviewId: string;
  reviewVerdict: ReviewDecision;
  evidenceDigest: string;
  remediationDigest: string | null;
  createdAt: string;
  updatedAt: string;
  requiredApprovers: CommitmentRole[];
  financeAcknowledgedAt: string | null;
  billingAcknowledgedAt: string | null;
  commitmentStatus: CommitmentStatus;
  kaspaNetwork: KaspaNetwork;
  covenantStatus: CovenantStatus;
  transactionId: string | null;
  sourceCommitmentId: string | null;
  supersededByCommitmentId: string | null;
}

export type ReleaseCommitmentEvent =
  | {
      type: "FINANCE_ACKNOWLEDGE";
      actorRole: "FINANCE_SYSTEMS_OWNER";
      occurredAt: string;
    }
  | {
      type: "BILLING_ACKNOWLEDGE";
      actorRole: "BILLING_POLICY_LEAD";
      occurredAt: string;
    }
  | {
      type: "MARK_RELEASE_READY";
      actorRole: "RELIC_REVIEW_ATTESTOR";
      occurredAt: string;
      remediationDigest: string;
    }
  | {
      type: "SUPERSEDE";
      actorRole: "RELIC_REVIEW_ATTESTOR";
      occurredAt: string;
      supersedingCommitment: ReleaseCommitment;
    };

export type ReleaseCommitmentErrorCode =
  | "ROLE_NOT_AUTHORIZED"
  | "FINANCE_ALREADY_ACKNOWLEDGED"
  | "BILLING_REQUIRES_FINANCE_ACKNOWLEDGEMENT"
  | "BILLING_ALREADY_ACKNOWLEDGED"
  | "BLOCKED_COMMITMENT_CANNOT_BECOME_RELEASE_READY"
  | "ONLY_RELEASE_READY_COMMITMENTS_CAN_SUPERSEDE"
  | "SUPERSEDING_COMMITMENT_MUST_BE_DISTINCT"
  | "SUPERSEDING_COMMITMENT_MUST_REFERENCE_SOURCE"
  | "COMMITMENT_ALREADY_SUPERSEDED"
  | "INVALID_TRANSITION";

export type ReleaseCommitmentTransitionResult =
  | {
      ok: true;
      commitment: ReleaseCommitment;
    }
  | {
      ok: false;
      commitment: ReleaseCommitment;
      error: {
        code: ReleaseCommitmentErrorCode;
        message: string;
      };
    };

export interface ReviewEvidenceSummary {
  reviewId: string;
  reviewVerdict: ReviewDecision;
  finding: string;
  impactedComponentCount: number;
  criticalPathCount: number;
  failedRegressionTestCount: number;
  affectedAccountCount: number;
}

const MERIDIAN_CREATED_AT = "2026-07-01T09:14:00.000Z";
const CLEAN_REVIEW_CREATED_AT = "2026-07-02T10:30:00.000Z";
const KASPA_NETWORK: KaspaNetwork = "KASPA_TESTNET_12";
const REQUIRED_BLOCKED_APPROVERS: CommitmentRole[] = ["FINANCE_SYSTEMS_OWNER", "BILLING_POLICY_LEAD"];
const RELEASE_ATTESTOR: CommitmentRole[] = ["RELIC_REVIEW_ATTESTOR"];

export const meridianGridBlockedEvidence: ReviewEvidenceSummary = {
  reviewId: "REL-MER-2026-0701-001",
  reviewVerdict: "BLOCKED",
  finding: "Duplicate-charge condition detected.",
  impactedComponentCount: 8,
  criticalPathCount: 5,
  failedRegressionTestCount: 1,
  affectedAccountCount: 842,
};

export const meridianGridCleanEvidence: ReviewEvidenceSummary = {
  reviewId: "REL-MER-2026-0702-002",
  reviewVerdict: "APPROVED",
  finding: "Duplicate-charge condition remediated and regression suite passed.",
  impactedComponentCount: 8,
  criticalPathCount: 5,
  failedRegressionTestCount: 0,
  affectedAccountCount: 0,
};

function digest(payload: unknown): string {
  return createHash("sha256").update(stableSerialize(payload)).digest("hex");
}

function commitmentId(prefix: string, payload: unknown): string {
  return `${prefix}-${digest(payload).slice(0, 16).toUpperCase()}`;
}

function fail(
  commitment: ReleaseCommitment,
  code: ReleaseCommitmentErrorCode,
  message: string,
): ReleaseCommitmentTransitionResult {
  return {
    ok: false,
    commitment,
    error: { code, message },
  };
}

export function createBlockedMeridianCommitment(): ReleaseCommitment {
  const evidenceDigest = digest(meridianGridBlockedEvidence);

  return {
    commitmentId: commitmentId("KASPA-REL-MER-BLOCKED", {
      reviewId: meridianGridBlockedEvidence.reviewId,
      evidenceDigest,
    }),
    reviewId: meridianGridBlockedEvidence.reviewId,
    reviewVerdict: "BLOCKED",
    evidenceDigest,
    remediationDigest: null,
    createdAt: MERIDIAN_CREATED_AT,
    updatedAt: MERIDIAN_CREATED_AT,
    requiredApprovers: REQUIRED_BLOCKED_APPROVERS,
    financeAcknowledgedAt: null,
    billingAcknowledgedAt: null,
    commitmentStatus: "AWAITING_ACKNOWLEDGEMENTS",
    kaspaNetwork: KASPA_NETWORK,
    covenantStatus: "PROTOTYPE_ONLY",
    transactionId: null,
    sourceCommitmentId: null,
    supersededByCommitmentId: null,
  };
}

export function createCleanReviewCommitment(source: ReleaseCommitment): ReleaseCommitment {
  const remediationDigest = digest({
    sourceCommitmentId: source.commitmentId,
    cleanReview: meridianGridCleanEvidence,
  });
  const evidenceDigest = digest(meridianGridCleanEvidence);

  return {
    commitmentId: commitmentId("KASPA-REL-MER-CLEAN", {
      reviewId: meridianGridCleanEvidence.reviewId,
      evidenceDigest,
      remediationDigest,
      sourceCommitmentId: source.commitmentId,
    }),
    reviewId: meridianGridCleanEvidence.reviewId,
    reviewVerdict: "APPROVED",
    evidenceDigest,
    remediationDigest,
    createdAt: CLEAN_REVIEW_CREATED_AT,
    updatedAt: CLEAN_REVIEW_CREATED_AT,
    requiredApprovers: RELEASE_ATTESTOR,
    financeAcknowledgedAt: null,
    billingAcknowledgedAt: null,
    commitmentStatus: "RELEASE_READY",
    kaspaNetwork: KASPA_NETWORK,
    covenantStatus: "PROTOTYPE_ONLY",
    transactionId: null,
    sourceCommitmentId: source.commitmentId,
    supersededByCommitmentId: null,
  };
}

export function transitionReleaseCommitment(
  commitment: ReleaseCommitment,
  event: ReleaseCommitmentEvent,
): ReleaseCommitmentTransitionResult {
  if (commitment.commitmentStatus === "SUPERSEDED") {
    return fail(commitment, "COMMITMENT_ALREADY_SUPERSEDED", "A superseded commitment is immutable.");
  }

  if (event.type === "FINANCE_ACKNOWLEDGE") {
    if (event.actorRole !== "FINANCE_SYSTEMS_OWNER") {
      return fail(commitment, "ROLE_NOT_AUTHORIZED", "Only the Finance Systems Owner can acknowledge finance risk.");
    }

    if (commitment.financeAcknowledgedAt) {
      return fail(commitment, "FINANCE_ALREADY_ACKNOWLEDGED", "Finance acknowledgement has already been recorded.");
    }

    if (commitment.commitmentStatus !== "AWAITING_ACKNOWLEDGEMENTS") {
      return fail(commitment, "INVALID_TRANSITION", "Finance acknowledgement is only valid from awaiting acknowledgements.");
    }

    return {
      ok: true,
      commitment: {
        ...commitment,
        financeAcknowledgedAt: event.occurredAt,
        updatedAt: event.occurredAt,
        commitmentStatus: "FINANCE_ACKNOWLEDGED",
      },
    };
  }

  if (event.type === "BILLING_ACKNOWLEDGE") {
    if (event.actorRole !== "BILLING_POLICY_LEAD") {
      return fail(commitment, "ROLE_NOT_AUTHORIZED", "Only the Billing Policy Lead can acknowledge billing policy risk.");
    }

    if (!commitment.financeAcknowledgedAt || commitment.commitmentStatus === "AWAITING_ACKNOWLEDGEMENTS") {
      return fail(
        commitment,
        "BILLING_REQUIRES_FINANCE_ACKNOWLEDGEMENT",
        "Billing acknowledgement requires a prior finance acknowledgement.",
      );
    }

    if (commitment.billingAcknowledgedAt) {
      return fail(commitment, "BILLING_ALREADY_ACKNOWLEDGED", "Billing acknowledgement has already been recorded.");
    }

    if (commitment.commitmentStatus !== "FINANCE_ACKNOWLEDGED") {
      return fail(commitment, "INVALID_TRANSITION", "Billing acknowledgement is only valid after finance acknowledgement.");
    }

    return {
      ok: true,
      commitment: {
        ...commitment,
        billingAcknowledgedAt: event.occurredAt,
        updatedAt: event.occurredAt,
        commitmentStatus: "REMEDIATION_REQUIRED",
      },
    };
  }

  if (event.type === "MARK_RELEASE_READY") {
    if (event.actorRole !== "RELIC_REVIEW_ATTESTOR") {
      return fail(commitment, "ROLE_NOT_AUTHORIZED", "Only the Relic review attestor can mark a clean commitment release ready.");
    }

    if (commitment.reviewVerdict === "BLOCKED") {
      return fail(
        commitment,
        "BLOCKED_COMMITMENT_CANNOT_BECOME_RELEASE_READY",
        "A blocked commitment cannot transition directly to release ready. Create a separate clean-review commitment.",
      );
    }

    return {
      ok: true,
      commitment: {
        ...commitment,
        remediationDigest: event.remediationDigest,
        updatedAt: event.occurredAt,
        commitmentStatus: "RELEASE_READY",
      },
    };
  }

  if (event.actorRole !== "RELIC_REVIEW_ATTESTOR") {
    return fail(commitment, "ROLE_NOT_AUTHORIZED", "Only the Relic review attestor can supersede a blocked commitment.");
  }

  if (event.supersedingCommitment.commitmentStatus !== "RELEASE_READY") {
    return fail(
      commitment,
      "ONLY_RELEASE_READY_COMMITMENTS_CAN_SUPERSEDE",
      "A blocked commitment can only be superseded by a separate release-ready commitment.",
    );
  }

  if (event.supersedingCommitment.commitmentId === commitment.commitmentId) {
    return fail(
      commitment,
      "SUPERSEDING_COMMITMENT_MUST_BE_DISTINCT",
      "A clean commitment must not reuse the original blocked commitment ID.",
    );
  }

  if (event.supersedingCommitment.sourceCommitmentId !== commitment.commitmentId) {
    return fail(
      commitment,
      "SUPERSEDING_COMMITMENT_MUST_REFERENCE_SOURCE",
      "The superseding commitment must reference the blocked source commitment.",
    );
  }

  return {
    ok: true,
    commitment: {
      ...commitment,
      updatedAt: event.occurredAt,
      commitmentStatus: "SUPERSEDED",
      supersededByCommitmentId: event.supersedingCommitment.commitmentId,
    },
  };
}
