import { z } from "zod";

export const marketplaceCategories = [
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor-monitoring",
] as const;

export const taxonomyKindSchema = z.enum([
  "category",
  "capability",
  "tag",
  "protocol",
  "asset",
  "chain",
]);

export const provenanceKindSchema = z.enum([
  "onchain_verified",
  "independently_observed",
  "agent_reported",
  "developer_declared",
  "secondary_unverified",
]);

export const evidenceSchema = z.object({
  provenance: provenanceKindSchema,
  source: z.string().min(1).max(100),
  sourceUri: z.string().min(1).optional(),
  observedAt: z.iso.datetime(),
  chainId: z.number().int().positive().optional(),
  transactionHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  blockNumber: z.string().regex(/^\d+$/).optional(),
  contentHash: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const sourcedStringSchema = z.object({
  value: z.string(),
  evidence: z.array(evidenceSchema).min(1),
});

export const optionalSourcedStringSchema = sourcedStringSchema.nullable();

export const agentIdentitySchema = z.object({
  standard: z.literal("erc-8004"),
  namespace: z.literal("eip155"),
  chainId: z.number().int().positive(),
  registryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  agentId: z.string().regex(/^\d+$/),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  registrationStatus: z.enum([
    "registered",
    "transferred",
    "deregistered",
    "unknown",
  ]),
  registrationTransaction: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .nullable(),
  registrationBlock: z.string().regex(/^\d+$/).nullable(),
  registeredAt: z.iso.datetime().nullable(),
  fieldEvidence: z.record(z.string(), z.array(evidenceSchema).min(1)),
});

export const agentProfileSchema = z.object({
  name: optionalSourcedStringSchema,
  description: optionalSourcedStringSchema,
  imageUrl: optionalSourcedStringSchema,
  websiteUrl: optionalSourcedStringSchema,
  metadataUri: sourcedStringSchema,
  developerIdentity: optionalSourcedStringSchema,
});

export const taxonomyAssignmentSchema = z.object({
  kind: taxonomyKindSchema,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().min(1).max(100),
  evidence: z.array(evidenceSchema).min(1),
});

export const serviceSchema = z.object({
  externalId: z.string().min(1).nullable(),
  name: z.string().min(1),
  capability: z.string().nullable(),
  description: z.string().nullable(),
  inputSchema: z.record(z.string(), z.unknown()).nullable(),
  outputSchema: z.record(z.string(), z.unknown()).nullable(),
  pricing: z.record(z.string(), z.unknown()).nullable(),
  endpoint: z.string().min(1).nullable(),
  sla: z.record(z.string(), z.unknown()).nullable(),
  availabilityStatus: z.enum([
    "unknown",
    "available",
    "degraded",
    "unavailable",
  ]),
  evidence: z.array(evidenceSchema).min(1),
});

export const metricSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  value: z.union([z.number(), z.string(), z.boolean()]),
  unit: z.string().min(1).nullable(),
  window: z.string().min(1).nullable(),
  measuredAt: z.iso.datetime(),
  evidence: z.array(evidenceSchema).min(1),
});

export const reputationSignalSchema = z.object({
  kind: z.string().min(1),
  value: z.union([z.number(), z.string(), z.boolean()]),
  scale: z.string().nullable(),
  recordedAt: z.iso.datetime(),
  evidence: z.array(evidenceSchema).min(1),
});

export const availabilityObservationSchema = z.object({
  status: z.enum(["unknown", "available", "degraded", "unavailable"]),
  heartbeatAt: z.iso.datetime().nullable(),
  lastSuccessfulContactAt: z.iso.datetime().nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  uptimeRatio: z.number().min(0).max(1).nullable(),
  observedAt: z.iso.datetime(),
  evidence: z.array(evidenceSchema).min(1),
});

export const canonicalAgentSchema = z.object({
  id: z.uuid(),
  identity: agentIdentitySchema,
  profile: agentProfileSchema,
  taxonomy: z.array(taxonomyAssignmentSchema),
  services: z.array(serviceSchema),
  metrics: z.array(metricSchema),
  reputation: z.array(reputationSignalSchema),
  availability: z.array(availabilityObservationSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CanonicalAgent = z.infer<typeof canonicalAgentSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ProvenanceKind = z.infer<typeof provenanceKindSchema>;
export type TaxonomyKind = z.infer<typeof taxonomyKindSchema>;
