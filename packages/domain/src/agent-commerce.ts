import { createHash } from "node:crypto";

import { z } from "zod";

import { tokenAmountSchema, type TokenAmount } from "./money.js";

export const offerStatuses = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "DEACTIVATED",
  "EXPIRED",
] as const;
export const offerStatusSchema = z.enum(offerStatuses);
export type OfferStatus = z.infer<typeof offerStatusSchema>;

export const billingModels = [
  "ONE_TIME",
  "PER_EXECUTION",
  "SUBSCRIPTION",
] as const;
export const billingModelSchema = z.enum(billingModels);
export type BillingModel = z.infer<typeof billingModelSchema>;

export const agreementStatuses = [
  "DRAFT",
  "TERMS_ACCEPTED",
  "AUTHORIZATION_REQUIRED",
  "AUTHORIZED",
  "ACTIVE",
  "SUSPENDED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
] as const;
export const agreementStatusSchema = z.enum(agreementStatuses);
export type AgreementStatus = z.infer<typeof agreementStatusSchema>;

export const authorizationTypes = [
  "DEVELOPMENT_PRINCIPAL",
  "WALLET_SIGNATURE",
  "DELEGATED_AUTHORIZATION",
  "SESSION_KEY",
  "SMART_ACCOUNT_PERMISSION",
] as const;
export const authorizationTypeSchema = z.enum(authorizationTypes);
export type AuthorizationType = z.infer<typeof authorizationTypeSchema>;

export const authorizationVerificationStatuses = [
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
] as const;
export const authorizationVerificationStatusSchema = z.enum(
  authorizationVerificationStatuses,
);
export type AuthorizationVerificationStatus = z.infer<
  typeof authorizationVerificationStatusSchema
>;

export const commerceOperationTypes = [
  "PREPARE_JOB",
  "CREATE_JOB",
  "REGISTER_JOB",
  "SET_BUDGET",
  "FUND",
  "SUBMIT_DELIVERY",
  "SETTLE",
  "REJECT",
  "CLAIM_REFUND",
  "CANCEL",
] as const;
export const commerceOperationTypeSchema = z.enum(commerceOperationTypes);
export type CommerceOperationType = z.infer<typeof commerceOperationTypeSchema>;

export const commerceOperationStates = [
  "CREATED",
  "READY",
  "AWAITING_SIGNATURE",
  "SUBMITTED",
  "PENDING",
  "CONFIRMED",
  "FINALIZED",
  "FAILED",
  "REPLACED",
  "REORGED",
  "CANCELLED",
] as const;
export const commerceOperationStateSchema = z.enum(commerceOperationStates);
export type CommerceOperationState = z.infer<
  typeof commerceOperationStateSchema
>;

export const valueMovementTypes = [
  "FUNDING",
  "ESCROW_LOCK",
  "PAYMENT",
  "REFUND",
  "FEE",
  "ESCROW_RELEASE",
] as const;
export const valueMovementTypeSchema = z.enum(valueMovementTypes);
export type ValueMovementType = z.infer<typeof valueMovementTypeSchema>;

export const commerceArtifactTypes = [
  "NEGOTIATED_TERMS",
  "ACCEPTED_TERMS",
  "AUTHORIZATION",
  "JOB_SPECIFICATION",
  "DELIVERY",
  "EVALUATION",
  "SETTLEMENT",
  "REJECTION",
  "REFUND",
] as const;
export const commerceArtifactTypeSchema = z.enum(commerceArtifactTypes);
export type CommerceArtifactType = z.infer<typeof commerceArtifactTypeSchema>;

export const settlementStatuses = [
  "PENDING",
  "FUNDED",
  "DELIVERED",
  "EVALUATED",
  "SETTLED",
  "REJECTED",
  "REFUNDED",
  "FAILED",
  "REORGED",
] as const;
export const settlementStatusSchema = z.enum(settlementStatuses);
export type SettlementStatus = z.infer<typeof settlementStatusSchema>;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const createOfferRequestSchema = z
  .object({
    agentId: z.uuid(),
    serviceId: z.uuid(),
    chainId: z.union([z.literal(56), z.literal(97)]),
    capability: z.string().trim().min(1).max(160),
    billingModel: billingModelSchema,
    price: tokenAmountSchema,
    terms: z.string().trim().min(1).max(100_000),
    capabilitySnapshot: z.array(z.string().trim().min(1)).min(1),
    limitationsSnapshot: z.array(z.string().trim().min(1)),
    effectiveAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable().default(null),
  })
  .strict();
export type CreateOfferRequest = z.infer<typeof createOfferRequestSchema>;

export interface AgentOfferVersion {
  id: string;
  offerId: string;
  version: number;
  agentId: string;
  serviceId: string;
  chainId: 56 | 97;
  capability: string;
  billingModel: BillingModel;
  price: TokenAmount;
  terms: string;
  termsHash: `0x${string}`;
  capabilitySnapshot: string[];
  limitationsSnapshot: string[];
  evidenceReference: Record<string, unknown>;
  effectiveAt: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface AgentOffer {
  id: string;
  operatorPrincipalId: string;
  agentId: string;
  serviceId: string;
  status: OfferStatus;
  currentVersion: number;
  version: AgentOfferVersion;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceAgreement {
  id: string;
  principalId: string;
  agentId: string;
  serviceId: string;
  offerId: string;
  offerVersionId: string;
  mandateId: string | null;
  mandateVersion: number | null;
  authorizationArtifactId: string | null;
  status: AgreementStatus;
  termsHash: `0x${string}`;
  termsSnapshot: string;
  pricingSnapshot: TokenAmount;
  chainId: 56 | 97;
  acceptedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const walletChallengeRequestSchema = z
  .object({ address, chainId: z.union([z.literal(56), z.literal(97)]) })
  .strict();

export const walletChallengeVerificationSchema = z
  .object({
    challengeId: z.uuid(),
    address,
    chainId: z.union([z.literal(56), z.literal(97)]),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  })
  .strict();

export const commerceAuthorizationSchema = z
  .object({
    agreementId: z.uuid(),
    principal: address,
    agentId: z.uuid(),
    mandateId: z.uuid(),
    mandateVersion: z.number().int().positive(),
    offerVersionId: z.uuid(),
    termsHash: hash,
    actionHash: hash.nullable(),
    tokenAddress: address,
    amountBaseUnits: z.string().regex(/^\d+$/),
    chainId: z.union([z.literal(56), z.literal(97)]),
    nonce: z.string().min(16).max(200),
    expiresAt: z.string().regex(/^\d+$/),
  })
  .strict();
export type CommerceAuthorization = z.infer<typeof commerceAuthorizationSchema>;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  return value;
};

export function immutableContentHash(value: unknown): `0x${string}` {
  return `0x${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

export function commerceAuthorizationTypedData(
  authorization: CommerceAuthorization,
  verifyingContract: `0x${string}`,
) {
  const value = commerceAuthorizationSchema.parse(authorization);
  if (value.actionHash !== null)
    return executionApprovalTypedData(
      { ...value, actionHash: value.actionHash as `0x${string}` },
      verifyingContract,
    );
  return agreementAuthorizationTypedData(value, verifyingContract);
}

export function agreementAuthorizationTypedData(
  authorization: CommerceAuthorization,
  verifyingContract: `0x${string}`,
) {
  const value = commerceAuthorizationSchema.parse(authorization);
  if (value.actionHash !== null)
    throw new Error("Agreement authorization cannot contain an action hash");
  return {
    domain: {
      name: "Relic Agent Commerce",
      version: "1",
      chainId: value.chainId,
      verifyingContract,
    },
    primaryType: "CommerceAuthorization" as const,
    types: {
      CommerceAuthorization: [
        { name: "agreementId", type: "string" },
        { name: "principal", type: "address" },
        { name: "agentId", type: "string" },
        { name: "mandateId", type: "string" },
        { name: "mandateVersion", type: "uint256" },
        { name: "offerVersionId", type: "string" },
        { name: "termsHash", type: "bytes32" },
        { name: "actionHash", type: "bytes32" },
        { name: "tokenAddress", type: "address" },
        { name: "amountBaseUnits", type: "uint256" },
        { name: "nonce", type: "string" },
        { name: "expiresAt", type: "uint256" },
      ],
    },
    message: {
      ...value,
      actionHash:
        value.actionHash ??
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      mandateVersion: BigInt(value.mandateVersion),
      amountBaseUnits: BigInt(value.amountBaseUnits),
      expiresAt: BigInt(value.expiresAt),
    },
  };
}

/**
 * Exact execution approval is deliberately domain-separated from agreement
 * authorization. The canonical action hash binds protocol, target, calldata,
 * value, and network at the execution policy boundary.
 */
export function executionApprovalTypedData(
  authorization: CommerceAuthorization & { actionHash: `0x${string}` },
  verifyingContract: `0x${string}`,
) {
  const value = commerceAuthorizationSchema.parse(authorization);
  if (value.actionHash === null)
    throw new Error("Exact execution approval requires an action hash");
  return {
    domain: {
      name: "Relic Exact Execution",
      version: "1",
      chainId: value.chainId,
      verifyingContract,
    },
    primaryType: "ExactExecutionApproval" as const,
    types: {
      ExactExecutionApproval: [
        { name: "agreementId", type: "string" },
        { name: "principal", type: "address" },
        { name: "agentId", type: "string" },
        { name: "mandateId", type: "string" },
        { name: "mandateVersion", type: "uint256" },
        { name: "offerVersionId", type: "string" },
        { name: "termsHash", type: "bytes32" },
        { name: "actionHash", type: "bytes32" },
        { name: "tokenAddress", type: "address" },
        { name: "amountBaseUnits", type: "uint256" },
        { name: "nonce", type: "string" },
        { name: "expiresAt", type: "uint256" },
      ],
    },
    message: {
      ...value,
      actionHash: value.actionHash as `0x${string}`,
      mandateVersion: BigInt(value.mandateVersion),
      amountBaseUnits: BigInt(value.amountBaseUnits),
      expiresAt: BigInt(value.expiresAt),
    },
  };
}

const offerTransitions: Record<OfferStatus, readonly OfferStatus[]> = {
  DRAFT: ["ACTIVE", "DEACTIVATED", "EXPIRED"],
  ACTIVE: ["PAUSED", "DEACTIVATED", "EXPIRED"],
  PAUSED: ["ACTIVE", "DEACTIVATED", "EXPIRED"],
  DEACTIVATED: [],
  EXPIRED: [],
};

export function assertOfferTransition(from: OfferStatus, to: OfferStatus) {
  if (!offerTransitions[from].includes(to))
    throw new Error(`Invalid offer transition: ${from} -> ${to}`);
}

const agreementTransitions: Record<
  AgreementStatus,
  readonly AgreementStatus[]
> = {
  DRAFT: ["TERMS_ACCEPTED", "CANCELLED", "EXPIRED", "FAILED"],
  TERMS_ACCEPTED: [
    "AUTHORIZATION_REQUIRED",
    "AUTHORIZED",
    "CANCELLED",
    "EXPIRED",
    "FAILED",
  ],
  AUTHORIZATION_REQUIRED: ["AUTHORIZED", "CANCELLED", "EXPIRED", "FAILED"],
  AUTHORIZED: ["ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED", "FAILED"],
  ACTIVE: ["SUSPENDED", "COMPLETED", "CANCELLED", "EXPIRED", "FAILED"],
  SUSPENDED: ["ACTIVE", "CANCELLED", "EXPIRED", "FAILED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: [],
};

export function assertAgreementTransition(
  from: AgreementStatus,
  to: AgreementStatus,
) {
  if (!agreementTransitions[from].includes(to))
    throw new Error(`Invalid agreement transition: ${from} -> ${to}`);
}
