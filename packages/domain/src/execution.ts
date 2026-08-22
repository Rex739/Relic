import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  Mandate,
  MandateApprovalMode,
  VerifiedMandateProfile,
} from "./mandate.js";
import { addDecimalAmounts, compareDecimalAmounts } from "./money.js";

export const executionStatuses = [
  "REQUESTED",
  "EVALUATING",
  "APPROVAL_REQUIRED",
  "APPROVED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "DENIED",
  "EXPIRED",
  "CANCELLED",
  "BLOCKED_STALE_AGENT",
] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];

export const policyDecisions = ["ALLOW", "REQUIRE_APPROVAL", "DENY"] as const;
export type PolicyDecision = (typeof policyDecisions)[number];

const token = z.string().trim().min(1).max(120);
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const executionActionRequestSchema = z
  .object({
    mandateId: z.uuid(),
    mandateVersion: z.number().int().positive(),
    agentId: z.uuid(),
    chainId: z.union([z.literal(56), z.literal(97)]),
    actionType: token,
    capability: token,
    protocol: token.nullable().default(null),
    target: token.nullable().default(null),
    asset: token.nullable().default(null),
    amount: decimal.nullable().default(null),
    destination: address.nullable().default(null),
    parameters: z.record(z.string(), z.unknown()).default({}),
    deadline: z.iso.datetime(),
    source: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type ExecutionActionRequest = z.infer<
  typeof executionActionRequestSchema
>;

export interface CanonicalExecutionAction extends ExecutionActionRequest {
  id: string;
  principalId: string;
  requestedAt: string;
  normalizedHash: string;
  transactional: boolean;
}

export interface PolicyReason {
  code: string;
  message: string;
  field?: string;
}

export interface ExecutionPolicyResult {
  decision: PolicyDecision;
  reasons: PolicyReason[];
  mandateVersion: number;
  normalizedHash: string;
  approvalMode: MandateApprovalMode;
  signingAuthorization: false;
}

export interface BudgetState {
  committedAmount: string;
  succeededAmount: string;
  releasedAmount: string;
  periodActionCount: number;
}

export interface ExecutionReceipt {
  source: "independently_observed" | "provider_reported" | "onchain_verified";
  outcome: Record<string, unknown>;
  evidence: Record<string, unknown>;
  cost: string | null;
  transactionHash: string | null;
  jobId: string | null;
  observedAt: string;
}

export interface ExecutionRecord {
  id: string;
  mandateId: string;
  mandateVersion: number;
  agentId: string;
  principalId: string;
  chainId: 56 | 97;
  idempotencyKey: string;
  rawRequest: Record<string, unknown>;
  action: CanonicalExecutionAction;
  status: ExecutionStatus;
  decision: PolicyDecision | null;
  reasons: PolicyReason[];
  approvalHash: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  completedAt: string | null;
  receipt: ExecutionReceipt | null;
  createdAt: string;
  updatedAt: string;
}

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

export const normalizedActionHash = (
  request: ExecutionActionRequest,
  principalId: string,
) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize({ ...request, principalId })))
    .digest("hex");

const normalized = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_-]+/g, "_");
const contains = (values: string[], value: string) =>
  values.some((candidate) => normalized(candidate) === normalized(value));
const deny = (code: string, message: string, field?: string): PolicyReason => ({
  code,
  message,
  ...(field === undefined ? {} : { field }),
});

export function evaluateExecutionPolicy(input: {
  mandate: Mandate;
  profile: VerifiedMandateProfile;
  action: CanonicalExecutionAction;
  budget: BudgetState;
  now?: Date;
}): ExecutionPolicyResult {
  const { mandate, profile, action, budget } = input;
  const now = input.now ?? new Date();
  const reasons: PolicyReason[] = [];
  if (mandate.status !== "ACTIVE")
    reasons.push(
      deny(
        `mandate_${mandate.status.toLowerCase()}`,
        `Mandate ${mandate.id} is ${mandate.status.toLowerCase()} and cannot execute.`,
        "status",
      ),
    );
  if (mandate.activeVersion !== action.mandateVersion)
    reasons.push(
      deny(
        "mandate_version_mismatch",
        `Action is bound to mandate version ${action.mandateVersion}, not active version ${String(mandate.activeVersion)}.`,
        "mandateVersion",
      ),
    );
  if (
    new Date(mandate.version.expiresAt) <= now ||
    new Date(action.deadline) <= now
  )
    reasons.push(
      deny(
        "execution_expired",
        "The mandate or action deadline has expired.",
        "deadline",
      ),
    );
  if (mandate.chainId !== action.chainId || profile.chainId !== action.chainId)
    reasons.push(
      deny(
        "network_mismatch",
        "The requested network does not match the mandate and verified service.",
        "chainId",
      ),
    );
  if (
    !profile.current ||
    profile.attentionReason !== null ||
    mandate.attentionReason !== null
  )
    reasons.push(
      deny(
        "stale_agent",
        profile.attentionReason ??
          mandate.attentionReason ??
          "The verified service is not current.",
      ),
    );
  if (mandate.version.evidence.serviceId !== profile.serviceId)
    reasons.push(
      deny(
        "service_changed",
        "The verified service differs from the mandate evidence binding.",
      ),
    );
  if (
    contains(mandate.version.deniedCapabilities, action.capability) ||
    !contains(mandate.version.allowedCapabilities, action.capability) ||
    !contains(profile.capabilitySet, action.capability)
  )
    reasons.push(
      deny(
        "capability_not_authorized",
        `${action.capability} is not permitted by mandate version ${mandate.version.version}.`,
        "capability",
      ),
    );
  if (
    action.protocol !== null &&
    !contains(mandate.version.allowedProtocols, action.protocol)
  )
    reasons.push(
      deny(
        "protocol_not_authorized",
        `${action.protocol} is not an allowed protocol.`,
        "protocol",
      ),
    );
  if (
    action.target !== null &&
    mandate.version.allowedContracts.length > 0 &&
    !contains(mandate.version.allowedContracts, action.target)
  )
    reasons.push(
      deny(
        "contract_not_authorized",
        "The target is not an allowed contract or service.",
        "target",
      ),
    );
  if (
    action.asset !== null &&
    !contains(mandate.version.allowedAssets, action.asset)
  )
    reasons.push(
      deny(
        "asset_not_authorized",
        `${action.asset} is not an allowed asset.`,
        "asset",
      ),
    );
  if (action.transactional && mandate.version.approvalMode === "OBSERVE_ONLY")
    reasons.push(
      deny(
        "observe_only",
        "Observe-only mandates cannot authorize transactions.",
      ),
    );
  if (action.amount !== null && mandate.version.perActionLimit !== null) {
    if (
      !contains([mandate.version.perActionLimit.asset], action.asset ?? "") ||
      compareDecimalAmounts(
        action.amount,
        mandate.version.perActionLimit.amount,
      ) > 0
    )
      reasons.push(
        deny(
          "per_action_limit_exceeded",
          "The action exceeds the per-action allowance.",
          "amount",
        ),
      );
  }
  if (action.amount !== null && mandate.version.aggregateLimit !== null) {
    const projected = addDecimalAmounts(budget.committedAmount, action.amount);
    if (
      compareDecimalAmounts(projected, mandate.version.aggregateLimit.amount) >
      0
    )
      reasons.push(
        deny(
          "aggregate_limit_exceeded",
          "The action exceeds the remaining aggregate allowance.",
          "amount",
        ),
      );
  }
  if (
    mandate.version.executionFrequency !== null &&
    budget.periodActionCount >= mandate.version.executionFrequency.maxActions
  )
    reasons.push(
      deny(
        "frequency_limit_exceeded",
        "The mandate execution frequency limit is exhausted.",
      ),
    );
  const decision =
    reasons.length > 0
      ? "DENY"
      : action.transactional &&
          mandate.version.approvalMode === "ASK_BEFORE_EXECUTION"
        ? "REQUIRE_APPROVAL"
        : "ALLOW";
  if (decision === "REQUIRE_APPROVAL")
    reasons.push({
      code: "explicit_action_approval_required",
      message:
        "This action is within mandate limits, but the mandate requires confirmation bound to this exact action hash.",
    });
  if (decision === "ALLOW")
    reasons.push({
      code: "policy_satisfied",
      message: action.transactional
        ? "The action satisfies the deterministic mandate; signing authority is still required separately."
        : "The read-only action satisfies the deterministic mandate.",
    });
  return {
    decision,
    reasons,
    mandateVersion: action.mandateVersion,
    normalizedHash: action.normalizedHash,
    approvalMode: mandate.version.approvalMode,
    signingAuthorization: false,
  };
}

export interface AuthorizationProvider {
  kind: "DEVELOPMENT_API" | "WALLET" | "SESSION_KEY" | "SMART_ACCOUNT";
  canAuthorize(action: CanonicalExecutionAction): Promise<boolean>;
  authorize(
    action: CanonicalExecutionAction,
  ): Promise<{ authorizationId: string }>;
  revoke(authorizationId: string): Promise<void>;
  getAuthorizationState(authorizationId: string): Promise<string>;
}

export interface ExecutionSigner {
  kind: "NONE" | "WALLET" | "SESSION_KEY" | "SMART_ACCOUNT" | "REMOTE_CUSTODY";
  canSign(action: CanonicalExecutionAction): Promise<boolean>;
  prepare(action: CanonicalExecutionAction): Promise<Record<string, unknown>>;
  signOrSubmit(
    prepared: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export interface Erc8183ExecutionPlan {
  negotiation: Record<string, unknown>;
  jobCreation: { required: boolean; prepared: boolean };
  funding: { amount: string | null; asset: string | null; required: boolean };
  providerSubmission: { prepared: boolean };
  settlement: { prepared: boolean };
  blockchainWritePrepared: boolean;
  blockchainWriteSubmitted: false;
}

export interface Erc8183ExecutionAdapter {
  prepare(action: CanonicalExecutionAction): Promise<Erc8183ExecutionPlan>;
}

export interface ExecutionPersistence {
  createOrFind(input: {
    id: string;
    idempotencyKey: string;
    principalId: string;
    rawRequest: Record<string, unknown>;
    action: CanonicalExecutionAction;
  }): Promise<{ created: boolean; record: ExecutionRecord }>;
  budgetState(
    mandateId: string,
    version: number,
    windowStart: Date,
  ): Promise<BudgetState>;
  recordDecision(input: {
    executionId: string;
    result: ExecutionPolicyResult;
    reserveAmount: string | null;
    aggregateLimit: string | null;
  }): Promise<ExecutionRecord>;
  transition(input: {
    executionId: string;
    principalId: string;
    from: ExecutionStatus[];
    to: ExecutionStatus;
    receipt?: ExecutionReceipt;
    evidence?: Record<string, unknown>;
  }): Promise<ExecutionRecord | null>;
  approve(input: {
    executionId: string;
    principalId: string;
    normalizedHash: string;
    approved: boolean;
  }): Promise<ExecutionRecord | null>;
  find(
    executionId: string,
    principalId: string,
  ): Promise<ExecutionRecord | null>;
  list(mandateId: string, principalId: string): Promise<ExecutionRecord[]>;
}
