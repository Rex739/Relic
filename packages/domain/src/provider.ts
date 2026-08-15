import { z } from "zod";

export const registryMetadataSchema = z
  .object({
    type: z.string().optional(),
    name: z
      .string()
      .min(1)
      .nullish()
      .transform((value) => value ?? undefined),
    description: z
      .string()
      .nullish()
      .transform((value) => value ?? undefined),
    image: z
      .string()
      .nullish()
      .transform((value) => value ?? undefined),
    website: z
      .string()
      .nullish()
      .transform((value) => value ?? undefined),
    services: z
      .array(
        z
          .object({
            id: z.string().optional(),
            name: z.string().min(1),
            endpoint: z.string().optional(),
            version: z.string().optional(),
            description: z.string().optional(),
            skills: z.array(z.string()).optional(),
            domains: z.array(z.string()).optional(),
          })
          .passthrough(),
      )
      .default([]),
    registrations: z
      .array(
        z.object({
          agentId: z.union([z.string(), z.number()]).nullable(),
          agentRegistry: z.string(),
        }),
      )
      .optional(),
    supportedTrust: z.array(z.string()).optional(),
    active: z.boolean().optional(),
  })
  .passthrough();

export const registryAgentRecordSchema = z.object({
  source: z.string().min(1),
  chainId: z.number().int().positive(),
  registryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  agentId: z.string().regex(/^\d+$/),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  metadataUri: z.string().min(1),
  metadata: z.unknown(),
  metadataResolution: z
    .object({
      status: z.enum(["resolved", "empty", "failed"]),
      error: z.string().optional(),
      contentHash: z.string().optional(),
    })
    .optional(),
  registrationTransaction: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .nullable(),
  registrationBlock: z.string().regex(/^\d+$/).nullable(),
  registeredAt: z.iso.datetime().nullable(),
  fetchedAt: z.iso.datetime(),
  raw: z.unknown(),
});

export type RegistryAgentRecord = z.infer<typeof registryAgentRecordSchema>;

export interface AgentRegistryCursor {
  readonly blockNumber?: bigint;
  readonly logIndex?: number;
}

export interface AgentRegistryListOptions {
  readonly cursor?: AgentRegistryCursor;
  readonly limit: number;
}

export interface AgentRegistryPage {
  readonly agents: RegistryAgentRecord[];
  readonly nextCursor: AgentRegistryCursor | null;
}

export interface AgentRegistryProvider {
  readonly providerId: string;
  getAgent(agentId: string): Promise<RegistryAgentRecord | null>;
  listAgents(options: AgentRegistryListOptions): Promise<AgentRegistryPage>;
}

export class UpstreamAgentValidationError extends Error {
  public constructor(
    message: string,
    public readonly issues: readonly string[],
  ) {
    super(message);
    this.name = "UpstreamAgentValidationError";
  }
}
