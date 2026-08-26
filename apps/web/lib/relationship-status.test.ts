import { describe, expect, it } from "vitest";

import type { Mandate } from "@relic/domain";

import type { CommerceAgreementView } from "./commerce";
import {
  relationshipStatus,
  resolveHireSelection,
  selectRelationshipAgreement,
} from "./relationship-status";

const mandate = {
  status: "ACTIVE",
  attentionReason: null,
  version: { expiresAt: "2026-09-01T00:00:00.000Z" },
} as Mandate;

const agreement = (
  id: string,
  status: string,
  operations: CommerceAgreementView["operations"],
) =>
  ({
    id,
    mandateId: "mandate-1",
    status,
    authorizationArtifactId: "authorization-1",
    expiresAt: null,
    pricingSnapshot: {
      amountBaseUnits: "0",
      decimals: 18,
      symbol: "tBNB",
      tokenAddress: "0x0000000000000000000000000000000000000000",
    },
    operations,
    events: [],
    artifacts: [],
    authorizations: [],
    movements: [],
    settlements: [],
    createdAt: "2026-08-26T00:00:00.000Z",
  }) as CommerceAgreementView;

describe("relationship status projection", () => {
  it("never presents a finalized funded activation as setting up", () => {
    const running = agreement("running", "ACTIVE", [
      { operationType: "FUND", state: "FINALIZED" },
    ]);
    const unfinished = agreement("unfinished", "ACTIVE", [
      { operationType: "CREATE_JOB", state: "AWAITING_SIGNATURE" },
    ]);

    const selected = selectRelationshipAgreement(
      [unfinished, running],
      "mandate-1",
    );
    expect(selected?.id).toBe("running");
    expect(
      relationshipStatus({
        mandate,
        agreement: selected,
        now: Date.parse("2026-08-26T00:00:00.000Z"),
      }),
    ).toBe("Running");
  });

  it("projects attention, pause, completion, and failure consistently", () => {
    expect(
      relationshipStatus({
        mandate: { ...mandate, attentionReason: "Review evidence" },
        agreement: null,
      }),
    ).toBe("Needs attention");
    expect(
      relationshipStatus({
        mandate: { ...mandate, status: "PAUSED" },
        agreement: null,
      }),
    ).toBe("Paused");
    expect(
      relationshipStatus({
        mandate: { ...mandate, status: "REVOKED" },
        agreement: null,
      }),
    ).toBe("Completed");
    expect(
      relationshipStatus({
        mandate,
        agreement: agreement("failed", "FAILED", []),
      }),
    ).toBe("Failed");
  });

  it("requires an explicit choice instead of selecting the first saved setup", () => {
    const relationships = [
      { mandate: { id: "first" } },
      { mandate: { id: "second" } },
    ];
    expect(
      resolveHireSelection(relationships, {
        startNew: false,
      }),
    ).toEqual({
      selected: null,
      showResumeChoice: true,
      invalidRequest: false,
    });
    expect(
      resolveHireSelection(relationships, {
        requestedMandateId: "second",
        startNew: false,
      }).selected?.mandate.id,
    ).toBe("second");
  });
});
