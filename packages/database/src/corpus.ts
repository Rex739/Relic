import { createHash, randomUUID } from "node:crypto";

import type {
  ScanAccessMode,
  ScanAgent,
  ScanOperationalMode,
  ScanRateLimit,
} from "@relic/blockchain";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  agentIdentities,
  agentQualityProfiles,
  agents,
  agentTaxonomy,
  classificationEvidence,
  corpusImportCheckpoints,
  corpusImportRuns,
  corpusSourceRecords,
  duplicateSignals,
  endpointObservations,
  factEvidence,
  ingestionRecords,
  metadataHistory,
  reputationInventory,
  serviceDeclarations,
  taxonomyTerms,
  verificationObservations,
  verificationQueue,
} from "./schema.js";

export interface CorpusDerivedData {
  services: Array<{
    rawName: string;
    normalizedType: string;
    endpoint: string | null;
    malformed: boolean;
    raw: Record<string, unknown>;
  }>;
  capabilities: string[];
  classifications: Array<{
    categorySlug: string;
    confidence: string;
    evidenceType: string;
    matchedSource: string;
    matchedValue: string;
  }>;
  quality: {
    completenessPercent: number;
    readiness: "NOT_READY" | "PARTIAL" | "DISCOVERABLE" | "ACTIONABLE";
    facts: Record<string, boolean>;
    ruleVersion: string;
  };
  priority: number;
}

export interface CorpusCounters {
  pages: number;
  seen: number;
  imported: number;
  rejected: number;
}

export interface CorpusDiscoveryRecord {
  agent: ScanAgent;
  raw: unknown;
  fetchedAt: Date;
}

export interface CorpusMalformedRecord {
  raw: unknown;
  page: number;
  index: number;
  error: unknown;
}

export interface CorpusEnrichmentRecord {
  agent: ScanAgent;
  derived: CorpusDerivedData;
  fetchedAt: Date;
}

export interface CorpusPersistenceMetrics {
  persisted: number;
  malformed: number;
  statements: number;
  transactionCount: number;
  durationMs: number;
}

const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stableAgentUuid = (value: string) => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(
    (Number.parseInt(hex.slice(16, 18), 16) & 0x3f) |
    0x80
  )
    .toString(16)
    .padStart(2, "0")}${hex.slice(18, 20)}-${hex.slice(20)}`;
};
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Unknown corpus operation failure";

export class DrizzleCorpusStore {
  constructor(
    private readonly database: RelicDatabase,
    private readonly provider = "8004scan",
  ) {}

  async checkpoint(chainId: number, registryAddress: string, pageSize: number) {
    const [row] = await this.database
      .select()
      .from(corpusImportCheckpoints)
      .where(
        and(
          eq(corpusImportCheckpoints.provider, this.provider),
          eq(corpusImportCheckpoints.chainId, chainId),
          eq(
            corpusImportCheckpoints.registryAddress,
            registryAddress.toLowerCase(),
          ),
        ),
      )
      .limit(1);
    if (row !== undefined) return row;
    const [created] = await this.database
      .insert(corpusImportCheckpoints)
      .values({
        provider: this.provider,
        chainId,
        registryAddress: registryAddress.toLowerCase(),
        pageSize,
      })
      .returning();
    if (created === undefined)
      throw new Error("Corpus checkpoint creation failed");
    return created;
  }

  async repageCheckpoint(input: {
    chainId: number;
    registryAddress: string;
    previousNextPage: number;
    previousPageSize: number;
    nextPageSize: number;
  }) {
    const processedOffset =
      (input.previousNextPage - 1) * input.previousPageSize;
    const nextPage = Math.floor(processedOffset / input.nextPageSize) + 1;
    const [updated] = await this.database
      .update(corpusImportCheckpoints)
      .set({
        nextPage,
        pageSize: input.nextPageSize,
        status: "partial",
        error: {
          message: `Page size changed from ${input.previousPageSize} to ${input.nextPageSize}; resuming with a safe overlap`,
          previousNextPage: input.previousNextPage,
          processedOffset,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(corpusImportCheckpoints.provider, this.provider),
          eq(corpusImportCheckpoints.chainId, input.chainId),
          eq(
            corpusImportCheckpoints.registryAddress,
            input.registryAddress.toLowerCase(),
          ),
          eq(corpusImportCheckpoints.nextPage, input.previousNextPage),
          eq(corpusImportCheckpoints.pageSize, input.previousPageSize),
        ),
      )
      .returning();
    if (updated === undefined)
      throw new Error("Corpus checkpoint changed during page-size transition");
    return updated;
  }

  async startRun(input: {
    chainId: number;
    registryAddress: string;
    startPage: number;
    pageSize: number;
    accessMode: ScanAccessMode;
    requestBudget: number;
  }): Promise<string> {
    const id = randomUUID();
    await this.database.insert(corpusImportRuns).values({
      id,
      provider: this.provider,
      chainId: input.chainId,
      registryAddress: input.registryAddress.toLowerCase(),
      startPage: input.startPage,
      pageSize: input.pageSize,
      accessMode: input.accessMode,
      operationalMode: input.accessMode,
      requestBudget: input.requestBudget,
      status: "running",
      startedAt: new Date(),
    });
    await this.database
      .update(corpusImportCheckpoints)
      .set({
        status: "running",
        accessMode: input.accessMode,
        operationalMode: input.accessMode,
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(corpusImportCheckpoints.provider, this.provider),
          eq(corpusImportCheckpoints.chainId, input.chainId),
          eq(
            corpusImportCheckpoints.registryAddress,
            input.registryAddress.toLowerCase(),
          ),
        ),
      );
    return id;
  }

  async anonymousRequestsSince(since: Date): Promise<number> {
    const [row] = await this.database
      .select({
        count: sql<number>`coalesce(sum(${corpusImportRuns.requestCount}), 0)`,
      })
      .from(corpusImportRuns)
      .where(
        and(
          eq(corpusImportRuns.provider, this.provider),
          eq(corpusImportRuns.accessMode, "anonymous"),
          gte(corpusImportRuns.startedAt, since),
        ),
      );
    return Number(row?.count ?? 0);
  }

  async recoverRunningImports(input: {
    chainId: number;
    registryAddress: string;
    reason: string;
  }): Promise<number> {
    const now = new Date();
    return this.database.transaction(async (transaction) => {
      const recovered = await transaction
        .update(corpusImportRuns)
        .set({
          status: "failed",
          requestCount: sql`greatest(${corpusImportRuns.requestCount}, 1)`,
          degradedReason: "interrupted_before_page_commit",
          error: { message: input.reason },
          finishedAt: now,
        })
        .where(
          and(
            eq(corpusImportRuns.provider, this.provider),
            eq(corpusImportRuns.chainId, input.chainId),
            eq(
              corpusImportRuns.registryAddress,
              input.registryAddress.toLowerCase(),
            ),
            eq(corpusImportRuns.status, "running"),
          ),
        )
        .returning({ id: corpusImportRuns.id });
      if (recovered.length > 0)
        await transaction
          .update(corpusImportCheckpoints)
          .set({
            status: "partial",
            error: { message: input.reason },
            updatedAt: now,
          })
          .where(
            and(
              eq(corpusImportCheckpoints.provider, this.provider),
              eq(corpusImportCheckpoints.chainId, input.chainId),
              eq(
                corpusImportCheckpoints.registryAddress,
                input.registryAddress.toLowerCase(),
              ),
            ),
          );
      return recovered.length;
    });
  }

  async recordProviderRequest(input: {
    chainId: number;
    registryAddress: string;
    accessMode: ScanAccessMode;
    operationalMode: ScanOperationalMode;
    requestCount: number;
    status: number | null;
    rateLimit: ScanRateLimit;
  }): Promise<void> {
    await this.database
      .update(corpusImportRuns)
      .set({
        accessMode: input.accessMode,
        operationalMode: input.operationalMode,
        requestCount: input.requestCount,
        rateLimit: input.rateLimit.limit,
        rateLimitRemaining: input.rateLimit.remaining,
        rateLimitResetAt:
          input.rateLimit.resetAt === null
            ? null
            : new Date(input.rateLimit.resetAt),
        degradedReason:
          input.operationalMode === "rate_limited_degraded"
            ? `8004scan returned HTTP ${input.status ?? "unknown"}`
            : null,
      })
      .where(
        and(
          eq(corpusImportRuns.provider, this.provider),
          eq(corpusImportRuns.chainId, input.chainId),
          eq(
            corpusImportRuns.registryAddress,
            input.registryAddress.toLowerCase(),
          ),
          eq(corpusImportRuns.status, "running"),
        ),
      );
  }

  async persistDiscoveryPage(input: {
    records: CorpusDiscoveryRecord[];
    malformed: CorpusMalformedRecord[];
  }): Promise<CorpusPersistenceMetrics> {
    const startedAt = performance.now();
    if (input.records.length === 0 && input.malformed.length === 0)
      return {
        persisted: 0,
        malformed: 0,
        statements: 0,
        transactionCount: 0,
        durationMs: 0,
      };
    let statements = 0;
    await this.database.transaction(async (transaction) => {
      const externalIds = input.records.map(({ agent }) => agent.token_id);
      const first = input.records[0]?.agent;
      const existing =
        first === undefined
          ? []
          : await transaction
              .select({
                agentId: agentIdentities.agentId,
                externalAgentId: agentIdentities.externalAgentId,
              })
              .from(agentIdentities)
              .where(
                and(
                  eq(agentIdentities.namespace, "eip155"),
                  eq(agentIdentities.chainId, first.chain_id),
                  eq(
                    agentIdentities.registryAddress,
                    first.contract_address.toLowerCase(),
                  ),
                  inArray(agentIdentities.externalAgentId, externalIds),
                ),
              );
      if (first !== undefined) statements += 1;
      const existingIds = new Map(
        existing.map((row) => [row.externalAgentId, row.agentId]),
      );
      const prepared = input.records.map(({ agent, raw, fetchedAt }) => {
        if (!/^\d+$/.test(agent.token_id)) throw new Error("Invalid token_id");
        if (!addressPattern.test(agent.contract_address))
          throw new Error("Invalid contract_address");
        if (
          agent.owner_address == null ||
          !addressPattern.test(agent.owner_address)
        )
          throw new Error("Missing or invalid owner_address");
        const registryAddress = agent.contract_address.toLowerCase();
        const sourceCreatedAt = new Date(agent.created_at ?? fetchedAt);
        return {
          agent,
          raw,
          fetchedAt,
          registryAddress,
          ownerAddress: agent.owner_address.toLowerCase(),
          sourceCreatedAt: Number.isNaN(sourceCreatedAt.getTime())
            ? fetchedAt
            : sourceCreatedAt,
          internalId:
            existingIds.get(agent.token_id) ??
            stableAgentUuid(
              `${this.provider}:eip155:${agent.chain_id}:${registryAddress}:${agent.token_id}`,
            ),
          contentHash: sha256(raw),
        };
      });
      if (prepared.length > 0) {
        await transaction
          .insert(agents)
          .values(
            prepared.map((row) => ({
              id: row.internalId,
              name: row.agent.name ?? null,
              description: row.agent.description ?? null,
              imageUrl: row.agent.image_url ?? null,
              metadataUri: "",
              createdAt: row.sourceCreatedAt,
              updatedAt: row.fetchedAt,
            })),
          )
          .onConflictDoUpdate({
            target: agents.id,
            set: {
              name: sql`coalesce(${agents.name}, excluded.name)`,
              description: sql`coalesce(${agents.description}, excluded.description)`,
              imageUrl: sql`coalesce(${agents.imageUrl}, excluded.image_url)`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
        statements += 1;
        await transaction
          .insert(agentIdentities)
          .values(
            prepared.map((row) => ({
              agentId: row.internalId,
              standard: "erc-8004",
              namespace: "eip155",
              chainId: row.agent.chain_id,
              registryAddress: row.registryAddress,
              externalAgentId: row.agent.token_id,
              ownerAddress: row.ownerAddress,
              registrationStatus: "unknown",
              registeredAt: row.sourceCreatedAt,
              updatedAt: row.fetchedAt,
            })),
          )
          .onConflictDoUpdate({
            target: [
              agentIdentities.namespace,
              agentIdentities.chainId,
              agentIdentities.registryAddress,
              agentIdentities.externalAgentId,
            ],
            set: {
              ownerAddress: sql`excluded.owner_address`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
        statements += 1;
        await transaction
          .insert(corpusSourceRecords)
          .values(
            prepared.map((row) => ({
              provider: this.provider,
              sourceRecordId: row.agent.id,
              agentId: row.internalId,
              chainId: row.agent.chain_id,
              registryAddress: row.registryAddress,
              externalAgentId: row.agent.token_id,
              sourceUpdatedAt:
                row.agent.updated_at == null
                  ? null
                  : new Date(row.agent.updated_at),
              payload: row.raw,
              contentHash: row.contentHash,
              fetchedAt: row.fetchedAt,
              updatedAt: row.fetchedAt,
            })),
          )
          .onConflictDoUpdate({
            target: [
              corpusSourceRecords.provider,
              corpusSourceRecords.sourceRecordId,
            ],
            set: {
              agentId: sql`excluded.agent_id`,
              payload: sql`excluded.payload`,
              sourceUpdatedAt: sql`excluded.source_updated_at`,
              fetchedAt: sql`excluded.fetched_at`,
              enrichmentRuleVersion: sql`case when ${corpusSourceRecords.contentHash} = excluded.content_hash then ${corpusSourceRecords.enrichmentRuleVersion} else null end`,
              enrichedAt: sql`case when ${corpusSourceRecords.contentHash} = excluded.content_hash then ${corpusSourceRecords.enrichedAt} else null end`,
              enrichmentError: sql`case when ${corpusSourceRecords.contentHash} = excluded.content_hash then ${corpusSourceRecords.enrichmentError} else null end`,
              contentHash: sql`excluded.content_hash`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
        statements += 1;
      }
      if (input.malformed.length > 0) {
        await transaction.insert(ingestionRecords).values(
          input.malformed.map((record) => ({
            provider: this.provider,
            sourceKey: `page:${record.page}:record:${record.index}`,
            fetchedAt: new Date(),
            payload: record.raw,
            status: "failed" as const,
            error: { message: errorMessage(record.error) },
          })),
        );
        statements += 1;
      }
    });
    return {
      persisted: input.records.length,
      malformed: input.malformed.length,
      statements,
      transactionCount: 1,
      durationMs: performance.now() - startedAt,
    };
  }

  async persistEnrichmentBatch(
    records: CorpusEnrichmentRecord[],
  ): Promise<CorpusPersistenceMetrics> {
    const startedAt = performance.now();
    if (records.length === 0)
      return {
        persisted: 0,
        malformed: 0,
        statements: 0,
        transactionCount: 0,
        durationMs: 0,
      };
    let statements = 0;
    await this.database.transaction(async (transaction) => {
      const first = records[0]!.agent;
      const identities = await transaction
        .select({
          agentId: agentIdentities.agentId,
          externalAgentId: agentIdentities.externalAgentId,
          metadataUri: agents.metadataUri,
          verificationStatus: verificationQueue.status,
        })
        .from(agentIdentities)
        .innerJoin(agents, eq(agents.id, agentIdentities.agentId))
        .leftJoin(
          verificationQueue,
          eq(verificationQueue.agentId, agentIdentities.agentId),
        )
        .where(
          and(
            eq(agentIdentities.namespace, "eip155"),
            eq(agentIdentities.chainId, first.chain_id),
            eq(
              agentIdentities.registryAddress,
              first.contract_address.toLowerCase(),
            ),
            inArray(
              agentIdentities.externalAgentId,
              records.map(({ agent }) => agent.token_id),
            ),
          ),
        );
      statements += 1;
      const identityByExternalId = new Map(
        identities.map((row) => [row.externalAgentId, row]),
      );
      if (identityByExternalId.size !== records.length)
        throw new Error(
          "Offline enrichment requires every record to have a durably persisted discovery identity",
        );
      const agentIds = identities.map(({ agentId }) => agentId);
      const resolvedRows = await transaction
        .select({ agentId: metadataHistory.agentId })
        .from(metadataHistory)
        .where(
          and(
            inArray(metadataHistory.agentId, agentIds),
            eq(metadataHistory.resolutionStatus, "resolved"),
          ),
        );
      statements += 1;
      const resolvedIds = new Set(resolvedRows.map(({ agentId }) => agentId));
      await transaction
        .delete(factEvidence)
        .where(
          and(
            inArray(factEvidence.agentId, agentIds),
            eq(factEvidence.provenance, "secondary_unverified"),
            eq(factEvidence.source, this.provider),
          ),
        );
      await transaction
        .delete(serviceDeclarations)
        .where(
          and(
            inArray(serviceDeclarations.agentId, agentIds),
            eq(serviceDeclarations.source, this.provider),
          ),
        );
      await transaction
        .delete(classificationEvidence)
        .where(
          and(
            inArray(classificationEvidence.agentId, agentIds),
            eq(
              classificationEvidence.ruleVersion,
              records[0]!.derived.quality.ruleVersion,
            ),
          ),
        );
      statements += 3;
      const sourceFacts = records.flatMap(({ agent, fetchedAt }) => {
        const identity = identityByExternalId.get(agent.token_id)!;
        const sourceUri = `https://8004scan.io/agents/${agent.chain_id}/${agent.token_id}`;
        return [
          ["identity.ownerAddress", agent.owner_address?.toLowerCase()],
          ["identity.registryAddress", agent.contract_address.toLowerCase()],
          ["identity.agentId", agent.token_id],
          ["profile.name", agent.name],
          ["profile.description", agent.description],
          ["profile.imageUrl", agent.image_url],
        ]
          .filter(([, value]) => value != null)
          .map(([fieldPath, value]) => ({
            agentId: identity.agentId,
            subjectType: String(fieldPath).split(".")[0]!,
            fieldPath: String(fieldPath),
            provenance: "secondary_unverified" as const,
            source: this.provider,
            sourceUri,
            observedAt: fetchedAt,
            details: { value },
          }));
      });
      if (sourceFacts.length > 0) {
        await transaction.insert(factEvidence).values(sourceFacts);
        statements += 1;
      }
      const services = records.flatMap(({ agent, derived, fetchedAt }) => {
        const agentId = identityByExternalId.get(agent.token_id)!.agentId;
        return derived.services.map((service) => ({
          agentId,
          source: this.provider,
          rawName: service.rawName,
          normalizedType: service.normalizedType,
          endpoint: service.endpoint,
          malformed: service.malformed,
          provenance: "secondary_unverified" as const,
          raw: service.raw,
          observedAt: fetchedAt,
        }));
      });
      if (services.length > 0) {
        await transaction.insert(serviceDeclarations).values(services);
        statements += 1;
      }
      const classifications = records.flatMap(
        ({ agent, derived, fetchedAt }) => {
          const agentId = identityByExternalId.get(agent.token_id)!.agentId;
          return derived.classifications.map((match) => ({
            agentId,
            categorySlug: match.categorySlug,
            confidence: match.confidence,
            evidenceType: match.evidenceType,
            matchedSource: match.matchedSource,
            matchedValue: match.matchedValue,
            ruleVersion: derived.quality.ruleVersion,
            observedAt: fetchedAt,
          }));
        },
      );
      if (classifications.length > 0) {
        await transaction
          .insert(classificationEvidence)
          .values(classifications);
        statements += 1;
      }
      const capabilitySlugs = [
        ...new Set(records.flatMap(({ derived }) => derived.capabilities)),
      ];
      if (capabilitySlugs.length > 0) {
        await transaction
          .insert(taxonomyTerms)
          .values(
            capabilitySlugs.map((slug) => ({
              kind: "capability" as const,
              slug,
              label: slug
                .split("-")
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(" "),
            })),
          )
          .onConflictDoNothing();
        statements += 1;
      }
      const taxonomySlugs = [
        ...new Set([
          ...capabilitySlugs,
          ...records.flatMap(({ derived }) =>
            derived.classifications.map(({ categorySlug }) => categorySlug),
          ),
        ]),
      ];
      if (taxonomySlugs.length > 0) {
        const terms = await transaction
          .select({
            id: taxonomyTerms.id,
            kind: taxonomyTerms.kind,
            slug: taxonomyTerms.slug,
          })
          .from(taxonomyTerms)
          .where(inArray(taxonomyTerms.slug, taxonomySlugs));
        statements += 1;
        const termByKindAndSlug = new Map(
          terms.map((term) => [`${term.kind}:${term.slug}`, term.id]),
        );
        const taxonomyRows = records.flatMap(({ agent, derived }) => {
          const agentId = identityByExternalId.get(agent.token_id)!.agentId;
          return [
            ...derived.capabilities.map((slug) => ({
              kind: "capability",
              slug,
            })),
            ...derived.classifications.map(({ categorySlug: slug }) => ({
              kind: "category",
              slug,
            })),
          ].flatMap(({ kind, slug }) => {
            const termId = termByKindAndSlug.get(`${kind}:${slug}`);
            return termId === undefined ? [] : [{ agentId, termId }];
          });
        });
        if (taxonomyRows.length > 0) {
          await transaction
            .insert(agentTaxonomy)
            .values(taxonomyRows)
            .onConflictDoNothing();
          statements += 1;
        }
      }
      const qualityRows = records.map(({ agent, derived, fetchedAt }) => {
        const identity = identityByExternalId.get(agent.token_id)!;
        const facts: Record<string, boolean> = {
          ...derived.quality.facts,
          hasVerifiableOwner:
            identity.verificationStatus === "verified" ||
            identity.verificationStatus === "partial",
          hasMetadataUri: identity.metadataUri.trim().length > 0,
          metadataResolves: resolvedIds.has(identity.agentId),
        };
        return {
          agentId: identity.agentId,
          completenessPercent: Math.round(
            (Object.values(facts).filter(Boolean).length /
              Object.values(facts).length) *
              100,
          ),
          readiness: derived.quality.readiness,
          facts,
          ruleVersion: derived.quality.ruleVersion,
          profiledAt: fetchedAt,
          updatedAt: fetchedAt,
        };
      });
      await transaction
        .insert(agentQualityProfiles)
        .values(qualityRows)
        .onConflictDoUpdate({
          target: agentQualityProfiles.agentId,
          set: {
            completenessPercent: sql`excluded.completeness_percent`,
            readiness: sql`excluded.readiness`,
            facts: sql`excluded.facts`,
            ruleVersion: sql`excluded.rule_version`,
            profiledAt: sql`excluded.profiled_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      statements += 1;
      await transaction
        .insert(reputationInventory)
        .values(
          records.map(({ agent, fetchedAt }) => ({
            agentId: identityByExternalId.get(agent.token_id)!.agentId,
            source: this.provider,
            feedbackCount: agent.total_feedbacks ?? 0,
            averageScore: agent.average_score ?? null,
            starCount: agent.star_count ?? 0,
            sourceScore: agent.total_score ?? null,
            raw: {
              total_feedbacks: agent.total_feedbacks ?? 0,
              average_score: agent.average_score ?? null,
              star_count: agent.star_count ?? 0,
              total_score: agent.total_score ?? null,
              health_score: agent.health_score ?? null,
            },
            observedAt: fetchedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [reputationInventory.agentId, reputationInventory.source],
          set: {
            feedbackCount: sql`excluded.feedback_count`,
            averageScore: sql`excluded.average_score`,
            starCount: sql`excluded.star_count`,
            sourceScore: sql`excluded.source_score`,
            raw: sql`excluded.raw`,
            observedAt: sql`excluded.observed_at`,
          },
        });
      statements += 1;
      await transaction
        .insert(verificationQueue)
        .values(
          records.map(({ agent, derived }) => ({
            agentId: identityByExternalId.get(agent.token_id)!.agentId,
            status: "unverified" as const,
            priority: derived.priority,
          })),
        )
        .onConflictDoUpdate({
          target: verificationQueue.agentId,
          set: {
            priority: sql`greatest(${verificationQueue.priority}, excluded.priority)`,
            updatedAt: sql`now()`,
          },
        });
      statements += 1;
      await transaction
        .update(corpusSourceRecords)
        .set({
          enrichmentRuleVersion: records[0]!.derived.quality.ruleVersion,
          enrichedAt: new Date(),
          enrichmentError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(corpusSourceRecords.provider, this.provider),
            inArray(corpusSourceRecords.agentId, agentIds),
          ),
        );
      statements += 1;
    });
    return {
      persisted: records.length,
      malformed: 0,
      statements,
      transactionCount: 1,
      durationMs: performance.now() - startedAt,
    };
  }

  async persistAgent(input: {
    agent: ScanAgent;
    raw: unknown;
    fetchedAt: Date;
    derived: CorpusDerivedData;
  }): Promise<string> {
    const { agent, raw, fetchedAt, derived } = input;
    if (!/^\d+$/.test(agent.token_id)) throw new Error("Invalid token_id");
    if (!addressPattern.test(agent.contract_address))
      throw new Error("Invalid contract_address");
    if (
      agent.owner_address == null ||
      !addressPattern.test(agent.owner_address)
    )
      throw new Error("Missing or invalid owner_address");
    const registryAddress = agent.contract_address.toLowerCase();
    const ownerAddress = agent.owner_address.toLowerCase();
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({
          agentId: agentIdentities.agentId,
          metadataUri: agents.metadataUri,
          verificationStatus: verificationQueue.status,
        })
        .from(agentIdentities)
        .innerJoin(agents, eq(agents.id, agentIdentities.agentId))
        .leftJoin(
          verificationQueue,
          eq(verificationQueue.agentId, agentIdentities.agentId),
        )
        .where(
          and(
            eq(agentIdentities.namespace, "eip155"),
            eq(agentIdentities.chainId, agent.chain_id),
            sql`lower(${agentIdentities.registryAddress}) = ${registryAddress}`,
            eq(agentIdentities.externalAgentId, agent.token_id),
          ),
        )
        .limit(1);
      const internalId = existing?.agentId ?? randomUUID();
      const sourceCreatedAt = new Date(agent.created_at ?? fetchedAt);
      await transaction
        .insert(agents)
        .values({
          id: internalId,
          name: agent.name ?? null,
          description: agent.description ?? null,
          imageUrl: agent.image_url ?? null,
          metadataUri: "",
          createdAt: Number.isNaN(sourceCreatedAt.getTime())
            ? fetchedAt
            : sourceCreatedAt,
          updatedAt: fetchedAt,
        })
        .onConflictDoUpdate({
          target: agents.id,
          set: {
            name: sql`coalesce(${agents.name}, excluded.name)`,
            description: sql`coalesce(${agents.description}, excluded.description)`,
            imageUrl: sql`coalesce(${agents.imageUrl}, excluded.image_url)`,
            updatedAt: fetchedAt,
          },
        });
      const identityValues = {
        agentId: internalId,
        standard: "erc-8004",
        namespace: "eip155",
        chainId: agent.chain_id,
        registryAddress,
        externalAgentId: agent.token_id,
        ownerAddress,
        registrationStatus: "unknown",
        registeredAt: Number.isNaN(sourceCreatedAt.getTime())
          ? null
          : sourceCreatedAt,
        updatedAt: fetchedAt,
      };
      if (existing === undefined)
        await transaction.insert(agentIdentities).values(identityValues);
      else
        await transaction
          .update(agentIdentities)
          .set({ updatedAt: fetchedAt })
          .where(eq(agentIdentities.agentId, internalId));
      await transaction
        .insert(corpusSourceRecords)
        .values({
          provider: this.provider,
          sourceRecordId: agent.id,
          agentId: internalId,
          chainId: agent.chain_id,
          registryAddress,
          externalAgentId: agent.token_id,
          sourceUpdatedAt:
            agent.updated_at == null ? null : new Date(agent.updated_at),
          payload: raw,
          contentHash: sha256(raw),
          fetchedAt,
          updatedAt: fetchedAt,
        })
        .onConflictDoUpdate({
          target: [
            corpusSourceRecords.provider,
            corpusSourceRecords.sourceRecordId,
          ],
          set: {
            agentId: internalId,
            payload: raw,
            contentHash: sha256(raw),
            sourceUpdatedAt:
              agent.updated_at == null ? null : new Date(agent.updated_at),
            fetchedAt,
            updatedAt: fetchedAt,
          },
        });
      await transaction
        .delete(factEvidence)
        .where(
          and(
            eq(factEvidence.agentId, internalId),
            eq(factEvidence.provenance, "secondary_unverified"),
            eq(factEvidence.source, this.provider),
          ),
        );
      const sourceUri = `https://8004scan.io/agents/${agent.chain_id}/${agent.token_id}`;
      const facts = [
        ["identity.ownerAddress", ownerAddress],
        ["identity.registryAddress", registryAddress],
        ["identity.agentId", agent.token_id],
        ["profile.name", agent.name],
        ["profile.description", agent.description],
        ["profile.imageUrl", agent.image_url],
      ].filter(([, value]) => value != null);
      if (facts.length > 0)
        await transaction.insert(factEvidence).values(
          facts.map(([fieldPath, value]) => ({
            agentId: internalId,
            subjectType: String(fieldPath).split(".")[0]!,
            fieldPath: String(fieldPath),
            provenance: "secondary_unverified" as const,
            source: this.provider,
            sourceUri,
            observedAt: fetchedAt,
            details: { value },
          })),
        );
      await transaction
        .delete(serviceDeclarations)
        .where(
          and(
            eq(serviceDeclarations.agentId, internalId),
            eq(serviceDeclarations.source, this.provider),
          ),
        );
      if (derived.services.length > 0)
        await transaction.insert(serviceDeclarations).values(
          derived.services.map((service) => ({
            agentId: internalId,
            source: this.provider,
            rawName: service.rawName,
            normalizedType: service.normalizedType,
            endpoint: service.endpoint,
            malformed: service.malformed,
            provenance: "secondary_unverified" as const,
            raw: service.raw,
            observedAt: fetchedAt,
          })),
        );
      await transaction
        .delete(classificationEvidence)
        .where(
          and(
            eq(classificationEvidence.agentId, internalId),
            eq(classificationEvidence.ruleVersion, derived.quality.ruleVersion),
          ),
        );
      for (const match of derived.classifications) {
        const [term] = await transaction
          .select({ id: taxonomyTerms.id })
          .from(taxonomyTerms)
          .where(
            and(
              eq(taxonomyTerms.kind, "category"),
              eq(taxonomyTerms.slug, match.categorySlug),
            ),
          )
          .limit(1);
        if (term !== undefined)
          await transaction
            .insert(agentTaxonomy)
            .values({ agentId: internalId, termId: term.id })
            .onConflictDoNothing();
        await transaction.insert(classificationEvidence).values({
          agentId: internalId,
          categorySlug: match.categorySlug,
          confidence: match.confidence,
          evidenceType: match.evidenceType,
          matchedSource: match.matchedSource,
          matchedValue: match.matchedValue,
          ruleVersion: derived.quality.ruleVersion,
          observedAt: fetchedAt,
        });
      }
      for (const capability of derived.capabilities) {
        const [term] = await transaction
          .insert(taxonomyTerms)
          .values({
            kind: "capability",
            slug: capability,
            label: capability
              .split("-")
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(" "),
          })
          .onConflictDoUpdate({
            target: [taxonomyTerms.kind, taxonomyTerms.slug],
            set: { updatedAt: fetchedAt },
          })
          .returning({ id: taxonomyTerms.id });
        if (term !== undefined)
          await transaction
            .insert(agentTaxonomy)
            .values({ agentId: internalId, termId: term.id })
            .onConflictDoNothing();
      }
      const [resolvedMetadata] = await transaction
        .select({ id: metadataHistory.id })
        .from(metadataHistory)
        .where(
          and(
            eq(metadataHistory.agentId, internalId),
            eq(metadataHistory.resolutionStatus, "resolved"),
          ),
        )
        .limit(1);
      const qualityFacts: Record<string, boolean> = {
        ...derived.quality.facts,
        hasVerifiableOwner:
          existing?.verificationStatus === "verified" ||
          existing?.verificationStatus === "partial",
        hasMetadataUri: (existing?.metadataUri.trim().length ?? 0) > 0,
        metadataResolves: resolvedMetadata !== undefined,
      };
      const completenessPercent = Math.round(
        (Object.values(qualityFacts).filter(Boolean).length /
          Object.values(qualityFacts).length) *
          100,
      );
      await transaction
        .insert(agentQualityProfiles)
        .values({
          agentId: internalId,
          completenessPercent,
          readiness: derived.quality.readiness,
          facts: qualityFacts,
          ruleVersion: derived.quality.ruleVersion,
          profiledAt: fetchedAt,
          updatedAt: fetchedAt,
        })
        .onConflictDoUpdate({
          target: agentQualityProfiles.agentId,
          set: {
            completenessPercent,
            readiness: derived.quality.readiness,
            facts: qualityFacts,
            ruleVersion: derived.quality.ruleVersion,
            profiledAt: fetchedAt,
            updatedAt: fetchedAt,
          },
        });
      await transaction
        .insert(reputationInventory)
        .values({
          agentId: internalId,
          source: this.provider,
          feedbackCount: agent.total_feedbacks ?? 0,
          averageScore: agent.average_score ?? null,
          starCount: agent.star_count ?? 0,
          sourceScore: agent.total_score ?? null,
          raw: {
            total_feedbacks: agent.total_feedbacks ?? 0,
            average_score: agent.average_score ?? null,
            star_count: agent.star_count ?? 0,
            total_score: agent.total_score ?? null,
            health_score: agent.health_score ?? null,
          },
          observedAt: fetchedAt,
        })
        .onConflictDoUpdate({
          target: [reputationInventory.agentId, reputationInventory.source],
          set: {
            feedbackCount: agent.total_feedbacks ?? 0,
            averageScore: agent.average_score ?? null,
            starCount: agent.star_count ?? 0,
            sourceScore: agent.total_score ?? null,
            raw: {
              total_feedbacks: agent.total_feedbacks ?? 0,
              average_score: agent.average_score ?? null,
              star_count: agent.star_count ?? 0,
              total_score: agent.total_score ?? null,
              health_score: agent.health_score ?? null,
            },
            observedAt: fetchedAt,
          },
        });
      await transaction
        .insert(verificationQueue)
        .values({
          agentId: internalId,
          status: "unverified",
          priority: derived.priority,
        })
        .onConflictDoUpdate({
          target: verificationQueue.agentId,
          set: {
            priority: sql`greatest(${verificationQueue.priority}, excluded.priority)`,
            updatedAt: fetchedAt,
          },
        });
      return internalId;
    });
  }

  async recordMalformed(
    raw: unknown,
    page: number,
    index: number,
    error: unknown,
  ) {
    await this.database.insert(ingestionRecords).values({
      provider: this.provider,
      sourceKey: `page:${page}:record:${index}`,
      fetchedAt: new Date(),
      payload: raw,
      status: "failed",
      error: {
        message:
          error instanceof Error ? error.message : "Malformed source record",
      },
    });
  }

  async sourceRecordsForReclassification(input: {
    chainId: number;
    registryAddress: string;
    limit: number;
  }) {
    return this.database
      .select({ payload: corpusSourceRecords.payload })
      .from(corpusSourceRecords)
      .where(
        and(
          eq(corpusSourceRecords.provider, this.provider),
          eq(corpusSourceRecords.chainId, input.chainId),
          eq(
            corpusSourceRecords.registryAddress,
            input.registryAddress.toLowerCase(),
          ),
        ),
      )
      .orderBy(sql`(${corpusSourceRecords.externalAgentId})::numeric`)
      .limit(input.limit);
  }

  async sourceRecordsForEnrichment(input: {
    chainId: number;
    registryAddress: string;
    ruleVersion: string;
    limit: number;
  }) {
    return this.database
      .select({ payload: corpusSourceRecords.payload })
      .from(corpusSourceRecords)
      .where(
        and(
          eq(corpusSourceRecords.provider, this.provider),
          eq(corpusSourceRecords.chainId, input.chainId),
          eq(
            corpusSourceRecords.registryAddress,
            input.registryAddress.toLowerCase(),
          ),
          or(
            isNull(corpusSourceRecords.enrichmentRuleVersion),
            sql`${corpusSourceRecords.enrichmentRuleVersion} <> ${input.ruleVersion}`,
          ),
        ),
      )
      .orderBy(sql`(${corpusSourceRecords.externalAgentId})::numeric`)
      .limit(input.limit);
  }

  async completePage(input: {
    runId: string;
    chainId: number;
    registryAddress: string;
    page: number;
    pageSize: number;
    total: number;
    counters: CorpusCounters;
    rateLimit: ScanRateLimit;
    accessMode: ScanAccessMode;
    operationalMode: ScanOperationalMode;
    requestCount: number;
    advanceCheckpoint: boolean;
  }) {
    const startedAt = performance.now();
    const now = new Date();
    await this.database.transaction(async (transaction) => {
      if (input.advanceCheckpoint)
        await transaction
          .update(corpusImportCheckpoints)
          .set({
            nextPage: input.page + 1,
            pageSize: input.pageSize,
            totalReported: input.total,
            status: "partial",
            accessMode: input.accessMode,
            operationalMode: input.operationalMode,
            rateLimit: input.rateLimit.limit,
            rateLimitRemaining: input.rateLimit.remaining,
            rateLimitResetAt:
              input.rateLimit.resetAt === null
                ? null
                : new Date(input.rateLimit.resetAt),
            lastSuccessfulRunAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(corpusImportCheckpoints.provider, this.provider),
              eq(corpusImportCheckpoints.chainId, input.chainId),
              eq(
                corpusImportCheckpoints.registryAddress,
                input.registryAddress.toLowerCase(),
              ),
            ),
          );
      await transaction
        .update(corpusImportRuns)
        .set({
          endPage: input.page,
          counters: input.counters,
          totalReported: input.total,
          rateLimit: input.rateLimit.limit,
          rateLimitRemaining: input.rateLimit.remaining,
          rateLimitResetAt:
            input.rateLimit.resetAt === null
              ? null
              : new Date(input.rateLimit.resetAt),
          operationalMode: input.operationalMode,
          requestCount: input.requestCount,
          degradedReason:
            input.operationalMode === "rate_limited_degraded"
              ? "8004scan rate limit reached"
              : null,
        })
        .where(eq(corpusImportRuns.id, input.runId));
    });
    return {
      statements: input.advanceCheckpoint ? 2 : 1,
      transactionCount: 1,
      durationMs: performance.now() - startedAt,
    };
  }

  async finishRun(input: {
    runId: string;
    chainId: number;
    registryAddress: string;
    status: "succeeded" | "partial" | "failed";
    counters: CorpusCounters;
    accessMode: ScanAccessMode;
    operationalMode: ScanOperationalMode;
    requestCount: number;
    rateLimit: ScanRateLimit;
    error?: unknown;
  }) {
    const now = new Date();
    const error =
      input.error === undefined ? null : { message: errorMessage(input.error) };
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(corpusImportRuns)
        .set({
          status: input.status,
          counters: input.counters,
          accessMode: input.accessMode,
          operationalMode: input.operationalMode,
          requestCount: input.requestCount,
          rateLimit: input.rateLimit.limit,
          rateLimitRemaining: input.rateLimit.remaining,
          rateLimitResetAt:
            input.rateLimit.resetAt === null
              ? null
              : new Date(input.rateLimit.resetAt),
          degradedReason:
            input.operationalMode === "rate_limited_degraded"
              ? "8004scan rate limit reached"
              : null,
          error,
          finishedAt: now,
        })
        .where(eq(corpusImportRuns.id, input.runId));
      await transaction
        .update(corpusImportCheckpoints)
        .set({
          status: input.status,
          accessMode: input.accessMode,
          operationalMode: input.operationalMode,
          completedAt: input.status === "succeeded" ? now : null,
          rateLimit: input.rateLimit.limit,
          rateLimitRemaining: input.rateLimit.remaining,
          rateLimitResetAt:
            input.rateLimit.resetAt === null
              ? null
              : new Date(input.rateLimit.resetAt),
          error,
          ...(input.status === "succeeded" ? { lastSuccessfulRunAt: now } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(corpusImportCheckpoints.provider, this.provider),
            eq(corpusImportCheckpoints.chainId, input.chainId),
            eq(
              corpusImportCheckpoints.registryAddress,
              input.registryAddress.toLowerCase(),
            ),
          ),
        );
    });
  }

  async verificationCandidates(limit: number) {
    const now = new Date();
    return this.database
      .select({
        agentId: verificationQueue.agentId,
        externalAgentId: agentIdentities.externalAgentId,
        secondaryOwner: agentIdentities.ownerAddress,
        secondaryMetadataUri: sql<
          string | null
        >`${corpusSourceRecords.payload}->>'metadata_uri'`,
        registryAddress: agentIdentities.registryAddress,
      })
      .from(verificationQueue)
      .innerJoin(
        agentIdentities,
        eq(agentIdentities.agentId, verificationQueue.agentId),
      )
      .leftJoin(
        corpusSourceRecords,
        and(
          eq(corpusSourceRecords.agentId, verificationQueue.agentId),
          eq(corpusSourceRecords.provider, this.provider),
        ),
      )
      .where(
        and(
          inArray(verificationQueue.status, [
            "unverified",
            "pending",
            "partial",
            "failed",
            "stale",
          ]),
          or(
            isNull(verificationQueue.nextAttemptAt),
            lte(verificationQueue.nextAttemptAt, now),
          ),
        ),
      )
      .orderBy(
        desc(verificationQueue.priority),
        asc(agentIdentities.externalAgentId),
      )
      .limit(limit);
  }

  async requeueFailedVerifications() {
    const rows = await this.database
      .update(verificationQueue)
      .set({
        status: "unverified",
        nextAttemptAt: null,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(verificationQueue.status, "failed"))
      .returning({ agentId: verificationQueue.agentId });
    return rows.length;
  }

  async markPending(agentId: string) {
    await this.database
      .update(verificationQueue)
      .set({
        status: "pending",
        attempts: sql`${verificationQueue.attempts} + 1`,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(verificationQueue.agentId, agentId));
  }

  async recordVerification(input: {
    agentId: string;
    status: "verified" | "partial" | "failed";
    blockNumber: bigint | null;
    facts: Record<string, unknown>;
    mismatches: Record<string, unknown>;
    evidence: Record<string, unknown>;
    error?: unknown;
  }) {
    const observedAt = new Date();
    const error =
      input.error === undefined ? null : { message: errorMessage(input.error) };
    await this.database.transaction(async (transaction) => {
      await transaction.insert(verificationObservations).values({
        agentId: input.agentId,
        status: input.status,
        blockNumber: input.blockNumber,
        facts: input.facts,
        mismatches: input.mismatches,
        evidence: input.evidence,
        error,
        observedAt,
      });
      await transaction
        .update(verificationQueue)
        .set({
          status: input.status,
          verifiedAt: input.status === "verified" ? observedAt : null,
          verifiedBlock: input.blockNumber,
          error,
          nextAttemptAt:
            input.status === "failed"
              ? new Date(observedAt.getTime() + 60 * 60 * 1_000)
              : null,
          updatedAt: observedAt,
        })
        .where(eq(verificationQueue.agentId, input.agentId));
      await transaction.execute(sql`
        insert into agent_taxonomy (agent_id, term_id)
        select ${input.agentId}::uuid, tt.id
        from taxonomy_terms tt
        where (tt.kind='category' and tt.slug in (
          select ce.category_slug from classification_evidence ce
          where ce.agent_id=${input.agentId}::uuid
        )) or (tt.kind='capability' and tt.slug in (
          select distinct sd.normalized_type from service_declarations sd
          where sd.agent_id=${input.agentId}::uuid and sd.normalized_type not like 'other:%'
        ))
        on conflict do nothing
      `);
      const [quality] = await transaction
        .select()
        .from(agentQualityProfiles)
        .where(eq(agentQualityProfiles.agentId, input.agentId))
        .limit(1);
      if (quality !== undefined) {
        const prior = quality.facts as Record<string, boolean>;
        const [resolved] = await transaction
          .select({ id: metadataHistory.id })
          .from(metadataHistory)
          .where(
            and(
              eq(metadataHistory.agentId, input.agentId),
              eq(metadataHistory.resolutionStatus, "resolved"),
            ),
          )
          .limit(1);
        const metadataUri = input.facts.metadataUri;
        const facts: Record<string, boolean> = {
          ...prior,
          hasVerifiableOwner: input.status !== "failed",
          hasMetadataUri:
            typeof metadataUri === "string" && metadataUri.trim().length > 0,
          metadataResolves: resolved !== undefined,
        };
        const values = Object.values(facts);
        const completenessPercent = Math.round(
          (values.filter(Boolean).length / values.length) * 100,
        );
        let readiness = quality.readiness;
        if (
          facts.hasName &&
          facts.hasMeaningfulDescription &&
          facts.metadataResolves &&
          facts.hasEndpoint &&
          facts.hasUsableMachineInterface &&
          facts.hasPricingInformation
        )
          readiness = "ACTIONABLE";
        else if (
          facts.hasName &&
          facts.hasMeaningfulDescription &&
          (facts.hasCapabilityData || facts.hasServiceDeclaration)
        )
          readiness = "DISCOVERABLE";
        await transaction
          .update(agentQualityProfiles)
          .set({
            facts,
            completenessPercent,
            readiness,
            profiledAt: observedAt,
            updatedAt: observedAt,
          })
          .where(eq(agentQualityProfiles.agentId, input.agentId));
      }
    });
  }

  async refreshDuplicateSignals(ruleVersion: string): Promise<number> {
    const now = new Date();
    return this.database.transaction(async (transaction) => {
      await transaction
        .delete(duplicateSignals)
        .where(eq(duplicateSignals.ruleVersion, ruleVersion));
      const groups = await transaction.execute<{
        kind: string;
        fingerprint: string;
        group_size: number;
        agent_ids: string[];
      }>(sql`
        with signals as (
          select id as agent_id, 'description' as kind,
            md5(lower(regexp_replace(trim(description), '\\s+', ' ', 'g'))) as fingerprint
          from agents where description is not null and length(trim(description)) > 0
          union all
          select id, 'image', lower(trim(image_url)) from agents where image_url is not null and length(trim(image_url)) > 0
          union all
          select agent_id, 'endpoint', lower(trim(endpoint)) from service_declarations where endpoint is not null and length(trim(endpoint)) > 0
          union all
          select id, 'metadata_uri', md5(lower(trim(metadata_uri)))
          from agents
          where metadata_uri is not null and length(trim(metadata_uri)) > 0
        )
        select kind, fingerprint, count(*)::int as group_size, array_agg(agent_id::text) as agent_ids
        from signals group by kind, fingerprint having count(*) > 1
      `);
      let inserted = 0;
      for (const group of groups) {
        await transaction.insert(duplicateSignals).values(
          group.agent_ids.map((agentId) => ({
            agentId,
            kind: group.kind,
            fingerprint: group.fingerprint,
            groupSize: group.group_size,
            details: { interpretation: "structural_duplicate_signal_only" },
            ruleVersion,
            observedAt: now,
          })),
        );
        inserted += group.agent_ids.length;
      }
      const empty = await transaction.execute<{ id: string }>(sql`
        select id::text
        from agents
        where length(trim(coalesce(name, ''))) = 0
          and length(trim(coalesce(description, ''))) = 0
          and length(trim(coalesce(image_url, ''))) = 0
      `);
      if (empty.length > 0) {
        await transaction.insert(duplicateSignals).values(
          empty.map(({ id }) => ({
            agentId: id,
            kind: "empty_profile",
            fingerprint: "empty-profile",
            groupSize: empty.length,
            details: { interpretation: "structural_empty_profile_signal_only" },
            ruleVersion,
            observedAt: now,
          })),
        );
        inserted += empty.length;
      }
      return inserted;
    });
  }

  async endpointCandidates(limit: number) {
    return this.database.execute<{
      agent_id: string;
      service_declaration_id: string | null;
      endpoint: string;
    }>(sql`
      with candidates as (
        select agent_id, id as service_declaration_id, endpoint
        from service_declarations
        where endpoint is not null and length(trim(endpoint)) > 0
        union
        select agent_id, null::uuid, endpoint
        from agent_services
        where endpoint is not null and length(trim(endpoint)) > 0
      )
      select c.agent_id, c.service_declaration_id, c.endpoint
      from candidates c
      where not exists (
        select 1 from endpoint_observations eo
        where eo.agent_id = c.agent_id and eo.endpoint = c.endpoint
          and eo.observed_at > now() - interval '24 hours'
      )
      order by c.agent_id, c.endpoint
      limit ${limit}
    `);
  }

  async recordEndpointObservation(input: {
    agentId: string;
    serviceDeclarationId: string | null;
    endpoint: string;
    status:
      | "reachable"
      | "unreachable"
      | "timeout"
      | "invalid"
      | "unsupported_protocol";
    httpStatus: number | null;
    latencyMs: number | null;
    redirectCount: number;
    errorCode: string | null;
  }) {
    await this.database.insert(endpointObservations).values({
      agentId: input.agentId,
      serviceDeclarationId: input.serviceDeclarationId,
      endpoint: input.endpoint,
      status: input.status,
      httpStatus: input.httpStatus,
      latencyMs: input.latencyMs,
      redirectCount: input.redirectCount,
      errorCode: input.errorCode,
      evidence: {
        provenance: "independently_observed",
        method: "ssrf_guarded_head_request",
        interpretation: "reachability_only_not_functionality",
      },
      observedAt: new Date(),
    });
  }
}
