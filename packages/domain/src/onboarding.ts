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
  externalAgentId: string;
  supplyType: SupplyType;
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
  externalAgentId: string;
  supplyType: SupplyType;
  submitterAddress?: `0x${string}`;
  developerOverrides?: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

export interface OwnershipChallenge {
  id: string;
  submissionId: string;
  message: string;
  expectedOwner: `0x${string}`;
  expiresAt: string;
}

export interface OwnershipContext {
  registryAddress: `0x${string}`;
  ownerAddress: `0x${string}`;
}

export interface OnboardingRepository {
  createSubmission(input: CreateAgentSubmission): Promise<AgentSubmission>;
  findSubmission(id: string): Promise<AgentSubmission | null>;
  findOwnershipContext(
    chainId: number,
    externalAgentId: string,
  ): Promise<OwnershipContext | null>;
  findOwnershipChallenge(id: string): Promise<OwnershipChallenge | null>;
  createOwnershipChallenge(input: {
    submissionId: string;
    nonceHash: string;
    message: string;
    expectedOwner: `0x${string}`;
    expiresAt: Date;
  }): Promise<OwnershipChallenge>;
  consumeOwnershipChallenge(input: {
    challengeId: string;
    signerAddress: `0x${string}`;
    signatureDigest: string;
    verifiedAt: Date;
  }): Promise<boolean>;
}

export function buildOwnershipMessage(input: {
  submissionId: string;
  chainId: number;
  registryAddress: `0x${string}`;
  externalAgentId: string;
  nonce: string;
  expiresAt: string;
}) {
  return [
    "Relic agent ownership verification",
    `Submission: ${input.submissionId}`,
    `Chain ID: ${input.chainId}`,
    `Registry: ${input.registryAddress.toLowerCase()}`,
    `ERC-8004 agent ID: ${input.externalAgentId}`,
    `Nonce: ${input.nonce}`,
    `Expires: ${input.expiresAt}`,
    "Purpose: prove control of the current onchain owner; no transaction is requested.",
  ].join("\n");
}
