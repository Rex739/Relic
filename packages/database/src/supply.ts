import type {
  ActivationStatus,
  LaunchCandidateStatus,
  ServiceVerificationLevel,
  SupplyType,
} from "@relic/domain";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  notExists,
  sql,
} from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  activationLifecycleTransitions,
  activationTransitions,
  activationPreflights,
  activations,
  agentIdentities,
  agentServices,
  agents,
  launchCandidates,
  launchCandidateTransitions,
  marketplaceServices,
  serviceDeclarations,
  serviceVerificationObservations,
  targetedDiscoveryRecords,
  targetedDiscoveryRuns,
  verificationQueue,
} from "./schema.js";

const errorPayload = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
});

export class DrizzleSupplyStore {
  constructor(private readonly database: RelicDatabase) {}

  async startDiscoveryRun(input: {
    chainId: number;
    categorySlug: string;
    query: string;
    provider: string;
  }) {
    const [row] = await this.database
      .insert(targetedDiscoveryRuns)
      .values({
        provider: input.provider,
        chainId: input.chainId,
        categorySlug: input.categorySlug,
        query: input.query,
        status: "running",
      })
      .returning({ id: targetedDiscoveryRuns.id });
    if (row === undefined) throw new Error("Failed to create discovery run");
    return row.id;
  }

  async createOnboardingCandidate(input: {
    agentId: string;
    categorySlug: string;
    supplyType: SupplyType;
    submissionId: string;
  }) {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .insert(launchCandidates)
        .values({
          agentId: input.agentId,
          categorySlug: input.categorySlug,
          supplyType: input.supplyType,
          status: "IDENTITY_VERIFIED",
          confidence: "onchain-submission",
          source: "agent-submission",
          evidence: {
            submissionId: input.submissionId,
            categoryProvenance: "relic_metadata_classification",
          },
        })
        .onConflictDoUpdate({
          target: [launchCandidates.agentId, launchCandidates.categorySlug],
          set: {
            supplyType: input.supplyType,
            updatedAt: new Date(),
          },
        })
        .returning({ id: launchCandidates.id });
      if (row === undefined)
        throw new Error("Failed to create onboarding candidate");
      const existingTransition = await transaction
        .select({ id: launchCandidateTransitions.id })
        .from(launchCandidateTransitions)
        .where(
          and(
            eq(launchCandidateTransitions.candidateId, row.id),
            eq(launchCandidateTransitions.toStatus, "IDENTITY_VERIFIED"),
          ),
        )
        .limit(1);
      if (existingTransition.length === 0)
        await transaction.insert(launchCandidateTransitions).values({
          candidateId: row.id,
          fromStatus: null,
          toStatus: "IDENTITY_VERIFIED",
          evidence: {
            submissionId: input.submissionId,
            supplyType: input.supplyType,
            canonicalIdentity: true,
          },
        });
      return row.id;
    });
  }

  async failRunningDiscoveryRuns(reason: string) {
    const rows = await this.database
      .update(targetedDiscoveryRuns)
      .set({
        status: "failed",
        error: { message: reason },
        finishedAt: new Date(),
      })
      .where(eq(targetedDiscoveryRuns.status, "running"))
      .returning({ id: targetedDiscoveryRuns.id });
    return rows.length;
  }

  async recordDiscovery(input: {
    runId: string;
    agentId: string;
    sourceRecordId: string;
    categorySlug: string;
    rank: number;
    query: string;
    raw: unknown;
    confidence: "high" | "medium" | "research-lead";
    matchedEvidence: Record<string, unknown>;
    discoverySource: string;
  }) {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction
        .select()
        .from(launchCandidates)
        .where(
          and(
            eq(launchCandidates.agentId, input.agentId),
            eq(launchCandidates.categorySlug, input.categorySlug),
          ),
        )
        .limit(1);
      let candidateId = existing[0]?.id;
      if (candidateId === undefined) {
        const [created] = await transaction
          .insert(launchCandidates)
          .values({
            agentId: input.agentId,
            categorySlug: input.categorySlug,
            status: "REVIEW_PENDING",
            confidence: input.confidence,
            source: input.discoverySource,
            evidence: {
              query: input.query,
              rank: input.rank,
              ...input.matchedEvidence,
            },
          })
          .returning({ id: launchCandidates.id });
        if (created === undefined)
          throw new Error("Failed to create launch candidate");
        candidateId = created.id;
        await transaction.insert(launchCandidateTransitions).values([
          {
            candidateId,
            fromStatus: null,
            toStatus: "DISCOVERED",
            evidence: { source: input.discoverySource },
          },
          {
            candidateId,
            fromStatus: "DISCOVERED",
            toStatus: "REVIEW_PENDING",
            evidence: { query: input.query, rank: input.rank },
          },
        ]);
      } else {
        await transaction
          .update(launchCandidates)
          .set({
            evidence: sql`${launchCandidates.evidence} || ${JSON.stringify({
              latestQuery: input.query,
              latestRank: input.rank,
            })}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(launchCandidates.id, candidateId));
      }
      await transaction
        .insert(targetedDiscoveryRecords)
        .values({
          runId: input.runId,
          agentId: input.agentId,
          candidateId,
          sourceRecordId: input.sourceRecordId,
          rank: input.rank,
          raw: input.raw,
          searchEvidence: {
            query: input.query,
            category: input.categorySlug,
            confidence: input.confidence,
            ...input.matchedEvidence,
          },
        })
        .onConflictDoNothing({
          target: [
            targetedDiscoveryRecords.runId,
            targetedDiscoveryRecords.sourceRecordId,
          ],
        });
      await transaction
        .update(verificationQueue)
        .set({
          priority: sql`greatest(${verificationQueue.priority}, ${1_000 - input.rank})`,
          updatedAt: new Date(),
        })
        .where(eq(verificationQueue.agentId, input.agentId));
      return candidateId;
    });
  }

  async finishDiscoveryRun(input: {
    runId: string;
    returned: number;
    accepted: number;
    rejected: number;
    rateLimit: {
      limit: number | null;
      remaining: number | null;
      resetAt: string | null;
    };
    error?: unknown;
  }) {
    await this.database
      .update(targetedDiscoveryRuns)
      .set({
        status: input.error === undefined ? "succeeded" : "failed",
        returnedCount: input.returned,
        acceptedCount: input.accepted,
        rejectedCount: input.rejected,
        rateLimit: input.rateLimit.limit,
        rateLimitRemaining: input.rateLimit.remaining,
        rateLimitResetAt:
          input.rateLimit.resetAt === null
            ? null
            : new Date(input.rateLimit.resetAt),
        error: input.error === undefined ? null : errorPayload(input.error),
        finishedAt: new Date(),
      })
      .where(eq(targetedDiscoveryRuns.id, input.runId));
  }

  async transitionCandidate(input: {
    candidateId: string;
    from: LaunchCandidateStatus;
    to: LaunchCandidateStatus;
    evidence: Record<string, unknown>;
  }) {
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(launchCandidates)
        .set({
          status: input.to,
          lastReviewedAt: new Date(),
          staleAt: input.to === "STALE" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(launchCandidates.id, input.candidateId),
            eq(launchCandidates.status, input.from),
          ),
        )
        .returning({ id: launchCandidates.id });
      if (updated.length !== 1)
        throw new Error(
          `Candidate ${input.candidateId} is not in ${input.from}`,
        );
      await transaction.insert(launchCandidateTransitions).values({
        candidateId: input.candidateId,
        fromStatus: input.from,
        toStatus: input.to,
        evidence: input.evidence,
      });
    });
  }

  async candidateSources(limit = 100) {
    return this.database
      .select({
        candidate: launchCandidates,
        identityStatus: verificationQueue.status,
        agent: agents,
        identity: agentIdentities,
      })
      .from(launchCandidates)
      .innerJoin(agents, eq(agents.id, launchCandidates.agentId))
      .innerJoin(agentIdentities, eq(agentIdentities.agentId, agents.id))
      .leftJoin(verificationQueue, eq(verificationQueue.agentId, agents.id))
      .where(
        inArray(launchCandidates.status, [
          "REVIEW_PENDING",
          "IDENTITY_VERIFIED",
          "SERVICE_IDENTIFIED",
          "SERVICE_OBSERVED",
          "INVOCATION_VERIFIED",
        ]),
      )
      // Always repair candidates with no materialized service before spending
      // a bounded cycle on already-catalogued inventory. This prevents a
      // verified seller from being starved by unrelated discovery backlog.
      .orderBy(
        asc(sql`case when not exists (
          select 1 from ${marketplaceServices}
          where ${marketplaceServices.agentId} = ${agents.id}
        ) then 0 else 1 end`),
        asc(launchCandidates.categorySlug),
        asc(agents.id),
      )
      .limit(limit);
  }

  async sourceServices(agentId: string) {
    const [canonical, declarations] = await Promise.all([
      this.database
        .select()
        .from(agentServices)
        .where(eq(agentServices.agentId, agentId)),
      this.database
        .select()
        .from(serviceDeclarations)
        .where(eq(serviceDeclarations.agentId, agentId)),
    ]);
    return { canonical, declarations };
  }

  async upsertMarketplaceService(input: {
    agentId: string;
    sourceDeclarationId?: string;
    sourceServiceId: string;
    name: string;
    description?: string | null;
    capability?: string | null;
    categorySlug: string;
    interfaceProtocol: string;
    endpoint?: string | null;
    verificationUrl?: string | null;
    httpMethod?: string | null;
    inputSchema?: unknown;
    outputSchema?: unknown;
    pricing?: unknown;
    currencyToken?: string | null;
    networkChainId?: number | null;
    sla?: unknown;
    authenticationRequirements?: unknown;
    protocolSupport: Record<string, unknown>;
    source: string;
    provenance:
      | "onchain_verified"
      | "independently_observed"
      | "agent_reported"
      | "developer_declared"
      | "secondary_unverified";
    raw: unknown;
  }) {
    const [row] = await this.database
      .insert(marketplaceServices)
      .values({
        agentId: input.agentId,
        sourceDeclarationId: input.sourceDeclarationId,
        sourceServiceId: input.sourceServiceId,
        name: input.name,
        description: input.description,
        capability: input.capability,
        categorySlug: input.categorySlug,
        interfaceProtocol: input.interfaceProtocol,
        endpoint: input.endpoint,
        verificationUrl: input.verificationUrl,
        httpMethod: input.httpMethod,
        inputSchema: input.inputSchema,
        outputSchema: input.outputSchema,
        pricing: input.pricing,
        currencyToken: input.currencyToken,
        networkChainId: input.networkChainId,
        sla: input.sla,
        authenticationRequirements: input.authenticationRequirements,
        protocolSupport: input.protocolSupport,
        source: input.source,
        provenance: input.provenance,
        raw: input.raw,
      })
      .onConflictDoUpdate({
        target: [
          marketplaceServices.agentId,
          marketplaceServices.source,
          marketplaceServices.sourceServiceId,
        ],
        set: {
          name: input.name,
          description: input.description,
          capability: input.capability,
          categorySlug: input.categorySlug,
          interfaceProtocol: input.interfaceProtocol,
          endpoint: input.endpoint,
          verificationUrl: input.verificationUrl,
          httpMethod: input.httpMethod,
          inputSchema: input.inputSchema,
          outputSchema: input.outputSchema,
          pricing: input.pricing,
          currencyToken: input.currencyToken,
          networkChainId: input.networkChainId,
          sla: input.sla,
          authenticationRequirements: input.authenticationRequirements,
          protocolSupport: input.protocolSupport,
          provenance: input.provenance,
          raw: input.raw,
          updatedAt: new Date(),
        },
      })
      .returning({ id: marketplaceServices.id });
    if (row === undefined) throw new Error("Failed to persist service");
    return row.id;
  }

  async serviceInspectionCandidates(
    limit: number,
    options: { force?: boolean; serviceId?: string } = {},
  ) {
    const retryAfter = new Date(Date.now() - 15 * 60 * 1_000);
    return this.database
      .select({
        service: marketplaceServices,
        candidate: launchCandidates,
        identity: agentIdentities,
      })
      .from(marketplaceServices)
      .innerJoin(
        agentIdentities,
        eq(agentIdentities.agentId, marketplaceServices.agentId),
      )
      .innerJoin(
        launchCandidates,
        and(
          eq(launchCandidates.agentId, marketplaceServices.agentId),
          eq(launchCandidates.categorySlug, marketplaceServices.categorySlug),
        ),
      )
      .where(
        and(
          // Re-check services at a bounded interval even after a prior
          // success. Readiness has a freshness window, so restricting this
          // queue to DECLARED services leaves an otherwise healthy seller
          // permanently stale once that window expires.
          ...(options.force
            ? []
            : [
                notExists(
                  this.database
                    .select({ id: serviceVerificationObservations.id })
                    .from(serviceVerificationObservations)
                    .where(
                      and(
                        eq(
                          serviceVerificationObservations.serviceId,
                          marketplaceServices.id,
                        ),
                        gt(
                          serviceVerificationObservations.observedAt,
                          retryAfter,
                        ),
                      ),
                    ),
                ),
              ]),
          ...(options.serviceId === undefined
            ? []
            : [eq(marketplaceServices.id, options.serviceId)]),
          inArray(launchCandidates.status, [
            "SERVICE_IDENTIFIED",
            "IDENTITY_VERIFIED",
            "REVIEW_PENDING",
            "SERVICE_OBSERVED",
            "INVOCATION_VERIFIED",
          ]),
        ),
      )
      .orderBy(
        asc(marketplaceServices.lastVerifiedAt),
        desc(
          sql`case when ${marketplaceServices.endpoint} is not null then 1 else 0 end`,
        ),
        asc(marketplaceServices.id),
      )
      .limit(limit);
  }

  async recordServiceVerification(input: {
    serviceId: string;
    fromLevel: ServiceVerificationLevel;
    toLevel: ServiceVerificationLevel;
    result: "passed" | "failed" | "blocked";
    protocol: string;
    requestMethod?: string | null;
    httpStatus?: number | null;
    latencyMs?: number | null;
    evidence: Record<string, unknown>;
    error?: unknown;
    availability: "unknown" | "available" | "degraded" | "unavailable";
  }) {
    const now = new Date();
    await this.database.transaction(async (transaction) => {
      await transaction.insert(serviceVerificationObservations).values({
        serviceId: input.serviceId,
        fromLevel: input.fromLevel,
        toLevel: input.toLevel,
        result: input.result,
        protocol: input.protocol,
        requestMethod: input.requestMethod,
        httpStatus: input.httpStatus,
        latencyMs: input.latencyMs,
        evidence: input.evidence,
        error: input.error === undefined ? null : errorPayload(input.error),
        observedAt: now,
      });
      await transaction
        .update(marketplaceServices)
        .set({
          verificationLevel:
            input.result === "passed" ? input.toLevel : input.fromLevel,
          availability: input.availability,
          lastVerifiedAt: now,
          updatedAt: now,
        })
        .where(eq(marketplaceServices.id, input.serviceId));
    });
  }

  async createActivation(input: {
    agentId: string;
    serviceId: string;
    chainId: number;
    commerceAddress?: string | null;
    clientAddress?: string | null;
    providerAddress?: string | null;
    evaluatorAddress?: string | null;
    budget?: string | null;
    currencyToken?: string | null;
    descriptionHash?: string | null;
    evidence: Record<string, unknown>;
  }) {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .insert(activations)
        .values({
          agentId: input.agentId,
          serviceId: input.serviceId,
          chainId: input.chainId,
          status: "PREPARED",
          commerceAddress: input.commerceAddress,
          clientAddress: input.clientAddress,
          providerAddress: input.providerAddress,
          evaluatorAddress: input.evaluatorAddress,
          budget: input.budget,
          currencyToken: input.currencyToken,
          descriptionHash: input.descriptionHash,
        })
        .returning({ id: activations.id });
      if (row === undefined) throw new Error("Failed to create activation");
      await transaction.insert(activationTransitions).values({
        activationId: row.id,
        status: "PREPARED",
        evidence: input.evidence,
      });
      await transaction.insert(activationLifecycleTransitions).values({
        activationId: row.id,
        fromState: null,
        toState: "PREPARING",
        evidence: input.evidence,
      });
      return row.id;
    });
  }

  async findActivation(id: string) {
    const [row] = await this.database
      .select({
        activation: activations,
        service: marketplaceServices,
        candidate: launchCandidates,
      })
      .from(activations)
      .innerJoin(
        marketplaceServices,
        eq(marketplaceServices.id, activations.serviceId),
      )
      .innerJoin(
        launchCandidates,
        and(
          eq(launchCandidates.agentId, activations.agentId),
          eq(launchCandidates.categorySlug, marketplaceServices.categorySlug),
        ),
      )
      .where(eq(activations.id, id))
      .limit(1);
    return row ?? null;
  }

  async findServiceCandidate(serviceId: string) {
    const [row] = await this.database
      .select({
        service: marketplaceServices,
        candidate: launchCandidates,
        identity: agentIdentities,
      })
      .from(marketplaceServices)
      .innerJoin(
        launchCandidates,
        and(
          eq(launchCandidates.agentId, marketplaceServices.agentId),
          eq(launchCandidates.categorySlug, marketplaceServices.categorySlug),
        ),
      )
      .innerJoin(
        agentIdentities,
        eq(agentIdentities.agentId, marketplaceServices.agentId),
      )
      .where(eq(marketplaceServices.id, serviceId))
      .limit(1);
    return row ?? null;
  }

  async recordActivationPreflight(input: {
    serviceId?: string;
    chainId: number;
    status: ActivationStatus;
    commerceAddress: string;
    paymentToken?: string | null;
    contractDeployed: boolean;
    transactionAttempted: boolean;
    evidence: Record<string, unknown>;
    failure?: Record<string, unknown> | null;
  }) {
    const [row] = await this.database
      .insert(activationPreflights)
      .values({
        serviceId: input.serviceId,
        chainId: input.chainId,
        status: input.status,
        commerceAddress: input.commerceAddress,
        paymentToken: input.paymentToken,
        contractDeployed: input.contractDeployed,
        transactionAttempted: input.transactionAttempted,
        evidence: input.evidence,
        failure: input.failure,
      })
      .returning({ id: activationPreflights.id });
    if (row === undefined)
      throw new Error("Failed to persist activation preflight");
    return row.id;
  }

  async activationCandidates(limit = 10) {
    return this.database
      .select({
        service: marketplaceServices,
        candidate: launchCandidates,
        identity: agentIdentities,
      })
      .from(marketplaceServices)
      .innerJoin(
        launchCandidates,
        and(
          eq(launchCandidates.agentId, marketplaceServices.agentId),
          eq(launchCandidates.categorySlug, marketplaceServices.categorySlug),
        ),
      )
      .innerJoin(
        agentIdentities,
        eq(agentIdentities.agentId, marketplaceServices.agentId),
      )
      .where(
        and(
          eq(marketplaceServices.interfaceProtocol, "erc8183"),
          eq(marketplaceServices.verificationLevel, "COMMERCE_VERIFIED"),
          eq(launchCandidates.status, "ACTIONABLE"),
        ),
      )
      .orderBy(
        desc(sql`case ${marketplaceServices.verificationLevel}
          when 'COMMERCE_VERIFIED' then 5
          when 'INVOCATION_VERIFIED' then 4
          when 'PAYMENT_UNDERSTOOD' then 3
          when 'SCHEMA_UNDERSTOOD' then 2
          when 'ENDPOINT_OBSERVED' then 1
          else 0 end`),
        asc(marketplaceServices.id),
      )
      .limit(limit);
  }

  async referenceCommerceCandidates(limit = 10) {
    return this.database
      .select({
        service: marketplaceServices,
        candidate: launchCandidates,
        identity: agentIdentities,
      })
      .from(marketplaceServices)
      .innerJoin(
        launchCandidates,
        and(
          eq(launchCandidates.agentId, marketplaceServices.agentId),
          eq(launchCandidates.categorySlug, marketplaceServices.categorySlug),
        ),
      )
      .innerJoin(
        agentIdentities,
        eq(agentIdentities.agentId, marketplaceServices.agentId),
      )
      .where(
        and(
          eq(marketplaceServices.interfaceProtocol, "erc8183"),
          eq(marketplaceServices.availability, "available"),
          inArray(marketplaceServices.verificationLevel, [
            "PAYMENT_UNDERSTOOD",
            "INVOCATION_VERIFIED",
            "COMMERCE_VERIFIED",
          ]),
          eq(launchCandidates.supplyType, "relic_reference"),
          inArray(launchCandidates.status, [
            "SERVICE_OBSERVED",
            "INVOCATION_VERIFIED",
            "ACTIONABLE",
          ]),
        ),
      )
      .orderBy(asc(marketplaceServices.id))
      .limit(limit);
  }

  async transitionActivation(input: {
    activationId: string;
    status: ActivationStatus;
    externalJobId?: string | null;
    transactionHash?: string | null;
    blockNumber?: bigint | null;
    resultReference?: string | null;
    commerceAddress?: string | null;
    clientAddress?: string | null;
    providerAddress?: string | null;
    evaluatorAddress?: string | null;
    failure?: Record<string, unknown> | null;
    evidence: Record<string, unknown>;
  }) {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(activations)
        .set({
          status: input.status,
          externalJobId: input.externalJobId,
          resultReference: input.resultReference,
          commerceAddress: input.commerceAddress,
          clientAddress: input.clientAddress,
          providerAddress: input.providerAddress,
          evaluatorAddress: input.evaluatorAddress,
          failure: input.failure,
          updatedAt: new Date(),
        })
        .where(eq(activations.id, input.activationId));
      await transaction.insert(activationTransitions).values({
        activationId: input.activationId,
        status: input.status,
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber,
        evidence: input.evidence,
      });
    });
  }

  async report() {
    const [
      discoveryRuns,
      candidates,
      services,
      inspections,
      availability,
      preflights,
      activationsByStatus,
      interfaces,
    ] = await Promise.all([
      this.database.execute<{
        category: string;
        status: string;
        count: number;
      }>(sql`
          select category_slug category, status::text, count(*)::int count
          from targeted_discovery_runs group by category_slug, status
          order by category_slug, status
        `),
      this.database.execute<{
        category: string;
        status: string;
        count: number;
      }>(sql`
          select category_slug category, status::text, count(*)::int count
          from launch_candidates group by category_slug, status
          order by category_slug, status
        `),
      this.database.execute<{ level: string; count: number }>(sql`
          select verification_level::text level, count(*)::int count
          from marketplace_services group by verification_level
          order by verification_level
        `),
      this.database.execute<{
        level: string;
        result: string;
        count: number;
      }>(sql`
          select to_level::text level, result, count(*)::int count
          from service_verification_observations group by to_level, result
          order by to_level, result
        `),
      this.database.execute<{ availability: string; count: number }>(sql`
          select availability::text, count(*)::int count
          from marketplace_services group by availability
          order by availability
        `),
      this.database.execute<{ status: string; count: number }>(sql`
          select status::text, count(*)::int count
          from activation_preflights group by status order by status
        `),
      this.database
        .select({ status: activations.status, count: count() })
        .from(activations)
        .groupBy(activations.status),
      this.database.execute<{ interface: string; count: number }>(sql`
          select interface_protocol interface, count(*)::int count
          from marketplace_services group by interface_protocol
          order by interface_protocol
        `),
    ]);
    return {
      discoveryRuns,
      candidates,
      services,
      inspections,
      availability,
      preflights,
      interfaces,
      activations: activationsByStatus.map((row) => ({
        status: row.status,
        count: Number(row.count),
      })),
    };
  }
}
