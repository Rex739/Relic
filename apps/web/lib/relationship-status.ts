import type { Mandate } from "@relic/domain";

import type { CommerceAgreementView } from "./commerce";

export type RelationshipStatus =
  | "Awaiting confirmation"
  | "Awaiting first update"
  | "Completing payment"
  | "Running"
  | "Needs attention"
  | "Paused"
  | "Completed"
  | "Failed";

export function resolveHireSelection<T extends { mandate: { id: string } }>(
  relationships: T[],
  input: { requestedMandateId?: string; startNew: boolean },
) {
  if (input.startNew)
    return { selected: null, showResumeChoice: false, invalidRequest: false };
  if (input.requestedMandateId === undefined)
    return {
      selected: null,
      showResumeChoice: relationships.length > 0,
      invalidRequest: false,
    };
  const selected =
    relationships.find(
      ({ mandate }) => mandate.id === input.requestedMandateId,
    ) ?? null;
  return {
    selected,
    showResumeChoice: false,
    invalidRequest: selected === null,
  };
}

const operationProgress = (agreement: CommerceAgreementView) => {
  const finalized = new Set(
    agreement.operations
      .filter((operation) => operation.state === "FINALIZED")
      .map((operation) => String(operation.operationType)),
  );
  if (finalized.has("FUND")) return 5;
  if (finalized.has("SET_BUDGET")) return 4;
  if (finalized.has("REGISTER_JOB")) return 3;
  if (finalized.has("CREATE_JOB")) return 2;
  if (agreement.operations.length > 0) return 1;
  return 0;
};

const agreementStatusPriority = (status: string) =>
  (
    ({
      ACTIVE: 6,
      AUTHORIZED: 5,
      AUTHORIZATION_REQUIRED: 4,
      TERMS_ACCEPTED: 3,
      DRAFT: 2,
      SUSPENDED: 1,
      COMPLETED: 0,
      CANCELLED: -1,
      EXPIRED: -2,
      FAILED: -3,
    }) as Record<string, number>
  )[status] ?? -4;

const agreementCreatedAt = (agreement: CommerceAgreementView) => {
  const value = agreement.createdAt;
  return typeof value === "string" ? Date.parse(value) || 0 : 0;
};

/** Select the single agreement that represents the furthest durable relationship. */
export function selectRelationshipAgreement(
  agreements: CommerceAgreementView[],
  mandateId: string,
) {
  return (
    agreements
      .filter((agreement) => agreement.mandateId === mandateId)
      .toSorted((left, right) => {
        const progress = operationProgress(right) - operationProgress(left);
        if (progress !== 0) return progress;
        const status =
          agreementStatusPriority(right.status) -
          agreementStatusPriority(left.status);
        if (status !== 0) return status;
        return agreementCreatedAt(right) - agreementCreatedAt(left);
      })[0] ?? null
  );
}

export function relationshipSetupComplete(
  agreement: CommerceAgreementView | null,
) {
  return (
    agreement?.operations.some(
      (operation) =>
        operation.operationType === "FUND" && operation.state === "FINALIZED",
    ) ?? false
  );
}

export function relationshipStatus(input: {
  mandate: Mandate;
  agreement: CommerceAgreementView | null;
  hasUpdate?: boolean;
  now?: number;
}): RelationshipStatus {
  const { mandate, agreement } = input;
  const expired =
    Date.parse(mandate.version.expiresAt) <= (input.now ?? Date.now());

  if (mandate.status === "FAILED_ACTIVATION" || agreement?.status === "FAILED")
    return "Failed";
  if (mandate.attentionReason !== null) return "Needs attention";
  if (mandate.status === "PAUSED" || agreement?.status === "SUSPENDED")
    return "Paused";
  if (
    expired ||
    ["REVOKED", "EXPIRED", "SUPERSEDED"].includes(mandate.status) ||
    (agreement !== null &&
      ["COMPLETED", "CANCELLED", "EXPIRED"].includes(agreement.status))
  )
    return "Completed";
  if (mandate.status === "ACTIVE" && relationshipSetupComplete(agreement))
    return "Running";
  if (
    agreement === null ||
    ["DRAFT", "TERMS_ACCEPTED", "AUTHORIZATION_REQUIRED"].includes(
      agreement.status,
    )
  )
    return "Awaiting confirmation";
  if (agreement.status === "AUTHORIZED" && agreement.operations.length === 0)
    return input.hasUpdate ? "Awaiting confirmation" : "Awaiting first update";
  return "Completing payment";
}
