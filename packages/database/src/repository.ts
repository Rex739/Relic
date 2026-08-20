import type {
  AgentDetail,
  AgentListItem,
  AgentListQuery,
  AgentListResult,
  AgentReadRepository,
  ServiceListQuery,
} from "@relic/domain";
import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  agentIdentities,
  agentQualityProfiles,
  agents,
  agentServices,
  agentTaxonomy,
  corpusImportCheckpoints,
  corpusImportRuns,
  corpusSourceRecords,
  factEvidence,
  taxonomyTerms,
  indexerCheckpoints,
  metadataHistory,
  marketplaceServices,
  reconciliationRecords,
  serviceDeclarations,
  verificationQueue,
} from "./schema.js";

export class DrizzleAgentRepository implements AgentReadRepository {
  public constructor(private readonly database: RelicDatabase) {}

  public async list(query: AgentListQuery): Promise<AgentListResult> {
    const cursorCondition =
      query.cursor === undefined ? undefined : gt(agents.id, query.cursor);
    const taxonomyExists = (kind: "category" | "capability", slug: string) =>
      sql<boolean>`exists (
        select 1 from agent_taxonomy at
        join taxonomy_terms tt on tt.id = at.term_id
        where at.agent_id = ${agents.id} and tt.kind = ${kind} and tt.slug = ${slug}
      )`;
    const rows = await this.database
      .select({
        agent: agents,
        identity: agentIdentities,
        quality: agentQualityProfiles,
        verification: verificationQueue,
      })
      .from(agents)
      .innerJoin(agentIdentities, eq(agentIdentities.agentId, agents.id))
      .leftJoin(
        agentQualityProfiles,
        eq(agentQualityProfiles.agentId, agents.id),
      )
      .leftJoin(verificationQueue, eq(verificationQueue.agentId, agents.id))
      .where(
        and(
          cursorCondition,
          query.category === undefined
            ? undefined
            : taxonomyExists("category", query.category),
          query.capability === undefined
            ? undefined
            : taxonomyExists("capability", query.capability),
          query.interface === undefined
            ? undefined
            : sql<boolean>`exists (
                select 1 from service_declarations sd
                where sd.agent_id = ${agents.id} and sd.normalized_type = ${query.interface}
              )`,
          query.readiness === undefined
            ? undefined
            : eq(agentQualityProfiles.readiness, query.readiness),
          query.verificationStatus === undefined
            ? undefined
            : eq(verificationQueue.status, query.verificationStatus),
        ),
      )
      .orderBy(asc(agents.id))
      .limit(query.limit + 1);

    const pageRows = rows.slice(0, query.limit);
    const ids = pageRows.map((row) => row.agent.id);
    const [categories, capabilities, interfaces] = await Promise.all([
      this.#taxonomy(ids, "category"),
      this.#taxonomy(ids, "capability"),
      this.#interfaces(ids),
    ]);
    const items: AgentListItem[] = pageRows.map(
      ({ agent, identity, quality, verification }) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        imageUrl: agent.imageUrl,
        chainId: identity.chainId,
        registryAddress: identity.registryAddress,
        externalAgentId: identity.externalAgentId,
        categories: categories.get(agent.id) ?? [],
        capabilities: capabilities.get(agent.id) ?? [],
        interfaces: interfaces.get(agent.id) ?? [],
        readiness: quality?.readiness ?? null,
        verificationStatus: verification?.status ?? null,
        completenessPercent: quality?.completenessPercent ?? null,
        updatedAt: agent.updatedAt.toISOString(),
      }),
    );
    return {
      items,
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  public async findById(id: string): Promise<AgentDetail | null> {
    const [row] = await this.database
      .select({ agent: agents, identity: agentIdentities })
      .from(agents)
      .innerJoin(agentIdentities, eq(agentIdentities.agentId, agents.id))
      .where(eq(agents.id, id))
      .limit(1);
    if (row === undefined) return null;

    const [
      terms,
      services,
      evidence,
      categoryMap,
      capabilityMap,
      interfaceMap,
      quality,
      verification,
    ] = await Promise.all([
      this.database
        .select({
          kind: taxonomyTerms.kind,
          slug: taxonomyTerms.slug,
          label: taxonomyTerms.label,
        })
        .from(agentTaxonomy)
        .innerJoin(taxonomyTerms, eq(taxonomyTerms.id, agentTaxonomy.termId))
        .where(eq(agentTaxonomy.agentId, id)),
      this.database
        .select({
          id: agentServices.id,
          name: agentServices.name,
          capability: agentServices.capability,
          description: agentServices.description,
          endpoint: agentServices.endpoint,
          availabilityStatus: agentServices.status,
        })
        .from(agentServices)
        .where(eq(agentServices.agentId, id)),
      this.database
        .select({
          fieldPath: factEvidence.fieldPath,
          provenance: factEvidence.provenance,
          source: factEvidence.source,
          sourceUri: factEvidence.sourceUri,
          observedAt: factEvidence.observedAt,
        })
        .from(factEvidence)
        .where(eq(factEvidence.agentId, id)),
      this.#taxonomy([id], "category"),
      this.#taxonomy([id], "capability"),
      this.#interfaces([id]),
      this.database
        .select()
        .from(agentQualityProfiles)
        .where(eq(agentQualityProfiles.agentId, id))
        .limit(1),
      this.database
        .select()
        .from(verificationQueue)
        .where(eq(verificationQueue.agentId, id))
        .limit(1),
    ]);

    return {
      id: row.agent.id,
      name: row.agent.name,
      description: row.agent.description,
      imageUrl: row.agent.imageUrl,
      websiteUrl: row.agent.websiteUrl,
      metadataUri: row.agent.metadataUri,
      chainId: row.identity.chainId,
      registryAddress: row.identity.registryAddress,
      externalAgentId: row.identity.externalAgentId,
      ownerAddress: row.identity.ownerAddress,
      registrationStatus: row.identity.registrationStatus,
      registrationTransaction: row.identity.registrationTransaction,
      registrationBlock: row.identity.registrationBlock?.toString() ?? null,
      registeredAt: row.identity.registeredAt?.toISOString() ?? null,
      categories: categoryMap.get(id) ?? [],
      capabilities: capabilityMap.get(id) ?? [],
      interfaces: interfaceMap.get(id) ?? [],
      readiness: quality[0]?.readiness ?? null,
      verificationStatus: verification[0]?.status ?? null,
      completenessPercent: quality[0]?.completenessPercent ?? null,
      taxonomy: terms,
      services,
      provenance: evidence.map((item) => ({
        ...item,
        observedAt: item.observedAt.toISOString(),
      })),
      updatedAt: row.agent.updatedAt.toISOString(),
    };
  }

  public async findByChainIdentity(
    chainId: number,
    externalAgentId: string,
  ): Promise<AgentDetail | null> {
    const [row] = await this.database
      .select({ agentId: agentIdentities.agentId })
      .from(agentIdentities)
      .where(
        and(
          eq(agentIdentities.chainId, chainId),
          eq(agentIdentities.externalAgentId, externalAgentId),
        ),
      )
      .limit(1);
    return row === undefined ? null : this.findById(row.agentId);
  }

  public async listCategories() {
    return this.database
      .select({ slug: taxonomyTerms.slug, label: taxonomyTerms.label })
      .from(taxonomyTerms)
      .where(eq(taxonomyTerms.kind, "category"))
      .orderBy(asc(taxonomyTerms.slug));
  }

  public async dataQuality(): Promise<Record<string, unknown>> {
    const [
      totals,
      withMetadata,
      failedMetadata,
      categorized,
      mismatches,
      checkpoint,
    ] = await Promise.all([
      this.database.select({ value: count() }).from(agents),
      this.database
        .select({
          value: sql<number>`count(distinct ${metadataHistory.agentId})`,
        })
        .from(metadataHistory)
        .where(eq(metadataHistory.resolutionStatus, "resolved")),
      this.database
        .select({ value: count() })
        .from(metadataHistory)
        .where(eq(metadataHistory.resolutionStatus, "failed")),
      this.database
        .select({
          value: sql<number>`count(distinct ${agentTaxonomy.agentId})`,
        })
        .from(agentTaxonomy)
        .innerJoin(taxonomyTerms, eq(agentTaxonomy.termId, taxonomyTerms.id))
        .where(eq(taxonomyTerms.kind, "category")),
      this.database
        .select({ value: count() })
        .from(reconciliationRecords)
        .where(eq(reconciliationRecords.status, "mismatch")),
      this.database
        .select()
        .from(indexerCheckpoints)
        .orderBy(desc(indexerCheckpoints.updatedAt))
        .limit(1),
    ]);
    const total = totals[0]?.value ?? 0;
    const metadataCount = Number(withMetadata[0]?.value ?? 0);
    return {
      totalIndexedAgents: total,
      agentsWithMetadata: metadataCount,
      agentsWithoutMetadata: total - metadataCount,
      metadataResolutionFailures: failedMetadata[0]?.value ?? 0,
      categorized: Number(categorized[0]?.value ?? 0),
      uncategorized: total - Number(categorized[0]?.value ?? 0),
      reconciliationMismatches: mismatches[0]?.value ?? 0,
      lastIndexedSafeBlock: checkpoint[0]?.safeBlock.toString() ?? null,
      lastIndexedBlock: checkpoint[0]?.indexedBlock.toString() ?? null,
      indexerLag:
        checkpoint[0] === undefined
          ? null
          : (checkpoint[0].safeBlock - checkpoint[0].indexedBlock).toString(),
    };
  }

  public async corpusStatus(chainId: number): Promise<Record<string, unknown>> {
    const [checkpoint, latestRun, persisted, verification, enrichment] =
      await Promise.all([
        this.database
          .select()
          .from(corpusImportCheckpoints)
          .where(
            and(
              eq(corpusImportCheckpoints.provider, "8004scan"),
              eq(corpusImportCheckpoints.chainId, chainId),
            ),
          )
          .orderBy(desc(corpusImportCheckpoints.updatedAt))
          .limit(1),
        this.database
          .select()
          .from(corpusImportRuns)
          .where(
            and(
              eq(corpusImportRuns.provider, "8004scan"),
              eq(corpusImportRuns.chainId, chainId),
            ),
          )
          .orderBy(desc(corpusImportRuns.startedAt))
          .limit(1),
        this.database
          .select({
            count: sql<number>`count(distinct ${corpusSourceRecords.agentId})`,
          })
          .from(corpusSourceRecords)
          .where(
            and(
              eq(corpusSourceRecords.provider, "8004scan"),
              eq(corpusSourceRecords.chainId, chainId),
            ),
          ),
        this.database.execute<{ status: string; count: number }>(sql`
        select coalesce(vq.status::text, 'unverified') as status,
               count(*)::int as count
        from corpus_source_records csr
        left join verification_queue vq on vq.agent_id = csr.agent_id
        where csr.provider = '8004scan' and csr.chain_id = ${chainId}
        group by coalesce(vq.status::text, 'unverified')
      `),
        this.database.execute<{ rule_version: string; count: number }>(sql`
        select coalesce(csr.enrichment_rule_version, 'pending') as rule_version,
               count(*)::int as count
        from corpus_source_records csr
        where csr.provider = '8004scan' and csr.chain_id = ${chainId}
        group by coalesce(csr.enrichment_rule_version, 'pending')
      `),
      ]);
    const state = checkpoint[0];
    const run = latestRun[0];
    const totalReported = state?.totalReported ?? null;
    const pageSize = state?.pageSize ?? null;
    const pagesExpected =
      totalReported === null || pageSize === null
        ? null
        : Math.ceil(totalReported / pageSize);
    const pagesCompleted = state === undefined ? 0 : state.nextPage - 1;
    return {
      provider: "8004scan",
      chainId,
      readyForFullIngestion: true,
      fullIngestionComplete: state?.completedAt !== null && state !== undefined,
      persistedAgents: Number(persisted[0]?.count ?? 0),
      totalReported,
      coveragePercent:
        totalReported === null || totalReported === 0
          ? null
          : Number(
              (
                (Number(persisted[0]?.count ?? 0) / totalReported) *
                100
              ).toFixed(4),
            ),
      checkpoint: {
        status: state?.status ?? "idle",
        nextPage: state?.nextPage ?? 1,
        pageSize,
        pagesCompleted,
        pagesExpected,
        accessMode: state?.accessMode ?? "anonymous",
        operationalMode: state?.operationalMode ?? "anonymous",
        rateLimit: state?.rateLimit ?? null,
        rateLimitRemaining: state?.rateLimitRemaining ?? null,
        rateLimitResetAt: state?.rateLimitResetAt?.toISOString() ?? null,
        completedAt: state?.completedAt?.toISOString() ?? null,
        updatedAt: state?.updatedAt?.toISOString() ?? null,
      },
      latestRun:
        run === undefined
          ? null
          : {
              id: run.id,
              status: run.status,
              accessMode: run.accessMode,
              operationalMode: run.operationalMode,
              requestBudget: run.requestBudget,
              requestCount: run.requestCount,
              startPage: run.startPage,
              endPage: run.endPage,
              degradedReason: run.degradedReason,
              startedAt: run.startedAt.toISOString(),
              finishedAt: run.finishedAt?.toISOString() ?? null,
            },
      verificationQueue: Object.fromEntries(
        verification.map((row) => [row.status, Number(row.count)]),
      ),
      enrichment: Object.fromEntries(
        enrichment.map((row) => [row.rule_version, Number(row.count)]),
      ),
    };
  }

  public async listAgentServices(
    agentId: string,
    query: ServiceListQuery = {},
  ) {
    const rows = await this.database
      .select()
      .from(marketplaceServices)
      .where(
        and(
          eq(marketplaceServices.agentId, agentId),
          query.verificationLevel === undefined
            ? undefined
            : eq(
                marketplaceServices.verificationLevel,
                query.verificationLevel,
              ),
          query.category === undefined
            ? undefined
            : eq(marketplaceServices.categorySlug, query.category),
          query.interface === undefined
            ? undefined
            : eq(marketplaceServices.interfaceProtocol, query.interface),
          query.actionable === undefined
            ? undefined
            : query.actionable
              ? and(
                  inArray(marketplaceServices.verificationLevel, [
                    "INVOCATION_VERIFIED",
                    "COMMERCE_VERIFIED",
                  ]),
                  eq(marketplaceServices.availability, "available"),
                )
              : sql<boolean>`${marketplaceServices.verificationLevel} not in ('INVOCATION_VERIFIED', 'COMMERCE_VERIFIED') or ${marketplaceServices.availability} <> 'available'`,
        ),
      )
      .orderBy(
        desc(marketplaceServices.verificationLevel),
        marketplaceServices.id,
      );
    return rows.map((row) => this.#service(row));
  }

  public async findService(id: string) {
    const [row] = await this.database
      .select()
      .from(marketplaceServices)
      .where(eq(marketplaceServices.id, id))
      .limit(1);
    return row === undefined ? null : this.#service(row);
  }

  #service(row: typeof marketplaceServices.$inferSelect) {
    return {
      id: row.id,
      agentId: row.agentId,
      sourceServiceId: row.sourceServiceId,
      name: row.name,
      description: row.description,
      capability: row.capability,
      category: row.categorySlug,
      interface: row.interfaceProtocol,
      endpoint: row.endpoint,
      httpMethod: row.httpMethod,
      inputSchema: row.inputSchema,
      outputSchema: row.outputSchema,
      pricing: row.pricing,
      currencyToken: row.currencyToken,
      networkChainId: row.networkChainId,
      sla: row.sla,
      authenticationRequirements: row.authenticationRequirements,
      protocolSupport: row.protocolSupport as Record<string, unknown>,
      availability: row.availability,
      verificationLevel: row.verificationLevel,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      source: row.source,
      provenance: row.provenance,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async #taxonomy(
    agentIds: string[],
    kind: "category" | "capability",
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (agentIds.length === 0) return result;
    const rows = await this.database
      .select({ agentId: agentTaxonomy.agentId, slug: taxonomyTerms.slug })
      .from(agentTaxonomy)
      .innerJoin(
        taxonomyTerms,
        and(
          eq(taxonomyTerms.id, agentTaxonomy.termId),
          eq(taxonomyTerms.kind, kind),
        ),
      )
      .where(inArray(agentTaxonomy.agentId, agentIds));
    for (const row of rows)
      result.set(row.agentId, [...(result.get(row.agentId) ?? []), row.slug]);
    return result;
  }

  async #interfaces(agentIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (agentIds.length === 0) return result;
    const rows = await this.database
      .select({
        agentId: serviceDeclarations.agentId,
        value: serviceDeclarations.normalizedType,
      })
      .from(serviceDeclarations)
      .where(inArray(serviceDeclarations.agentId, agentIds));
    for (const row of rows) {
      const values = new Set(result.get(row.agentId) ?? []);
      values.add(row.value);
      result.set(row.agentId, [...values].sort());
    }
    return result;
  }
}
