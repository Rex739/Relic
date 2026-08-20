import { z } from "zod";

import { provenanceKindSchema } from "./model.js";
import type { MarketplaceService, ServiceListQuery } from "./supply.js";

export const agentListItemSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  chainId: z.number().int().positive(),
  registryAddress: z.string(),
  externalAgentId: z.string(),
  categories: z.array(z.string()),
  capabilities: z.array(z.string()),
  interfaces: z.array(z.string()),
  readiness: z
    .enum(["NOT_READY", "PARTIAL", "DISCOVERABLE", "ACTIONABLE"])
    .nullable(),
  verificationStatus: z
    .enum(["unverified", "pending", "verified", "partial", "failed", "stale"])
    .nullable(),
  completenessPercent: z.number().int().min(0).max(100).nullable(),
  updatedAt: z.iso.datetime(),
});

export const agentDetailSchema = agentListItemSchema.extend({
  websiteUrl: z.string().nullable(),
  metadataUri: z.string(),
  ownerAddress: z.string(),
  registrationStatus: z.string(),
  registrationTransaction: z.string().nullable(),
  registrationBlock: z.string().nullable(),
  registeredAt: z.iso.datetime().nullable(),
  taxonomy: z.array(
    z.object({ kind: z.string(), slug: z.string(), label: z.string() }),
  ),
  services: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      capability: z.string().nullable(),
      description: z.string().nullable(),
      endpoint: z.string().nullable(),
      availabilityStatus: z.string(),
    }),
  ),
  provenance: z.array(
    z.object({
      fieldPath: z.string(),
      provenance: provenanceKindSchema,
      source: z.string(),
      sourceUri: z.string().nullable(),
      observedAt: z.iso.datetime(),
    }),
  ),
});

export type AgentListItem = z.infer<typeof agentListItemSchema>;
export type AgentDetail = z.infer<typeof agentDetailSchema>;

export interface AgentListQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly category?: string;
  readonly capability?: string;
  readonly interface?: string;
  readonly readiness?: "NOT_READY" | "PARTIAL" | "DISCOVERABLE" | "ACTIONABLE";
  readonly verificationStatus?:
    "unverified" | "pending" | "verified" | "partial" | "failed" | "stale";
}

export interface AgentListResult {
  readonly items: AgentListItem[];
  readonly nextCursor: string | null;
}

export interface AgentReadRepository {
  list(query: AgentListQuery): Promise<AgentListResult>;
  findById(id: string): Promise<AgentDetail | null>;
  findByChainIdentity?(
    chainId: number,
    externalAgentId: string,
  ): Promise<AgentDetail | null>;
  listCategories?(): Promise<Array<{ slug: string; label: string }>>;
  dataQuality?(): Promise<Record<string, unknown>>;
  corpusStatus?(chainId: number): Promise<Record<string, unknown>>;
  listAgentServices?(
    agentId: string,
    query?: ServiceListQuery,
  ): Promise<MarketplaceService[]>;
  findService?(id: string): Promise<MarketplaceService | null>;
}
