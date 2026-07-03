import { describe, expect, it } from "vitest";
import {
  createBlockedMeridianCommitment,
  createCleanReviewCommitment,
  transitionReleaseCommitment,
  type ReleaseCommitment,
} from "@/lib/relic/kaspa/releaseCommitment";

const financeAcknowledgement = {
  type: "FINANCE_ACKNOWLEDGE",
  actorRole: "FINANCE_SYSTEMS_OWNER",
  occurredAt: "2026-07-01T10:00:00.000Z",
} as const;

const billingAcknowledgement = {
  type: "BILLING_ACKNOWLEDGE",
  actorRole: "BILLING_POLICY_LEAD",
  occurredAt: "2026-07-01T10:15:00.000Z",
} as const;

describe("Kaspa release commitment state machine", () => {
  it("starts a blocked Meridian commitment awaiting acknowledgements", () => {
    const commitment = createBlockedMeridianCommitment();

    expect(commitment.reviewId).toBe("REL-MER-2026-0701-001");
    expect(commitment.reviewVerdict).toBe("BLOCKED");
    expect(commitment.commitmentStatus).toBe("AWAITING_ACKNOWLEDGEMENTS");
    expect(commitment.requiredApprovers).toEqual(["FINANCE_SYSTEMS_OWNER", "BILLING_POLICY_LEAD"]);
  });

  it("allows finance acknowledgement exactly once", () => {
    const commitment = createBlockedMeridianCommitment();
    const first = transitionReleaseCommitment(commitment, financeAcknowledgement);

    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error(first.error.message);
    }

    expect(first.commitment.commitmentStatus).toBe("FINANCE_ACKNOWLEDGED");
    expect(first.commitment.financeAcknowledgedAt).toBe(financeAcknowledgement.occurredAt);

    const second = transitionReleaseCommitment(first.commitment, {
      ...financeAcknowledgement,
      occurredAt: "2026-07-01T10:05:00.000Z",
    });

    expect(second.ok).toBe(false);
    if (second.ok) {
      throw new Error("second finance acknowledgement unexpectedly succeeded");
    }
    expect(second.error.code).toBe("FINANCE_ALREADY_ACKNOWLEDGED");
  });

  it("rejects billing acknowledgement before finance acknowledgement", () => {
    const result = transitionReleaseCommitment(createBlockedMeridianCommitment(), billingAcknowledgement);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("billing acknowledgement unexpectedly succeeded");
    }
    expect(result.error.code).toBe("BILLING_REQUIRES_FINANCE_ACKNOWLEDGEMENT");
  });

  it("moves to remediation required after both acknowledgements", () => {
    const finance = transitionReleaseCommitment(createBlockedMeridianCommitment(), financeAcknowledgement);
    if (!finance.ok) {
      throw new Error(finance.error.message);
    }

    const billing = transitionReleaseCommitment(finance.commitment, billingAcknowledgement);
    expect(billing.ok).toBe(true);
    if (!billing.ok) {
      throw new Error(billing.error.message);
    }

    expect(billing.commitment.commitmentStatus).toBe("REMEDIATION_REQUIRED");
    expect(billing.commitment.billingAcknowledgedAt).toBe(billingAcknowledgement.occurredAt);
  });

  it("does not allow a blocked commitment to become release ready", () => {
    const commitment = createBlockedMeridianCommitment();
    const result = transitionReleaseCommitment(commitment, {
      type: "MARK_RELEASE_READY",
      actorRole: "RELIC_REVIEW_ATTESTOR",
      occurredAt: "2026-07-01T11:00:00.000Z",
      remediationDigest: "clean-remediation-digest",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("blocked commitment unexpectedly became release ready");
    }
    expect(result.error.code).toBe("BLOCKED_COMMITMENT_CANNOT_BECOME_RELEASE_READY");
    expect(result.commitment.commitmentStatus).toBe("AWAITING_ACKNOWLEDGEMENTS");
  });

  it("creates a clean release-ready commitment with a different ID and source reference", () => {
    const blocked = createBlockedMeridianCommitment();
    const clean = createCleanReviewCommitment(blocked);

    expect(clean.commitmentId).not.toBe(blocked.commitmentId);
    expect(clean.sourceCommitmentId).toBe(blocked.commitmentId);
    expect(clean.commitmentStatus).toBe("RELEASE_READY");
    expect(clean.reviewVerdict).toBe("APPROVED");
  });

  it("only supersedes a blocked commitment with a valid separate clean commitment", () => {
    const blocked = createBlockedMeridianCommitment();
    const clean = createCleanReviewCommitment(blocked);
    const result = transitionReleaseCommitment(blocked, {
      type: "SUPERSEDE",
      actorRole: "RELIC_REVIEW_ATTESTOR",
      occurredAt: "2026-07-02T10:45:00.000Z",
      supersedingCommitment: clean,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.commitment.commitmentStatus).toBe("SUPERSEDED");
    expect(result.commitment.supersededByCommitmentId).toBe(clean.commitmentId);
  });

  it("rejects superseding with the same commitment ID", () => {
    const blocked = createBlockedMeridianCommitment();
    const invalidClean: ReleaseCommitment = {
      ...createCleanReviewCommitment(blocked),
      commitmentId: blocked.commitmentId,
    };
    const result = transitionReleaseCommitment(blocked, {
      type: "SUPERSEDE",
      actorRole: "RELIC_REVIEW_ATTESTOR",
      occurredAt: "2026-07-02T10:45:00.000Z",
      supersedingCommitment: invalidClean,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("same-ID supersede unexpectedly succeeded");
    }
    expect(result.error.code).toBe("SUPERSEDING_COMMITMENT_MUST_BE_DISTINCT");
  });

  it("rejects invalid transitions with typed errors", () => {
    const blocked = createBlockedMeridianCommitment();
    const unrelatedClean: ReleaseCommitment = {
      ...createCleanReviewCommitment(blocked),
      sourceCommitmentId: "KASPA-REL-MER-BLOCKED-OTHER",
    };
    const result = transitionReleaseCommitment(blocked, {
      type: "SUPERSEDE",
      actorRole: "RELIC_REVIEW_ATTESTOR",
      occurredAt: "2026-07-02T10:45:00.000Z",
      supersedingCommitment: unrelatedClean,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreferenced supersede unexpectedly succeeded");
    }
    expect(result.error.code).toBe("SUPERSEDING_COMMITMENT_MUST_REFERENCE_SOURCE");
    expect(result.error.message).toContain("must reference");
  });
});
