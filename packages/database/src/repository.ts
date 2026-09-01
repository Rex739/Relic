import type {
  AgentDetail,
  AgentListItem,
  AgentListQuery,
  AgentListResult,
  AgentReadRepository,
  PublicMarketplaceAgent,
  PublicMarketplaceAgentDetail,
  PublicMarketplaceQuery,
  PublicMarketplaceResult,
  SellerReadinessFacts,
  SellerAgentReadiness,
  ServiceListQuery,
} from "@relic/domain";
import { erc8183PaymentTokens, sellerReadinessProjection } from "@relic/domain";
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
  marketplaceOutcomes,
  marketplaceReviews,
  marketplaceServices,
  reconciliationRecords,
  serviceDeclarations,
  verificationQueue,
} from "./schema.js";

interface PublicMarketplaceRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  tier: "Working" | "Actionable";
  chainId: number;
  registryAddress: string;
  externalAgentId: string;
  supplyType: "third_party" | "partner" | "relic_reference";
  capabilities: string[];
  protocols: string[];
  interfaces: string[];
  pricingKnown: boolean;
  activeOfferPrice: {
    amountBaseUnits: string;
    decimals: number;
    symbol: string;
    tokenAddress: string;
  } | null;
  hireable: boolean;
  verifiedInvocationCount: number;
  eligibleAcceptedJobCount: number;
  completedCommerceJobCount: number;
  completionRatePercent: number | null;
  reviewCount: number;
  reviewGoodCount: number;
  reviewBadCount: number;
  deliveryCompletedCount: number;
  settlementCompletedCount: number;
  unsuccessfulCommerceJobCount: number;
  feedbackCount: number;
  lastVerifiedAt: Date | string;
  updatedAt: Date | string;
  total: number;
}

function executedRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray(result.rows)
  )
    return result.rows as T[];
  throw new TypeError("Database execution did not return rows");
}

export class DrizzleAgentRepository implements AgentReadRepository {
  public constructor(
    private readonly database: RelicDatabase,
    private readonly options: {
      now?: () => Date;
      publicFreshnessDays?: number;
    } = {},
  ) {}

  #publicFreshnessCutoff() {
    const now = (this.options.now ?? (() => new Date()))();
    return new Date(
      now.getTime() -
        (this.options.publicFreshnessDays ?? 7) * 24 * 60 * 60 * 1_000,
    );
  }

  public async listPublicMarketplace(
    query: PublicMarketplaceQuery,
  ): Promise<PublicMarketplaceResult> {
    const rows = await this.#publicMarketplaceRows(query);
    const total = Number(rows[0]?.total ?? 0);
    return {
      items: rows.map((row) => this.#publicMarketplaceAgent(row)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    };
  }

  public async comparePublicMarketplaceAgents(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.#publicMarketplaceRows(
      { page: 1, limit: ids.length },
      ids,
    );
    const byId = new Map(
      rows.map((row) => [row.id, this.#publicMarketplaceAgent(row)]),
    );
    return ids.flatMap((id) => {
      const agent = byId.get(id);
      return agent === undefined ? [] : [agent];
    });
  }

  public async findPublicMarketplaceAgent(
    id: string,
  ): Promise<PublicMarketplaceAgentDetail | null> {
    const [summary] = await this.#publicMarketplaceRows({ page: 1, limit: 1 }, [
      id,
    ]);
    if (summary === undefined) return null;
    const [identity, services, evidence, outcomes, reviews, classifications] =
      await Promise.all([
        this.database
          .select({
            ownerAddress: agentIdentities.ownerAddress,
            metadataUri: agents.metadataUri,
            registrationTransaction: agentIdentities.registrationTransaction,
            registrationBlock: agentIdentities.registrationBlock,
          })
          .from(agentIdentities)
          .innerJoin(agents, eq(agents.id, agentIdentities.agentId))
          .where(eq(agentIdentities.agentId, id))
          .limit(1),
        this.database
          .select()
          .from(marketplaceServices)
          .where(
            and(
              eq(marketplaceServices.agentId, id),
              eq(marketplaceServices.availability, "available"),
              inArray(marketplaceServices.verificationLevel, [
                "INVOCATION_VERIFIED",
                "COMMERCE_VERIFIED",
              ]),
              sql`${marketplaceServices.endpoint} is not null`,
              sql`${marketplaceServices.lastVerifiedAt} >= ${this.#publicFreshnessCutoff().toISOString()}::timestamptz`,
              sql`exists (
                select 1 from service_verification_observations svo
                where svo.service_id = ${marketplaceServices.id}
                  and svo.to_level in ('INVOCATION_VERIFIED', 'COMMERCE_VERIFIED')
                  and svo.result in ('success', 'succeeded', 'verified', 'passed')
                  and not exists (
                    select 1 from service_verification_observations newer
                    where newer.service_id = svo.service_id
                      and (newer.observed_at, newer.id) > (svo.observed_at, svo.id)
                  )
              )`,
            ),
          )
          .orderBy(desc(marketplaceServices.lastVerifiedAt)),
        this.database
          .select({
            fieldPath: factEvidence.fieldPath,
            provenance: factEvidence.provenance,
            source: factEvidence.source,
            sourceUri: factEvidence.sourceUri,
            observedAt: factEvidence.observedAt,
          })
          .from(factEvidence)
          .where(eq(factEvidence.agentId, id))
          .orderBy(desc(factEvidence.observedAt)),
        this.database
          .select({
            invocationSuccessful: marketplaceOutcomes.invocationSuccessful,
            commerceSuccessful: marketplaceOutcomes.commerceSuccessful,
            executionDurationMs: marketplaceOutcomes.executionDurationMs,
            responseStatus: marketplaceOutcomes.responseStatus,
            deliveredAt: marketplaceOutcomes.deliveredAt,
            settlementState: marketplaceOutcomes.settlementState,
            observedCost: marketplaceOutcomes.observedCost,
            observedAt: marketplaceOutcomes.createdAt,
          })
          .from(marketplaceOutcomes)
          .where(eq(marketplaceOutcomes.agentId, id))
          .orderBy(desc(marketplaceOutcomes.createdAt)),
        this.database
          .select({
            id: marketplaceReviews.id,
            activationId: marketplaceReviews.activationId,
            reviewerRole: marketplaceReviews.reviewerRole,
            subjectType: marketplaceReviews.subjectType,
            sentiment: marketplaceReviews.sentiment,
            tags: marketplaceReviews.tags,
            message: marketplaceReviews.message,
            createdAt: marketplaceReviews.createdAt,
          })
          .from(marketplaceReviews)
          .where(
            and(
              eq(marketplaceReviews.subjectAgentId, id),
              eq(marketplaceReviews.subjectType, "AGENT"),
              eq(marketplaceReviews.marketplaceHistoryEligible, true),
            ),
          )
          .orderBy(desc(marketplaceReviews.createdAt)),
        this.database
          .execute<{
            matched_source: string;
            matched_value: string;
          }>(
            sql`
            select distinct ce.matched_source, ce.matched_value
            from classification_evidence ce
            where ce.agent_id = ${id}
              and ce.category_slug = ${summary.category}
            order by ce.matched_source, ce.matched_value
          `,
          )
          .then((result) =>
            executedRows<{
              matched_source: string;
              matched_value: string;
            }>(result),
          ),
      ]);
    const identityRow = identity[0];
    if (identityRow === undefined) return null;
    const base = this.#publicMarketplaceAgent(summary);
    return {
      ...base,
      ownerAddress: identityRow.ownerAddress,
      metadataUri: identityRow.metadataUri,
      registrationTransaction: identityRow.registrationTransaction,
      registrationBlock: identityRow.registrationBlock?.toString() ?? null,
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        interface: service.interfaceProtocol,
        endpoint: service.endpoint!,
        availability: "available" as const,
        verificationLevel: service.verificationLevel as
          "INVOCATION_VERIFIED" | "COMMERCE_VERIFIED",
        pricing: service.pricing,
        protocolSupport: service.protocolSupport as Record<string, unknown>,
        lastVerifiedAt: service.lastVerifiedAt!.toISOString(),
        provenance: service.provenance,
      })),
      evidence: evidence.map((item) => ({
        fieldPath: item.fieldPath,
        label: item.fieldPath
          .split(".")
          .at(-1)!
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (value) => value.toUpperCase()),
        provenance: item.provenance,
        source: item.source,
        sourceUri: item.sourceUri,
        observedAt: item.observedAt.toISOString(),
      })),
      outcomes: outcomes.map((outcome) => ({
        ...outcome,
        deliveredAt: outcome.deliveredAt?.toISOString() ?? null,
        observedAt: outcome.observedAt.toISOString(),
      })),
      reviews: reviews.map((review) => ({
        ...review,
        createdAt: review.createdAt.toISOString(),
      })),
      surfacedBecause: classifications.map(
        (item) => `${item.matched_source}: ${item.matched_value}`,
      ),
      checks: {
        identityVerified: true,
        endpointReachable: true,
        protocolVerified: true,
        invocationVerified: true,
        commerceVerified: base.tier === "Actionable",
        lastCheckedAt: base.lastVerifiedAt,
      },
    };
  }

  public async listPublicCategories() {
    const agents = executedRows<PublicMarketplaceRow>(
      await this.database.execute<PublicMarketplaceRow>(
        this.#publicMarketplaceQuery({ page: 1, limit: 100 }, undefined, false),
      ),
    );
    const categories = [
      ["rebalancing", "Rebalancing"],
      ["grid-trading", "Grid Trading"],
      ["yield-optimisation", "Yield Optimisation"],
      ["health-factor-monitoring", "Health Factor Monitoring"],
    ] as const;
    const candidateCounts = executedRows<{
      category_slug: string;
      discovered: number;
      verified: number;
    }>(
      await this.database.execute(sql`
        select
          category_slug,
          count(distinct agent_id)::int discovered,
          count(distinct agent_id) filter (
            where status in ('INVOCATION_VERIFIED', 'ACTIONABLE')
          )::int verified
        from launch_candidates
        where category_slug in (
          'rebalancing', 'grid-trading', 'yield-optimisation',
          'health-factor-monitoring'
        )
        group by category_slug
      `),
    );
    const candidatesByCategory = new Map(
      candidateCounts.map((row) => [row.category_slug, row]),
    );
    return categories.map(([slug, label]) => {
      const categoryAgents = agents.filter((agent) => agent.category === slug);
      const candidates = candidatesByCategory.get(slug);
      return {
        slug,
        label,
        discovered: Number(candidates?.discovered ?? 0),
        verified: Number(candidates?.verified ?? 0),
        ready: categoryAgents.length,
        hireable: categoryAgents.filter((agent) => agent.hireable).length,
        working: categoryAgents.length,
        actionable: categoryAgents.filter(
          (agent) => agent.tier === "Actionable",
        ).length,
        protocols: [
          ...new Set(categoryAgents.flatMap((agent) => agent.protocols)),
        ].sort(),
      };
    });
  }

  public async sellerReadiness(
    ownerAddress: string,
  ): Promise<SellerAgentReadiness[]> {
    const publicRows = await this.#publicMarketplaceRows({
      page: 1,
      limit: 10_000,
    });
    const publicCandidates = new Set(
      publicRows.map((row) => `${row.id}:${row.category}`),
    );
    const cutoff = this.#publicFreshnessCutoff().toISOString();
    const rows = executedRows<{
      agent_id: string;
      service_id: string | null;
      name: string;
      description: string;
      image_url: string | null;
      category: string;
      chain_id: number;
      external_agent_id: string;
      identity_verified: boolean;
      service_available: boolean;
      verification_passed: boolean;
      last_verified_at: Date | string | null;
      commerce_validated: boolean;
      active_offer: boolean;
      verified_price_base_units: string | null;
      verified_currency: string | null;
    }>(
      await this.database.execute(sql`
        select
          a.id agent_id,
          ms.id service_id,
          a.name,
          coalesce(smp.description, a.description, '') description,
          coalesce(smp.image_url, a.image_url) image_url,
          lc.category_slug category,
          ai.chain_id,
          ai.external_agent_id,
          (
            ai.registration_status in ('registered', 'transferred')
            and ai.standard = 'erc-8004'
            and ai.namespace = 'eip155'
            and ai.chain_id in (56, 97)
            and ai.owner_address ~ '^0x[0-9a-fA-F]{40}$'
          ) identity_verified,
          (
            ms.availability = 'available'
            and ms.endpoint is not null
            and ms.endpoint ~ '^https://'
          ) service_available,
          (
            ms.verification_level in ('SCHEMA_UNDERSTOOD', 'INVOCATION_VERIFIED', 'COMMERCE_VERIFIED')
            and ms.last_verified_at >= ${cutoff}::timestamptz
            and exists (
              select 1 from service_verification_observations svo
              where svo.service_id = ms.id
                and svo.to_level in ('SCHEMA_UNDERSTOOD', 'INVOCATION_VERIFIED', 'COMMERCE_VERIFIED')
                and svo.result in ('success', 'succeeded', 'verified', 'passed')
                and not exists (
                  select 1 from service_verification_observations newer
                  where newer.service_id = svo.service_id
                    and (newer.observed_at, newer.id) > (svo.observed_at, svo.id)
                )
            )
          ) verification_passed,
          ms.last_verified_at,
          verified_quote.price verified_price_base_units,
          verified_quote.currency verified_currency,
          (
            lc.status = 'ACTIONABLE'
            and exists (
              select 1 from marketplace_outcomes mo
              where mo.agent_id = a.id
                and mo.invocation_successful = true
                and mo.commerce_successful = true
            )
          ) commerce_validated,
          exists (
            select 1
            from agent_offers ao
            join agent_offer_versions aov
              on aov.offer_id = ao.id and aov.version = ao.current_version
            where ao.agent_id = a.id
              and ao.service_id = ms.id
              and ao.status = 'ACTIVE'
              and aov.chain_id = ai.chain_id
              and aov.effective_at <= now()
              and (aov.expires_at is null or aov.expires_at > now())
          ) active_offer
        from agent_identities ai
        join agents a on a.id = ai.agent_id
        left join seller_marketplace_profiles smp on smp.agent_id = a.id
        join launch_candidates lc on lc.agent_id = a.id
        left join lateral (
          select candidate_service.*
          from marketplace_services candidate_service
          where candidate_service.agent_id = a.id
            and candidate_service.category_slug = lc.category_slug
          order by
            case candidate_service.verification_level
              when 'COMMERCE_VERIFIED' then 2
              when 'INVOCATION_VERIFIED' then 1
              else 0
            end desc,
            candidate_service.last_verified_at desc nulls last,
            candidate_service.id
          limit 1
        ) ms on true
        left join lateral (
          select
            verification.evidence ->> 'price' price,
            verification.evidence ->> 'currency' currency
          from service_verification_observations verification
          where verification.service_id = ms.id
            and verification.result in ('success', 'succeeded', 'verified', 'passed')
            and verification.evidence ->> 'price' ~ '^[0-9]+$'
            and verification.evidence ->> 'currency' ~ '^0x[0-9a-fA-F]{40}$'
          order by verification.observed_at desc, verification.id desc
          limit 1
        ) verified_quote on true
        where lower(ai.owner_address) = lower(${ownerAddress})
        order by a.name, lc.category_slug
      `),
    );
    return rows.map((row) => {
      const chainId = Number(row.chain_id);
      const paymentToken =
        chainId === 56
          ? erc8183PaymentTokens[56]
          : chainId === 97
            ? erc8183PaymentTokens[97]
            : null;
      const verifiedPrice =
        paymentToken !== null &&
        row.verified_price_base_units !== null &&
        /^\d+$/.test(row.verified_price_base_units) &&
        row.verified_currency?.toLowerCase() ===
          paymentToken.tokenAddress.toLowerCase()
          ? {
              chainId,
              tokenAddress: paymentToken.tokenAddress,
              decimals: paymentToken.decimals,
              amountBaseUnits: row.verified_price_base_units,
              symbol: paymentToken.symbol,
            }
          : null;
      const facts: SellerReadinessFacts = {
        agentId: row.agent_id,
        serviceId: row.service_id,
        name: row.name,
        description: row.description,
        imageUrl: row.image_url,
        category: row.category,
        chainId,
        externalAgentId: row.external_agent_id,
        identityVerified: row.identity_verified,
        serviceAvailable: row.service_available,
        verificationPassed: row.verification_passed,
        lastVerifiedAt:
          row.last_verified_at === null
            ? null
            : new Date(row.last_verified_at).toISOString(),
        commerceValidated: row.commerce_validated,
        activeOffer: row.active_offer,
        publicEligible: publicCandidates.has(`${row.agent_id}:${row.category}`),
        verifiedPrice,
      };
      return sellerReadinessProjection(facts);
    });
  }

  public async internalMarketplaceStatus() {
    const [row] = executedRows<{
      discovered: number;
      enriched: number;
      pending_enrichment: number;
      verification_queue: number;
      directly_verified: number;
      service_declared: number;
      invocation_verified: number;
      actionable: number;
      stale_or_unreachable: number;
      public_marketplace: number;
    }>(
      await this.database.execute(sql`
      select
        (select count(distinct agent_id)::int from corpus_source_records) discovered,
        (select count(*)::int from corpus_source_records where enriched_at is not null) enriched,
        (select count(*)::int from corpus_source_records where enriched_at is null) pending_enrichment,
        (select count(*)::int from verification_queue where status in ('unverified', 'pending', 'failed')) verification_queue,
        (select count(*)::int from verification_queue where status in ('verified', 'partial')) directly_verified,
        (select count(distinct agent_id)::int from marketplace_services where verification_level <> 'DECLARED') service_declared,
        (select count(distinct agent_id)::int from marketplace_services where verification_level in ('INVOCATION_VERIFIED', 'COMMERCE_VERIFIED')) invocation_verified,
        (select count(distinct agent_id)::int from launch_candidates where status = 'ACTIONABLE') actionable,
        (select count(distinct agent_id)::int from marketplace_services where availability in ('degraded', 'unavailable') or verification_level = 'DECLARED') stale_or_unreachable,
        (select count(distinct id)::int from (${this.#publicMarketplaceQuery(
          { page: 1, limit: 100 },
          undefined,
          false,
        )}) public_rows) public_marketplace
    `),
    );
    const categories = executedRows<{
      category_slug: string;
      count: number;
    }>(
      await this.database.execute(sql`
      select category_slug, count(distinct agent_id)::int count
      from launch_candidates
      group by category_slug
      order by category_slug
    `),
    );
    return {
      discovered: Number(row?.discovered ?? 0),
      enriched: Number(row?.enriched ?? 0),
      pendingEnrichment: Number(row?.pending_enrichment ?? 0),
      verificationQueue: Number(row?.verification_queue ?? 0),
      directlyVerified: Number(row?.directly_verified ?? 0),
      serviceDeclared: Number(row?.service_declared ?? 0),
      invocationVerified: Number(row?.invocation_verified ?? 0),
      actionable: Number(row?.actionable ?? 0),
      staleOrUnreachable: Number(row?.stale_or_unreachable ?? 0),
      publicMarketplace: Number(row?.public_marketplace ?? 0),
      categoryCandidates: Object.fromEntries(
        categories.map((item) => [item.category_slug, Number(item.count)]),
      ),
    };
  }

  async #publicMarketplaceRows(
    query: PublicMarketplaceQuery,
    ids?: string[],
  ): Promise<PublicMarketplaceRow[]> {
    return executedRows<PublicMarketplaceRow>(
      await this.database.execute<PublicMarketplaceRow>(
        this.#publicMarketplaceQuery(query, ids, true),
      ),
    );
  }

  #publicMarketplaceQuery(
    query: PublicMarketplaceQuery,
    ids: string[] | undefined,
    paginate: boolean,
  ) {
    const actionable = sql`lc.status = 'ACTIONABLE'`;
    const filters = [
      sql`ms.verification_level in ('INVOCATION_VERIFIED', 'COMMERCE_VERIFIED')`,
      sql`ms.availability = 'available'`,
      sql`ms.endpoint is not null and ms.endpoint ~ '^https://'`,
      sql`ms.last_verified_at >= ${this.#publicFreshnessCutoff().toISOString()}::timestamptz`,
      sql`lc.status in ('INVOCATION_VERIFIED', 'ACTIONABLE')`,
      sql`lc.stale_at is null`,
      sql`ai.standard = 'erc-8004'`,
      sql`ai.namespace = 'eip155'`,
      sql`ai.chain_id in (56, 97)`,
      sql`ai.registration_status in ('registered', 'transferred')`,
      sql`ai.registry_address ~ '^0x[0-9a-fA-F]{40}$'`,
      sql`ai.owner_address ~ '^0x[0-9a-fA-F]{40}$'`,
      sql`ai.external_agent_id ~ '^[0-9]+$'`,
      sql`a.name is not null and length(trim(a.name)) > 0`,
      sql`coalesce(smp.description, a.description) is not null and length(trim(coalesce(smp.description, a.description))) > 0`,
      sql`(a.name || ' ' || coalesce(smp.description, a.description)) !~* '(test deployment|not for production use)'`,
      sql`length(trim(a.metadata_uri)) > 0`,
      sql`length(trim(ai.owner_address)) > 0`,
      sql`exists (
        select 1 from service_verification_observations svo
        where svo.service_id = ms.id
          and svo.to_level in ('INVOCATION_VERIFIED', 'COMMERCE_VERIFIED')
          and svo.result in ('success', 'succeeded', 'verified', 'passed')
          and not exists (
            select 1 from service_verification_observations newer
            where newer.service_id = svo.service_id
              and (newer.observed_at, newer.id) > (svo.observed_at, svo.id)
          )
      )`,
      sql`not exists (
        select 1 from reconciliation_records rr
        where rr.agent_id = a.id
          and rr.status in ('mismatch', 'unavailable_direct')
          and not exists (
            select 1 from reconciliation_records newer
            where newer.agent_id = rr.agent_id
              and newer.field_path = rr.field_path
              and newer.reconciled_at > rr.reconciled_at
          )
      )`,
    ];
    if (ids !== undefined)
      filters.push(
        ids.length === 0
          ? sql`false`
          : sql`a.id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`,
      );
    if (query.text !== undefined)
      filters.push(
        sql`(a.name ilike ${`%${query.text}%`} or coalesce(smp.description, a.description) ilike ${`%${query.text}%`} or coalesce(ms.capability, '') ilike ${`%${query.text}%`})`,
      );
    for (const requirement of query.requirements ?? [])
      filters.push(sql`(
        a.name ilike ${`%${requirement}%`}
        or coalesce(smp.description, a.description) ilike ${`%${requirement}%`}
        or coalesce(ms.capability, '') ilike ${`%${requirement}%`}
        or exists (
          select 1 from classification_evidence ce
          where ce.agent_id = a.id
            and ce.category_slug = lc.category_slug
            and ce.matched_value ilike ${`%${requirement}%`}
        )
      )`);
    if (query.category !== undefined)
      filters.push(sql`lc.category_slug = ${query.category}`);
    if (query.protocol !== undefined)
      filters.push(
        sql`(lower(ms.interface_protocol) = lower(${query.protocol}) or ms.protocol_support @> jsonb_build_object(lower(${query.protocol}), true))`,
      );
    if (query.chainId !== undefined)
      filters.push(sql`ai.chain_id = ${query.chainId}`);
    if (query.interface !== undefined)
      filters.push(sql`ms.interface_protocol = ${query.interface}`);
    if (query.pricingKnown !== undefined) {
      const hasActiveOffer = sql`exists (
        select 1
        from agent_offers filter_offer
        join agent_offer_versions filter_version
          on filter_version.offer_id = filter_offer.id
         and filter_version.version = filter_offer.current_version
        where filter_offer.agent_id = a.id
          and filter_offer.service_id = ms.id
          and filter_offer.status = 'ACTIVE'
          and filter_version.effective_at <= now()
          and (filter_version.expires_at is null or filter_version.expires_at > now())
          and filter_version.chain_id = ai.chain_id
      )`;
      filters.push(
        query.pricingKnown ? hasActiveOffer : sql`not (${hasActiveOffer})`,
      );
    }
    if (query.hasReputation === true)
      filters.push(sql`exists (
        select 1 from reputation_inventory ri
        where ri.agent_id = a.id and ri.feedback_count > 0
      )`);
    if (query.hasReputation === false)
      filters.push(sql`not exists (
        select 1 from reputation_inventory ri
        where ri.agent_id = a.id and ri.feedback_count > 0
      )`);
    const tierFilter =
      query.tier === "Proven"
        ? sql`false`
        : query.tier === "Actionable"
          ? sql`ranked.tier = 'Actionable'`
          : query.tier === "Working"
            ? sql`ranked.tier = 'Working'`
            : sql`true`;
    const pagination = paginate
      ? sql`limit ${query.limit} offset ${(query.page - 1) * query.limit}`
      : sql``;
    return sql`
      with ranked as (
        select
          a.id,
          a.name,
          coalesce(smp.description, a.description) description,
          coalesce(smp.image_url, a.image_url) "imageUrl",
          lc.category_slug category,
          case when ${actionable} then 'Actionable' else 'Working' end tier,
          ai.chain_id "chainId",
          ai.registry_address "registryAddress",
          ai.external_agent_id "externalAgentId",
          lc.supply_type::text "supplyType",
          coalesce(array(
            select distinct tt.slug
            from agent_taxonomy at
            join taxonomy_terms tt on tt.id = at.term_id
            where at.agent_id = a.id and tt.kind = 'capability'
            order by tt.slug
          ), array[]::text[]) capabilities,
          coalesce(array(
            select distinct protocol from (
              select ms.interface_protocol protocol
              union
              select supported.key protocol
              from jsonb_each(ms.protocol_support) supported
              where supported.value = 'true'::jsonb
            ) protocols
            where protocol is not null and protocol <> ''
            order by protocol
          ), array[]::text[]) protocols,
          array[ms.interface_protocol]::text[] interfaces,
          (exists (
            select 1
            from agent_offers price_offer
            join agent_offer_versions price_version
              on price_version.offer_id = price_offer.id
             and price_version.version = price_offer.current_version
            where price_offer.agent_id = a.id
              and price_offer.service_id = ms.id
              and price_offer.status = 'ACTIVE'
              and price_version.effective_at <= now()
              and (price_version.expires_at is null or price_version.expires_at > now())
              and price_version.chain_id = ai.chain_id
          )) "pricingKnown",
          (
            select jsonb_build_object(
              'amountBaseUnits', price_version.price_base_units::text,
              'decimals', price_version.payment_token_decimals,
              'symbol', price_version.currency_symbol,
              'tokenAddress', price_version.payment_token_address
            )
            from agent_offers price_offer
            join agent_offer_versions price_version
              on price_version.offer_id = price_offer.id
             and price_version.version = price_offer.current_version
            where price_offer.agent_id = a.id
              and price_offer.service_id = ms.id
              and price_offer.status = 'ACTIVE'
              and price_version.effective_at <= now()
              and (price_version.expires_at is null or price_version.expires_at > now())
              and price_version.chain_id = ai.chain_id
            order by price_version.effective_at desc, price_offer.id
            limit 1
          ) "activeOfferPrice",
          (${actionable} and exists (
            select 1
            from agent_offers ao
            join agent_offer_versions aov
              on aov.offer_id = ao.id and aov.version = ao.current_version
            where ao.agent_id = a.id
              and ao.service_id = ms.id
              and ao.status = 'ACTIVE'
              and aov.effective_at <= now()
              and (aov.expires_at is null or aov.expires_at > now())
              and aov.chain_id = ai.chain_id
          )) "hireable",
          (select count(*)::int from marketplace_outcomes mo where mo.agent_id = a.id and mo.invocation_successful = true) "verifiedInvocationCount",
          (select count(*)::int
            from activations accepted_activation
            where accepted_activation.agent_id = a.id
              and accepted_activation.purpose = 'USER_COMMERCE'
              and accepted_activation.marketplace_history_eligible = true
              and (
                accepted_activation.lifecycle_state in ('COMPLETED', 'REJECTED', 'REFUNDED', 'FAILED')
                or accepted_activation.status in ('COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED')
              )
              and exists (
                select 1 from commerce_operations funded_operation
                where funded_operation.activation_id = accepted_activation.id
                  and funded_operation.operation_type = 'FUND'
                  and funded_operation.state = 'FINALIZED'
              )) "eligibleAcceptedJobCount",
          (select count(*)::int
            from activations completed_activation
            where completed_activation.agent_id = a.id
              and completed_activation.purpose = 'USER_COMMERCE'
              and completed_activation.marketplace_history_eligible = true
              and completed_activation.lifecycle_state = 'COMPLETED'
              and exists (
                select 1 from commerce_operations funded_operation
                where funded_operation.activation_id = completed_activation.id
                  and funded_operation.operation_type = 'FUND'
                  and funded_operation.state = 'FINALIZED'
              )
              and exists (
                select 1 from marketplace_outcomes completed_outcome
                where completed_outcome.activation_id = completed_activation.id
                  and completed_outcome.commerce_successful = true
              )) "completedCommerceJobCount",
          case
            when (select count(*) from activations accepted_activation
              where accepted_activation.agent_id = a.id
                and accepted_activation.purpose = 'USER_COMMERCE'
                and accepted_activation.marketplace_history_eligible = true
                and (
                  accepted_activation.lifecycle_state in ('COMPLETED', 'REJECTED', 'REFUNDED', 'FAILED')
                  or accepted_activation.status in ('COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED')
                )
                and exists (
                  select 1 from commerce_operations funded_operation
                  where funded_operation.activation_id = accepted_activation.id
                    and funded_operation.operation_type = 'FUND'
                    and funded_operation.state = 'FINALIZED'
                )) = 0 then null
            else round(100.0 *
              (select count(*) from activations completed_activation
                where completed_activation.agent_id = a.id
                  and completed_activation.purpose = 'USER_COMMERCE'
                  and completed_activation.marketplace_history_eligible = true
                  and completed_activation.lifecycle_state = 'COMPLETED'
                  and exists (
                    select 1 from commerce_operations funded_operation
                    where funded_operation.activation_id = completed_activation.id
                      and funded_operation.operation_type = 'FUND'
                      and funded_operation.state = 'FINALIZED'
                  )
                  and exists (
                    select 1 from marketplace_outcomes completed_outcome
                    where completed_outcome.activation_id = completed_activation.id
                      and completed_outcome.commerce_successful = true
                  )) /
              (select count(*) from activations accepted_activation
                where accepted_activation.agent_id = a.id
                  and accepted_activation.purpose = 'USER_COMMERCE'
                  and accepted_activation.marketplace_history_eligible = true
                  and (
                    accepted_activation.lifecycle_state in ('COMPLETED', 'REJECTED', 'REFUNDED', 'FAILED')
                    or accepted_activation.status in ('COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED')
                  )
                  and exists (
                    select 1 from commerce_operations funded_operation
                    where funded_operation.activation_id = accepted_activation.id
                      and funded_operation.operation_type = 'FUND'
                      and funded_operation.state = 'FINALIZED'
                  )))::int
          end "completionRatePercent",
          (select count(*)::int from marketplace_reviews mr
            where mr.subject_agent_id = a.id
              and mr.subject_type = 'AGENT'
              and mr.marketplace_history_eligible = true) "reviewCount",
          (select count(*)::int from marketplace_reviews mr
            where mr.subject_agent_id = a.id
              and mr.subject_type = 'AGENT'
              and mr.sentiment = 'GOOD'
              and mr.marketplace_history_eligible = true) "reviewGoodCount",
          (select count(*)::int from marketplace_reviews mr
            where mr.subject_agent_id = a.id
              and mr.subject_type = 'AGENT'
              and mr.sentiment = 'BAD'
              and mr.marketplace_history_eligible = true) "reviewBadCount",
          (select count(*)::int from marketplace_outcomes mo where mo.agent_id = a.id and mo.delivered_at is not null) "deliveryCompletedCount",
          (select count(*)::int from marketplace_outcomes mo where mo.agent_id = a.id and upper(mo.settlement_state) = 'SETTLED') "settlementCompletedCount",
          (select count(*)::int from marketplace_outcomes mo where mo.agent_id = a.id and upper(mo.settlement_state) in ('FAILED', 'CANCELLED', 'REJECTED', 'REFUNDED')) "unsuccessfulCommerceJobCount",
          coalesce((select max(ri.feedback_count)::int from reputation_inventory ri where ri.agent_id = a.id), 0) "feedbackCount",
          ms.last_verified_at "lastVerifiedAt",
          greatest(a.updated_at, ms.updated_at, smp.updated_at) "updatedAt",
          row_number() over (
            partition by a.id
            order by case when ${actionable} then 1 else 0 end desc,
                     ms.last_verified_at desc,
                     ms.id
          ) row_number
        from marketplace_services ms
        join agents a on a.id = ms.agent_id
        left join seller_marketplace_profiles smp on smp.agent_id = a.id
        join agent_identities ai on ai.agent_id = a.id
        join launch_candidates lc
          on lc.agent_id = a.id and lc.category_slug = ms.category_slug
        where ${sql.join(filters, sql` and `)}
      )
      select ranked.*, count(*) over()::int total
      from ranked
      where ranked.row_number = 1 and ${tierFilter}
      order by case ranked.tier when 'Actionable' then 1 else 0 end desc,
               ranked."lastVerifiedAt" desc,
               ranked.name,
               ranked.id
      ${pagination}
    `;
  }

  #publicMarketplaceAgent(row: PublicMarketplaceRow): PublicMarketplaceAgent {
    if (row.chainId !== 56 && row.chainId !== 97)
      throw new Error(`Unsupported public marketplace chain ${row.chainId}`);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      imageUrl: row.imageUrl,
      category: row.category,
      tier: row.tier,
      availability: "available",
      chainId: row.chainId,
      network: row.chainId === 56 ? "BNB Chain" : "BNB Chain Testnet",
      registryAddress: row.registryAddress,
      externalAgentId: row.externalAgentId,
      supplyType: row.supplyType,
      capabilities: row.capabilities,
      protocols: row.protocols,
      interfaces: row.interfaces,
      pricingKnown: row.pricingKnown,
      activeOfferPrice: row.activeOfferPrice,
      hireable: row.hireable,
      verifiedInvocationCount: Number(row.verifiedInvocationCount),
      eligibleAcceptedJobCount: Number(row.eligibleAcceptedJobCount),
      completedCommerceJobCount: Number(row.completedCommerceJobCount),
      completionRatePercent:
        row.completionRatePercent === null
          ? null
          : Number(row.completionRatePercent),
      reviewCount: Number(row.reviewCount),
      reviewGoodCount: Number(row.reviewGoodCount),
      reviewBadCount: Number(row.reviewBadCount),
      deliveryCompletedCount: Number(row.deliveryCompletedCount),
      settlementCompletedCount: Number(row.settlementCompletedCount),
      unsuccessfulCommerceJobCount: Number(row.unsuccessfulCommerceJobCount),
      feedbackCount: Number(row.feedbackCount),
      lastVerifiedAt: new Date(row.lastVerifiedAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

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
