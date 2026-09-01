import { z } from "zod";

import type { ActivationStatus } from "./supply.js";

export const supplyTypeSchema = z.enum([
  "third_party",
  "partner",
  "relic_reference",
]);
export type SupplyType = z.infer<typeof supplyTypeSchema>;

export const submissionStatusSchema = z.enum([
  "SUBMITTED",
  "IDENTITY_CHECK",
  "METADATA_CHECK",
  "SERVICE_DISCOVERY",
  "SERVICE_VERIFICATION",
  "COMMERCE_PREFLIGHT",
  "ACTIONABLE",
  "BLOCKED",
  "REJECTED",
  "STALE",
]);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

const submissionTransitions: Record<
  SubmissionStatus,
  readonly SubmissionStatus[]
> = {
  SUBMITTED: ["IDENTITY_CHECK", "REJECTED", "BLOCKED"],
  IDENTITY_CHECK: ["METADATA_CHECK", "REJECTED", "BLOCKED"],
  METADATA_CHECK: ["SERVICE_DISCOVERY", "REJECTED", "BLOCKED"],
  SERVICE_DISCOVERY: ["SERVICE_VERIFICATION", "BLOCKED", "REJECTED"],
  SERVICE_VERIFICATION: ["COMMERCE_PREFLIGHT", "BLOCKED", "REJECTED"],
  COMMERCE_PREFLIGHT: ["ACTIONABLE", "BLOCKED", "REJECTED"],
  ACTIONABLE: ["STALE", "BLOCKED"],
  BLOCKED: [
    "IDENTITY_CHECK",
    "METADATA_CHECK",
    "SERVICE_DISCOVERY",
    "SERVICE_VERIFICATION",
    "COMMERCE_PREFLIGHT",
    "REJECTED",
  ],
  REJECTED: [],
  STALE: ["IDENTITY_CHECK", "REJECTED"],
};

export function assertSubmissionTransition(
  from: SubmissionStatus,
  to: SubmissionStatus,
) {
  if (!submissionTransitions[from].includes(to))
    throw new Error(`Invalid submission transition: ${from} -> ${to}`);
}

export const activationLifecycleStateSchema = z.enum([
  "PREPARING",
  "NEGOTIATING",
  "AWAITING_AUTHORIZATION",
  "ONCHAIN_CREATED",
  "ACTIVE",
  "DELIVERED",
  "SETTLING",
  "COMPLETED",
  "REJECTED",
  "REFUNDED",
  "FAILED",
  "BLOCKED",
]);
export type ActivationLifecycleState = z.infer<
  typeof activationLifecycleStateSchema
>;

const activationLifecycleTransitions: Record<
  ActivationLifecycleState,
  readonly ActivationLifecycleState[]
> = {
  PREPARING: ["NEGOTIATING", "ONCHAIN_CREATED", "FAILED", "BLOCKED"],
  NEGOTIATING: [
    "AWAITING_AUTHORIZATION",
    "ONCHAIN_CREATED",
    "FAILED",
    "BLOCKED",
  ],
  AWAITING_AUTHORIZATION: ["ONCHAIN_CREATED", "FAILED", "BLOCKED"],
  ONCHAIN_CREATED: ["ACTIVE", "FAILED", "REJECTED"],
  ACTIVE: ["DELIVERED", "FAILED", "REJECTED", "REFUNDED"],
  DELIVERED: ["SETTLING", "FAILED", "REJECTED"],
  SETTLING: ["COMPLETED", "FAILED", "REJECTED", "REFUNDED"],
  COMPLETED: [],
  REJECTED: ["REFUNDED"],
  REFUNDED: [],
  FAILED: ["PREPARING", "REFUNDED"],
  BLOCKED: ["PREPARING", "NEGOTIATING", "REJECTED"],
};

export function assertActivationLifecycleTransition(
  from: ActivationLifecycleState,
  to: ActivationLifecycleState,
) {
  if (!activationLifecycleTransitions[from].includes(to))
    throw new Error(
      `Invalid activation lifecycle transition: ${from} -> ${to}`,
    );
}

export function legacyActivationStatusForLifecycle(
  state: ActivationLifecycleState,
): ActivationStatus {
  const statuses: Record<ActivationLifecycleState, ActivationStatus> = {
    PREPARING: "PREPARED",
    NEGOTIATING: "TERMS_RESOLVED",
    AWAITING_AUTHORIZATION: "TERMS_RESOLVED",
    ONCHAIN_CREATED: "JOB_CREATED",
    ACTIVE: "FUNDED",
    DELIVERED: "SUBMITTED",
    SETTLING: "SUBMITTED",
    COMPLETED: "COMPLETED",
    REJECTED: "REJECTED",
    REFUNDED: "REJECTED",
    FAILED: "FAILED",
    BLOCKED: "BLOCKED",
  };
  return statuses[state];
}

export interface AgentSubmission {
  id: string;
  chainId: number;
  registryAddress: `0x${string}`;
  externalAgentId: string;
  supplyType: SupplyType;
  relicPrincipalId: string | null;
  status: SubmissionStatus;
  submitterAddress: `0x${string}` | null;
  ownershipVerifiedAt: string | null;
  agentId: string | null;
  candidateId: string | null;
  developerOverrides: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentSubmission {
  chainId: number;
  registryAddress: `0x${string}`;
  externalAgentId: string;
  supplyType: SupplyType;
  relicPrincipalId: string;
  liveOwner: `0x${string}`;
  submitterAddress?: `0x${string}`;
  developerOverrides?: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

export interface OwnershipChallenge {
  id: string;
  submissionId: string;
  principalId: string;
  chainId: number;
  registryAddress: `0x${string}`;
  externalAgentId: string;
  message: string;
  expectedOwner: `0x${string}`;
  issuedAt: string;
  expiresAt: string;
}

export interface SellerAgentAuthorization {
  id: string;
  principalId: string;
  submissionId: string;
  agentId: string | null;
  chainId: number;
  registryAddress: `0x${string}`;
  externalAgentId: string;
  verifiedOwner: `0x${string}`;
  challengeId: string;
  verifiedAt: string;
  lastOwnerCheckedAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
}

export interface OwnershipContext {
  registryAddress: `0x${string}`;
  ownerAddress: `0x${string}`;
}

export interface OnboardingRepository {
  createSubmission(input: CreateAgentSubmission): Promise<AgentSubmission>;
  findSubmission(id: string): Promise<AgentSubmission | null>;
  listPendingCatalogSubmissions(limit: number): Promise<AgentSubmission[]>;
  findSubmissionByIdentity(
    chainId: number,
    registryAddress: `0x${string}`,
    externalAgentId: string,
  ): Promise<AgentSubmission | null>;
  findOwnershipContext(
    chainId: number,
    externalAgentId: string,
  ): Promise<OwnershipContext | null>;
  findOwnershipChallenge(id: string): Promise<OwnershipChallenge | null>;
  createOwnershipChallenge(input: {
    submissionId: string;
    principalId: string;
    chainId: number;
    registryAddress: `0x${string}`;
    externalAgentId: string;
    nonceHash: string;
    message: string;
    expectedOwner: `0x${string}`;
    issuedAt: Date;
    expiresAt: Date;
  }): Promise<OwnershipChallenge>;
  consumeOwnershipChallengeAndAuthorize(input: {
    challengeId: string;
    principalId: string;
    submissionId: string;
    chainId: number;
    registryAddress: `0x${string}`;
    externalAgentId: string;
    signerAddress: `0x${string}`;
    signatureDigest: string;
    verifiedAt: Date;
  }): Promise<SellerAgentAuthorization | null>;
  findSellerAuthorization(input: {
    principalId: string;
    agentId: string;
  }): Promise<SellerAgentAuthorization | null>;
  listSellerAuthorizations(
    principalId: string,
  ): Promise<SellerAgentAuthorization[]>;
  revokeSellerAuthorization(input: {
    authorizationId: string;
    reason: string;
    revokedAt: Date;
  }): Promise<boolean>;
  upsertSellerMarketplaceProfile?(input: {
    agentId: string;
    principalId: string;
    description: string;
    imageUrl: string | null;
    updatedAt: Date;
  }): Promise<import("./marketplace.js").SellerMarketplaceProfile>;
  updateSellerMarketplaceServiceEndpoint?(input: {
    agentId: string;
    serviceId: string;
    endpoint: string;
    updatedAt: Date;
  }): Promise<{ endpoint: string }>;
}

export function buildOwnershipMessage(input: {
  environment: string;
  origin: string;
  principalId: string;
  chainId: number;
  registryAddress: `0x${string}`;
  externalAgentId: string;
  expectedOwner: `0x${string}`;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}) {
  return [
    "Relic Agent Ownership Verification",
    "",
    "Version: 1",
    `Environment: ${input.environment}`,
    `Origin: ${input.origin}`,
    `Agent ID: ${input.externalAgentId}`,
    `Chain ID: ${input.chainId}`,
    `Registry: ${input.registryAddress.toLowerCase()}`,
    `Expected Owner: ${input.expectedOwner.toLowerCase()}`,
    `Relic Account: ${input.principalId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expires At: ${input.expiresAt}`,
    "",
    "Purpose:",
    `Authorize this Relic account to manage Agent #${input.externalAgentId}.`,
    "No blockchain transaction is requested.",
  ].join("\n");
}
