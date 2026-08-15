import { z } from "zod";

import { provenanceKindSchema } from "./model.js";

export const launchCandidateStatusSchema = z.enum([
  "DISCOVERED",
  "REVIEW_PENDING",
  "IDENTITY_VERIFIED",
  "SERVICE_IDENTIFIED",
  "SERVICE_OBSERVED",
  "INVOCATION_VERIFIED",
  "ACTIONABLE",
  "REJECTED",
  "STALE",
]);

export const serviceVerificationLevelSchema = z.enum([
  "DECLARED",
  "ENDPOINT_OBSERVED",
  "SCHEMA_UNDERSTOOD",
  "PAYMENT_UNDERSTOOD",
  "INVOCATION_VERIFIED",
  "COMMERCE_VERIFIED",
]);

export const activationStatusSchema = z.enum([
  "PREPARED",
  "TERMS_RESOLVED",
  "JOB_CREATED",
  "FUNDED",
  "SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "FAILED",
  "BLOCKED",
]);

export const marketplaceServiceSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  sourceServiceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  capability: z.string().nullable(),
  category: z.string().nullable(),
  interface: z.string(),
  endpoint: z.string().nullable(),
  httpMethod: z.string().nullable(),
  inputSchema: z.unknown().nullable(),
  outputSchema: z.unknown().nullable(),
  pricing: z.unknown().nullable(),
  currencyToken: z.string().nullable(),
  networkChainId: z.number().int().positive().nullable(),
  sla: z.unknown().nullable(),
  authenticationRequirements: z.unknown().nullable(),
  protocolSupport: z.record(z.string(), z.unknown()),
  availability: z.enum(["unknown", "available", "degraded", "unavailable"]),
  verificationLevel: serviceVerificationLevelSchema,
  lastVerifiedAt: z.iso.datetime().nullable(),
  source: z.string(),
  provenance: provenanceKindSchema,
  updatedAt: z.iso.datetime(),
});

export type LaunchCandidateStatus = z.infer<typeof launchCandidateStatusSchema>;
export type ServiceVerificationLevel = z.infer<
  typeof serviceVerificationLevelSchema
>;
export type ActivationStatus = z.infer<typeof activationStatusSchema>;
export type MarketplaceService = z.infer<typeof marketplaceServiceSchema>;

export interface ServiceListQuery {
  readonly verificationLevel?: ServiceVerificationLevel;
  readonly category?: string;
  readonly interface?: string;
  readonly actionable?: boolean;
}

export interface ServiceReadRepository {
  listAgentServices(
    agentId: string,
    query?: ServiceListQuery,
  ): Promise<MarketplaceService[]>;
  findService(id: string): Promise<MarketplaceService | null>;
}
