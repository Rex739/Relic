import { z } from "zod";

import type { PublicMarketplaceAgentDetail } from "./marketplace.js";

export const mandateStatuses = [
  "DRAFT",
  "REVIEWED",
  "ACTIVE",
  "PAUSED",
  "REVOKED",
  "EXPIRED",
  "FAILED_ACTIVATION",
  "SUPERSEDED",
] as const;
export type MandateStatus = (typeof mandateStatuses)[number];

export const mandateApprovalModes = [
  "OBSERVE_ONLY",
  "ASK_BEFORE_EXECUTION",
  "PRE_AUTHORIZED",
] as const;
export type MandateApprovalMode = (typeof mandateApprovalModes)[number];

export const mandateEventTypes = [
  "MANDATE_CREATED",
  "MANDATE_REVIEWED",
  "MANDATE_ACTIVATED",
  "MANDATE_PAUSED",
  "MANDATE_RESUMED",
  "MANDATE_MODIFIED",
  "MANDATE_REVOKED",
  "MANDATE_EXPIRED",
  "MANDATE_ATTENTION_REQUIRED",
  "ACTIVATION_FAILED",
  "AGENT_INVOCATION_REQUESTED",
  "RECOMMENDATION_PRODUCED",
  "EXECUTION_REQUESTED",
  "EXECUTION_APPROVED",
  "EXECUTION_REJECTED",
  "RESULT_RECEIVED",
  "EXECUTION_COMPLETED",
  "EXECUTION_FAILED",
] as const;
export type MandateEventType = (typeof mandateEventTypes)[number];

const decimalSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/, "Must be a non-negative decimal string");
const tokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/ -]*$/);
const contractSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const mandateAmountLimitSchema = z.object({
  asset: tokenSchema,
  amount: decimalSchema,
});

export const mandateFrequencySchema = z.object({
  maxActions: z.number().int().positive().max(10_000),
  windowSeconds: z.number().int().positive().max(31_536_000),
});

export const mandateConfigurationSchema = z
  .object({
    objective: z.string().trim().min(12).max(1_000),
    allowedCapabilities: z.array(tokenSchema).min(1).max(50),
    deniedCapabilities: z.array(tokenSchema).max(50).default([]),
    allowedAssets: z.array(tokenSchema).max(50).default([]),
    allowedProtocols: z.array(tokenSchema).max(50).default([]),
    allowedContracts: z.array(contractSchema).max(50).default([]),
    perActionLimit: mandateAmountLimitSchema.nullable().default(null),
    aggregateLimit: mandateAmountLimitSchema.nullable().default(null),
    executionFrequency: mandateFrequencySchema.nullable().default(null),
    startAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    approvalMode: z.enum(mandateApprovalModes),
    riskConstraints: z.record(z.string(), z.unknown()).default({}),
    stopConditions: z.array(z.record(z.string(), z.unknown())).max(30),
  })
  .strict();

export type MandateConfiguration = z.infer<typeof mandateConfigurationSchema>;

export const createMandateRequestSchema = mandateConfigurationSchema.extend({
  agentId: z.uuid(),
  chainId: z.union([z.literal(56), z.literal(97)]),
});
export type CreateMandateRequest = z.infer<typeof createMandateRequestSchema>;

export interface VerifiedMandateProfile {
  agentId: string;
  agentName: string;
  tier: "Actionable";
  chainId: 56 | 97;
  network: "BNB Chain" | "BNB Chain Testnet";
  serviceId: string;
  serviceEndpoint: string;
  serviceVerificationLevel: "INVOCATION_VERIFIED" | "COMMERCE_VERIFIED";
  verificationTimestamp: string;
  capabilitySet: string[];
  supportedAssets: string[];
  supportedProtocols: string[];
  supportedContracts: string[];
  approvalModes: MandateApprovalMode[];
  transactional: boolean;
  current: boolean;
  attentionReason: string | null;
}

export interface MandateEvidenceBinding {
  agentId: string;
  externalAgentId: string;
  registryAddress: string;
  serviceId: string;
  serviceEndpoint: string;
  verificationTier: "Actionable";
  verificationTimestamp: string;
  chainId: 56 | 97;
  capabilitySet: string[];
  evidenceSnapshot: Record<string, unknown>;
}

export interface MandateVersion extends MandateConfiguration {
  id: string;
  mandateId: string;
  version: number;
  state: MandateStatus;
  createdAt: string;
  approvedAt: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  evidence: MandateEvidenceBinding;
}

export interface MandateEvent {
  id: string;
  mandateId: string;
  mandateVersionId: string | null;
  type: MandateEventType;
  securitySensitive: boolean;
  details: Record<string, unknown>;
  evidenceReferences: Record<string, unknown>;
  occurredAt: string;
}

export interface Mandate {
  id: string;
  principalId: string;
  principalType: "DEVELOPMENT_SESSION" | "ACCOUNT" | "WALLET";
  agentId: string;
  chainId: 56 | 97;
  status: MandateStatus;
  authorizationBoundary: "POLICY_ONLY" | "WALLET_AUTHORIZED";
  currentVersion: number;
  activeVersion: number | null;
  attentionReason: string | null;
  createdAt: string;
  updatedAt: string;
  version: MandateVersion;
  events: MandateEvent[];
}

export interface MandateListItem {
  mandate: Mandate;
  agent: {
    id: string;
    name: string;
    network: "BNB Chain" | "BNB Chain Testnet";
    tier: "Actionable";
  };
  lastActivityAt: string;
  nextExpectedAction: string;
}

export interface MandatePersistence {
  createMandate(input: {
    principalId: string;
    principalType: Mandate["principalType"];
    profile: VerifiedMandateProfile;
    configuration: MandateConfiguration;
    evidence: MandateEvidenceBinding;
  }): Promise<Mandate>;
  findMandate(id: string, principalId: string): Promise<Mandate | null>;
  listMandates(principalId: string): Promise<MandateListItem[]>;
  transitionMandate(input: {
    id: string;
    principalId: string;
    from: MandateStatus[];
    to: MandateStatus;
    event: MandateEventType;
    securitySensitive: boolean;
    details?: Record<string, unknown>;
    evidenceReferences?: Record<string, unknown>;
    activateCurrentVersion?: boolean;
  }): Promise<Mandate | null>;
  createMandateVersion(input: {
    id: string;
    principalId: string;
    profile: VerifiedMandateProfile;
    configuration: MandateConfiguration;
    evidence: MandateEvidenceBinding;
  }): Promise<Mandate | null>;
  markAttentionRequired(input: {
    id: string;
    principalId: string;
    reason: string;
  }): Promise<Mandate | null>;
}

export class MandateValidationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MandateValidationError";
  }
}

const canonical = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_-]+/g, "_");
const includesCanonical = (values: string[], value: string) =>
  values.some((candidate) => canonical(candidate) === canonical(value));
const decimal = (value: string) => Number.parseFloat(value);

const transactionCapabilities = [
  "transfer_tokens",
  "borrow_assets",
  "repay_debt",
  "swap_assets",
  "approve_contracts",
  "submit_transactions",
];

export function mandateProfileForAgent(
  agent: PublicMarketplaceAgentDetail,
  now = new Date(),
  freshnessDays = 7,
): VerifiedMandateProfile {
  if (agent.tier !== "Actionable")
    throw new MandateValidationError(
      "agent_not_actionable",
      "Only Actionable agents can enter activation.",
    );
  const service = agent.services
    .filter((candidate) =>
      ["INVOCATION_VERIFIED", "COMMERCE_VERIFIED"].includes(
        candidate.verificationLevel,
      ),
    )
    .sort(
      (left, right) =>
        Date.parse(right.lastVerifiedAt) - Date.parse(left.lastVerifiedAt),
    )[0];
  if (service === undefined)
    throw new MandateValidationError(
      "verified_service_missing",
      "No currently verified service is available for activation.",
    );
  const current =
    Date.parse(service.lastVerifiedAt) >=
      now.getTime() - freshnessDays * 86_400_000 &&
    agent.availability === "available";
  const isHealthMonitor = agent.category === "health-factor-monitoring";
  const evidenceText = [
    agent.description,
    ...agent.protocols,
    ...agent.surfacedBecause,
  ].join(" ");
  const venusVerified = /\bvenus\b/i.test(evidenceText);
  const capabilitySet = isHealthMonitor
    ? [
        "monitor_positions",
        "calculate_health_factor",
        "generate_alerts",
        "generate_recommendations",
      ]
    : [...new Set(agent.capabilities.map(canonical))];
  return {
    agentId: agent.id,
    agentName: agent.name,
    tier: "Actionable",
    chainId: agent.chainId,
    network: agent.network,
    serviceId: service.id,
    serviceEndpoint: service.endpoint,
    serviceVerificationLevel: service.verificationLevel,
    verificationTimestamp: service.lastVerifiedAt,
    capabilitySet,
    supportedAssets: [],
    supportedProtocols: venusVerified ? ["Venus"] : agent.protocols,
    supportedContracts: [],
    approvalModes: isHealthMonitor
      ? ["OBSERVE_ONLY"]
      : agent.capabilities.some((item) =>
            transactionCapabilities.includes(canonical(item)),
          )
        ? ["OBSERVE_ONLY", "ASK_BEFORE_EXECUTION", "PRE_AUTHORIZED"]
        : ["OBSERVE_ONLY"],
    transactional:
      !isHealthMonitor &&
      agent.capabilities.some((item) =>
        transactionCapabilities.includes(canonical(item)),
      ),
    current,
    attentionReason: current
      ? null
      : "The independently verified service evidence is stale or unavailable.",
  };
}

export function validateMandateConfiguration(
  request: CreateMandateRequest,
  profile: VerifiedMandateProfile,
  now = new Date(),
): MandateConfiguration {
  const parsed = createMandateRequestSchema.parse(request);
  if (!profile.current)
    throw new MandateValidationError(
      "stale_agent",
      profile.attentionReason ?? "Agent evidence is not current.",
    );
  if (parsed.agentId !== profile.agentId)
    throw new MandateValidationError(
      "agent_mismatch",
      "The mandate agent does not match the verified activation profile.",
    );
  if (parsed.chainId !== profile.chainId)
    throw new MandateValidationError(
      "network_mismatch",
      "The mandate network does not match the verified agent network.",
    );
  if (!profile.approvalModes.includes(parsed.approvalMode))
    throw new MandateValidationError(
      "unsupported_approval_mode",
      "The agent has not been verified for this approval mode.",
    );
  for (const capability of parsed.allowedCapabilities)
    if (!includesCanonical(profile.capabilitySet, capability))
      throw new MandateValidationError(
        "unsupported_capability",
        `The agent has not been verified for capability: ${capability}.`,
      );
  for (const denied of parsed.deniedCapabilities)
    if (includesCanonical(parsed.allowedCapabilities, denied))
      throw new MandateValidationError(
        "permission_conflict",
        `Capability cannot be both allowed and denied: ${denied}.`,
      );
  for (const asset of parsed.allowedAssets)
    if (!includesCanonical(profile.supportedAssets, asset))
      throw new MandateValidationError(
        "unsupported_asset",
        `The agent has not been verified to use asset: ${asset}.`,
      );
  for (const protocol of parsed.allowedProtocols)
    if (!includesCanonical(profile.supportedProtocols, protocol))
      throw new MandateValidationError(
        "unsupported_protocol",
        `The agent has not been verified for protocol: ${protocol}.`,
      );
  for (const contract of parsed.allowedContracts)
    if (!includesCanonical(profile.supportedContracts, contract))
      throw new MandateValidationError(
        "unsupported_contract",
        `The agent has not been verified for contract: ${contract}.`,
      );
  if (
    parsed.approvalMode === "OBSERVE_ONLY" &&
    (parsed.allowedCapabilities.some((item) =>
      transactionCapabilities.includes(canonical(item)),
    ) ||
      parsed.perActionLimit !== null ||
      parsed.aggregateLimit !== null ||
      parsed.executionFrequency !== null)
  )
    throw new MandateValidationError(
      "observe_only_escalation",
      "Observe-only mandates cannot include transaction authority or spending limits.",
    );
  if (
    parsed.perActionLimit !== null &&
    parsed.aggregateLimit !== null &&
    (!includesCanonical(
      [parsed.aggregateLimit.asset],
      parsed.perActionLimit.asset,
    ) ||
      decimal(parsed.perActionLimit.amount) >
        decimal(parsed.aggregateLimit.amount))
  )
    throw new MandateValidationError(
      "invalid_limits",
      "The per-action limit must use the aggregate asset and cannot exceed the aggregate limit.",
    );
  const startAt = new Date(parsed.startAt);
  const expiresAt = new Date(parsed.expiresAt);
  if (expiresAt <= startAt || expiresAt <= now)
    throw new MandateValidationError(
      "invalid_expiry",
      "Expiry must be in the future and after the mandate start time.",
    );
  return {
    objective: parsed.objective,
    allowedCapabilities: parsed.allowedCapabilities,
    deniedCapabilities: parsed.deniedCapabilities,
    allowedAssets: parsed.allowedAssets,
    allowedProtocols: parsed.allowedProtocols,
    allowedContracts: parsed.allowedContracts,
    perActionLimit: parsed.perActionLimit,
    aggregateLimit: parsed.aggregateLimit,
    executionFrequency: parsed.executionFrequency,
    startAt: parsed.startAt,
    expiresAt: parsed.expiresAt,
    approvalMode: parsed.approvalMode,
    riskConstraints: parsed.riskConstraints,
    stopConditions: parsed.stopConditions,
  };
}

export function mandateEvidenceBinding(
  agent: PublicMarketplaceAgentDetail,
  profile: VerifiedMandateProfile,
): MandateEvidenceBinding {
  return {
    agentId: agent.id,
    externalAgentId: agent.externalAgentId,
    registryAddress: agent.registryAddress,
    serviceId: profile.serviceId,
    serviceEndpoint: profile.serviceEndpoint,
    verificationTier: "Actionable",
    verificationTimestamp: profile.verificationTimestamp,
    chainId: profile.chainId,
    capabilitySet: [...profile.capabilitySet],
    evidenceSnapshot: {
      checks: agent.checks,
      serviceVerificationLevel: profile.serviceVerificationLevel,
      evidence: agent.evidence.map((item) => ({
        fieldPath: item.fieldPath,
        provenance: item.provenance,
        source: item.source,
        sourceUri: item.sourceUri,
        observedAt: item.observedAt,
      })),
    },
  };
}

export function humanReadableMandate(
  agentName: string,
  network: string,
  version: Pick<
    MandateVersion,
    | "objective"
    | "allowedCapabilities"
    | "deniedCapabilities"
    | "allowedAssets"
    | "allowedProtocols"
    | "allowedContracts"
    | "perActionLimit"
    | "aggregateLimit"
    | "executionFrequency"
    | "approvalMode"
    | "expiresAt"
    | "stopConditions"
  >,
) {
  return {
    heading: `You are authorizing ${agentName} to:`,
    objective: version.objective,
    may: version.allowedCapabilities.map((item) => item.replaceAll("_", " ")),
    mayNot: version.deniedCapabilities.map((item) => item.replaceAll("_", " ")),
    assets:
      version.allowedAssets.length === 0
        ? ["No asset spending authority"]
        : version.allowedAssets,
    protocols: version.allowedProtocols,
    contracts: version.allowedContracts,
    perActionLimit: version.perActionLimit,
    aggregateLimit: version.aggregateLimit,
    executionFrequency: version.executionFrequency,
    approvalMode: version.approvalMode,
    network,
    expiresAt: version.expiresAt,
    stopConditions: version.stopConditions,
    revocable: true,
  };
}

export function assertExecutionAuthorized(input: {
  mandate: Mandate;
  profile: VerifiedMandateProfile;
  capability: string;
  asset?: string;
  amount?: string;
  aggregateUsed?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (input.mandate.status !== "ACTIVE")
    throw new MandateValidationError(
      "mandate_not_active",
      "Paused, revoked, expired, draft, and superseded mandates cannot authorize execution.",
    );
  if (!input.profile.current)
    throw new MandateValidationError(
      "stale_agent",
      "Current agent evidence no longer meets Relic's eligibility threshold.",
    );
  if (input.mandate.activeVersion !== input.mandate.version.version)
    throw new MandateValidationError(
      "inactive_version",
      "This mandate version is not the active authorization version.",
    );
  if (new Date(input.mandate.version.expiresAt) <= now)
    throw new MandateValidationError(
      "mandate_expired",
      "The mandate has expired.",
    );
  if (
    !includesCanonical(
      input.mandate.version.allowedCapabilities,
      input.capability,
    )
  )
    throw new MandateValidationError(
      "capability_denied",
      "The requested capability is not allowed by this mandate.",
    );
  if (
    input.asset !== undefined &&
    !includesCanonical(input.mandate.version.allowedAssets, input.asset)
  )
    throw new MandateValidationError(
      "asset_denied",
      "The requested asset is not allowed by this mandate.",
    );
  const amount = input.amount === undefined ? 0 : decimal(input.amount);
  const perAction = input.mandate.version.perActionLimit;
  if (perAction !== null && amount > decimal(perAction.amount))
    throw new MandateValidationError(
      "per_action_limit_exceeded",
      "The requested amount exceeds the mandate's per-action limit.",
    );
  const aggregate = input.mandate.version.aggregateLimit;
  if (
    aggregate !== null &&
    amount + decimal(input.aggregateUsed ?? "0") > decimal(aggregate.amount)
  )
    throw new MandateValidationError(
      "aggregate_limit_exceeded",
      "The requested amount exceeds the mandate's remaining aggregate limit.",
    );
  return {
    authorized: true as const,
    approvalMode: input.mandate.version.approvalMode,
  };
}

export function nextExpectedMandateAction(mandate: Mandate) {
  if (mandate.attentionReason !== null) return "Review verification warning";
  return (
    {
      DRAFT: "Review mandate",
      REVIEWED: "Approve activation",
      ACTIVE: "Monitoring under mandate",
      PAUSED: "Resume or revoke",
      REVOKED: "No further action",
      EXPIRED: "Create a new mandate",
      FAILED_ACTIVATION: "Review activation failure",
      SUPERSEDED: "Review latest version",
    } satisfies Record<MandateStatus, string>
  )[mandate.status];
}
