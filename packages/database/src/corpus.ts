import { createHash, randomUUID } from "node:crypto";

import type { ScanAgent, ScanRateLimit } from "@relic/blockchain";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

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

const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

  async startRun(input: {
    chainId: number;
    registryAddress: string;
    startPage: number;
    pageSize: number;
  }): Promise<string> {
    const id = randomUUID();
    await this.database.insert(corpusImportRuns).values({
      id,
      provider: this.provider,
      chainId: input.chainId,
      registryAddress: input.registryAddress.toLowerCase(),
      startPage: input.startPage,
      pageSize: input.pageSize,
      status: "running",
      startedAt: new Date(),
    });
    await this.database
      .update(corpusImportCheckpoints)
      .set({ status: "running", error: null, updatedAt: new Date() })
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

  async completePage(input: {
    runId: string;
    chainId: number;
    registryAddress: string;
    page: number;
    pageSize: number;
    total: number;
    counters: CorpusCounters;
    rateLimit: ScanRateLimit;
    advanceCheckpoint: boolean;
  }) {
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
        })
        .where(eq(corpusImportRuns.id, input.runId));
    });
  }

  async finishRun(input: {
    runId: string;
    chainId: number;
    registryAddress: string;
    status: "succeeded" | "partial" | "failed";
    counters: CorpusCounters;
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
          error,
          finishedAt: now,
        })
        .where(eq(corpusImportRuns.id, input.runId));
      await transaction
        .update(corpusImportCheckpoints)
        .set({
          status: input.status,
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
