import type {
  ActivationLifecycleState,
  AgentSubmission,
  CreateAgentSubmission,
  OnboardingRepository,
  SubmissionStatus,
} from "@relic/domain";
import {
  assertActivationLifecycleTransition,
  assertSubmissionTransition,
} from "@relic/domain";
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  activationLifecycleTransitions,
  activations,
  agentIdentities,
  agentServices,
  agentSubmissions,
  marketplaceOutcomes,
  marketplaceServices,
  ownershipChallenges,
  sellerAgentAuthorizations,
  sellerMarketplaceProfiles,
  submissionTransitions,
} from "./schema.js";

const asSubmission = (
  row: typeof agentSubmissions.$inferSelect,
): AgentSubmission => ({
  id: row.id,
  chainId: row.chainId,
  registryAddress: row.registryAddress as `0x${string}`,
  externalAgentId: row.externalAgentId,
  supplyType: row.supplyType,
  relicPrincipalId: row.relicPrincipalId,
  status: row.status,
  submitterAddress: row.submitterAddress as `0x${string}` | null,
  ownershipVerifiedAt: row.ownershipVerifiedAt?.toISOString() ?? null,
  agentId: row.agentId,
  candidateId: row.candidateId,
  developerOverrides: row.developerOverrides as Record<string, unknown>,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const asAuthorization = (
  row: typeof sellerAgentAuthorizations.$inferSelect,
) => ({
  id: row.id,
  principalId: row.principalId,
  submissionId: row.submissionId,
  agentId: row.agentId,
  chainId: row.chainId,
  registryAddress: row.registryAddress as `0x${string}`,
  externalAgentId: row.externalAgentId,
  verifiedOwner: row.verifiedOwner as `0x${string}`,
  challengeId: row.challengeId,
  verifiedAt: row.verifiedAt.toISOString(),
  lastOwnerCheckedAt: row.lastOwnerCheckedAt.toISOString(),
  revokedAt: row.revokedAt?.toISOString() ?? null,
  revocationReason: row.revocationReason,
});

export class DrizzleOnboardingStore implements OnboardingRepository {
  constructor(private readonly database: RelicDatabase) {}

  async createSubmission(input: CreateAgentSubmission) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(agentSubmissions)
        .where(
          and(
            eq(agentSubmissions.chainId, input.chainId),
            sql`lower(${agentSubmissions.registryAddress}) = lower(${input.registryAddress})`,
            eq(agentSubmissions.externalAgentId, input.externalAgentId),
          ),
        )
        .limit(1);
      if (existing !== undefined) {
        if (
          existing.relicPrincipalId !== null &&
          existing.relicPrincipalId !== input.relicPrincipalId
        ) {
          const [authorization] = await transaction
            .select()
            .from(sellerAgentAuthorizations)
            .where(
              and(
                eq(sellerAgentAuthorizations.chainId, input.chainId),
                sql`lower(${sellerAgentAuthorizations.registryAddress}) = lower(${input.registryAddress})`,
                eq(
                  sellerAgentAuthorizations.externalAgentId,
                  input.externalAgentId,
                ),
                isNull(sellerAgentAuthorizations.revokedAt),
              ),
            )
            .limit(1);
          if (
            authorization === undefined ||
            authorization.verifiedOwner.toLowerCase() ===
              input.liveOwner.toLowerCase()
          )
            throw new Error(
              "This agent listing is already bound to another Relic account",
            );
          await transaction
            .update(sellerAgentAuthorizations)
            .set({
              revokedAt: new Date(),
              revocationReason: "erc8004_ownership_transferred",
            })
            .where(eq(sellerAgentAuthorizations.id, authorization.id));
        }
        const [updated] = await transaction
          .update(agentSubmissions)
          .set({
            submitterAddress: input.submitterAddress,
            relicPrincipalId: input.relicPrincipalId,
            registryAddress: input.registryAddress,
            ownershipVerifiedAt:
              existing.relicPrincipalId === input.relicPrincipalId
                ? existing.ownershipVerifiedAt
                : null,
            developerOverrides: input.developerOverrides ?? {},
            updatedAt: new Date(),
          })
          .where(eq(agentSubmissions.id, existing.id))
          .returning();
        if (updated === undefined)
          throw new Error("Failed to refresh submission");
        return asSubmission(updated);
      }
      const [row] = await transaction
        .insert(agentSubmissions)
        .values({
          chainId: input.chainId,
          registryAddress: input.registryAddress,
          externalAgentId: input.externalAgentId,
          supplyType: input.supplyType,
          relicPrincipalId: input.relicPrincipalId,
          submitterAddress: input.submitterAddress,
          developerOverrides: input.developerOverrides ?? {},
          evidence: input.evidence,
        })
        .returning();
      if (row === undefined) throw new Error("Failed to persist submission");
      await transaction.insert(submissionTransitions).values({
        submissionId: row.id,
        fromStatus: null,
        toStatus: "SUBMITTED",
        evidence: input.evidence,
      });
      return asSubmission(row);
    });
  }

  async findSubmission(id: string) {
    const [row] = await this.database
      .select()
      .from(agentSubmissions)
      .where(eq(agentSubmissions.id, id))
      .limit(1);
    return row === undefined ? null : asSubmission(row);
  }

  async listPendingCatalogSubmissions(limit: number) {
    return (
      await this.database
        .select()
        .from(agentSubmissions)
        .where(
          and(
            isNotNull(agentSubmissions.ownershipVerifiedAt),
            or(
              and(
                eq(agentSubmissions.status, "SUBMITTED"),
                isNull(agentSubmissions.agentId),
              ),
              and(
                eq(agentSubmissions.status, "SERVICE_VERIFICATION"),
                isNotNull(agentSubmissions.agentId),
                isNotNull(agentSubmissions.candidateId),
                sql`not exists (
                  select 1 from ${agentServices}
                  where ${agentServices.agentId} = ${agentSubmissions.agentId}
                )`,
              ),
            ),
          ),
        )
        .orderBy(asc(agentSubmissions.createdAt))
        .limit(limit)
    ).map(asSubmission);
  }

  async findSubmissionByIdentity(
    chainId: number,
    registryAddress: `0x${string}`,
    externalAgentId: string,
  ) {
    const [row] = await this.database
      .select()
      .from(agentSubmissions)
      .where(
        and(
          eq(agentSubmissions.chainId, chainId),
          sql`lower(${agentSubmissions.registryAddress}) = lower(${registryAddress})`,
          eq(agentSubmissions.externalAgentId, externalAgentId),
        ),
      )
      .limit(1);
    return row === undefined ? null : asSubmission(row);
  }

  async findSubmissionByCandidateId(candidateId: string) {
    const [row] = await this.database
      .select()
      .from(agentSubmissions)
      .where(eq(agentSubmissions.candidateId, candidateId))
      .limit(1);
    return row === undefined ? null : asSubmission(row);
  }

  async findOwnershipContext(chainId: number, externalAgentId: string) {
    const [row] = await this.database
      .select({
        registryAddress: agentIdentities.registryAddress,
        ownerAddress: agentIdentities.ownerAddress,
      })
      .from(agentIdentities)
      .where(
        and(
          eq(agentIdentities.chainId, chainId),
          eq(agentIdentities.externalAgentId, externalAgentId),
        ),
      )
      .limit(1);
    if (row === undefined) return null;
    return {
      registryAddress: row.registryAddress as `0x${string}`,
      ownerAddress: row.ownerAddress as `0x${string}`,
    };
  }

  async createOwnershipChallenge(input: {
    submissionId: string;
    principalId: string;
    chainId: number;
    registryAddress: `0x${string}`;
    externalAgentId: string;
    nonceHash: string;
    message: string;
    expectedOwner: `0x${string}`;
    issuedAt: Date;
    expiresAt: Date;
  }) {
    const [row] = await this.database
      .insert(ownershipChallenges)
      .values(input)
      .returning();
    if (row === undefined)
      throw new Error("Failed to persist ownership challenge");
    return {
      id: row.id,
      submissionId: row.submissionId,
      principalId: row.principalId!,
      chainId: row.chainId!,
      registryAddress: row.registryAddress as `0x${string}`,
      externalAgentId: row.externalAgentId!,
      message: row.message,
      expectedOwner: row.expectedOwner as `0x${string}`,
      issuedAt: row.issuedAt!.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async findOwnershipChallenge(id: string) {
    const [row] = await this.database
      .select()
      .from(ownershipChallenges)
      .where(eq(ownershipChallenges.id, id))
      .limit(1);
    if (row === undefined || row.consumedAt !== null) return null;
    return {
      id: row.id,
      submissionId: row.submissionId,
      principalId: row.principalId!,
      chainId: row.chainId!,
      registryAddress: row.registryAddress as `0x${string}`,
      externalAgentId: row.externalAgentId!,
      message: row.message,
      expectedOwner: row.expectedOwner as `0x${string}`,
      issuedAt: row.issuedAt!.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async consumeOwnershipChallengeAndAuthorize(input: {
    challengeId: string;
    principalId: string;
    submissionId: string;
    chainId: number;
    registryAddress: `0x${string}`;
    externalAgentId: string;
    signerAddress: `0x${string}`;
    signatureDigest: string;
    verifiedAt: Date;
  }) {
    return this.database.transaction(async (transaction) => {
      const [challenge] = await transaction
        .update(ownershipChallenges)
        .set({
          signerAddress: input.signerAddress,
          signatureDigest: input.signatureDigest,
          consumedAt: input.verifiedAt,
          verifiedAt: input.verifiedAt,
        })
        .where(
          and(
            eq(ownershipChallenges.id, input.challengeId),
            eq(ownershipChallenges.submissionId, input.submissionId),
            eq(ownershipChallenges.principalId, input.principalId),
            eq(ownershipChallenges.chainId, input.chainId),
            sql`lower(${ownershipChallenges.registryAddress}) = lower(${input.registryAddress})`,
            eq(ownershipChallenges.externalAgentId, input.externalAgentId),
            isNull(ownershipChallenges.consumedAt),
            gt(ownershipChallenges.expiresAt, input.verifiedAt),
            sql`lower(${ownershipChallenges.expectedOwner}) = lower(${input.signerAddress})`,
          ),
        )
        .returning({ submissionId: ownershipChallenges.submissionId });
      if (challenge === undefined) return null;
      const [submission] = await transaction
        .select({ agentId: agentSubmissions.agentId })
        .from(agentSubmissions)
        .where(
          and(
            eq(agentSubmissions.id, challenge.submissionId),
            eq(agentSubmissions.relicPrincipalId, input.principalId),
          ),
        )
        .limit(1);
      if (submission === undefined)
        throw new Error("Submission is not bound to this Relic account");
      const [active] = await transaction
        .select()
        .from(sellerAgentAuthorizations)
        .where(
          and(
            eq(sellerAgentAuthorizations.chainId, input.chainId),
            sql`lower(${sellerAgentAuthorizations.registryAddress}) = lower(${input.registryAddress})`,
            eq(
              sellerAgentAuthorizations.externalAgentId,
              input.externalAgentId,
            ),
            isNull(sellerAgentAuthorizations.revokedAt),
          ),
        )
        .limit(1);
      if (
        active !== undefined &&
        active.principalId !== input.principalId &&
        active.verifiedOwner.toLowerCase() === input.signerAddress.toLowerCase()
      )
        throw new Error(
          "This agent is already authorized to another Relic account",
        );
      if (active !== undefined)
        await transaction
          .update(sellerAgentAuthorizations)
          .set({
            revokedAt: input.verifiedAt,
            revocationReason:
              active.principalId === input.principalId
                ? "ownership_reverified"
                : "erc8004_ownership_transferred",
          })
          .where(eq(sellerAgentAuthorizations.id, active.id));
      const [authorization] = await transaction
        .insert(sellerAgentAuthorizations)
        .values({
          principalId: input.principalId,
          submissionId: challenge.submissionId,
          agentId: submission.agentId,
          chainId: input.chainId,
          registryAddress: input.registryAddress,
          externalAgentId: input.externalAgentId,
          verifiedOwner: input.signerAddress,
          challengeId: input.challengeId,
          verifiedAt: input.verifiedAt,
          lastOwnerCheckedAt: input.verifiedAt,
        })
        .returning();
      if (authorization === undefined)
        throw new Error("Seller authorization insert failed");
      await transaction
        .update(agentSubmissions)
        .set({
          ownershipVerifiedAt: input.verifiedAt,
          updatedAt: input.verifiedAt,
        })
        .where(eq(agentSubmissions.id, challenge.submissionId));
      return asAuthorization(authorization);
    });
  }

  async findSellerAuthorization(input: {
    principalId: string;
    agentId: string;
  }) {
    const [row] = await this.database
      .select()
      .from(sellerAgentAuthorizations)
      .where(
        and(
          eq(sellerAgentAuthorizations.principalId, input.principalId),
          eq(sellerAgentAuthorizations.agentId, input.agentId),
          isNull(sellerAgentAuthorizations.revokedAt),
        ),
      )
      .limit(1);
    return row === undefined ? null : asAuthorization(row);
  }

  async listSellerAuthorizations(principalId: string) {
    const rows = await this.database
      .select()
      .from(sellerAgentAuthorizations)
      .where(
        and(
          eq(sellerAgentAuthorizations.principalId, principalId),
          isNull(sellerAgentAuthorizations.revokedAt),
        ),
      );
    return rows.map(asAuthorization);
  }

  async revokeSellerAuthorization(input: {
    authorizationId: string;
    reason: string;
    revokedAt: Date;
  }) {
    const rows = await this.database
      .update(sellerAgentAuthorizations)
      .set({
        revokedAt: input.revokedAt,
        revocationReason: input.reason,
        lastOwnerCheckedAt: input.revokedAt,
      })
      .where(
        and(
          eq(sellerAgentAuthorizations.id, input.authorizationId),
          isNull(sellerAgentAuthorizations.revokedAt),
        ),
      )
      .returning({ id: sellerAgentAuthorizations.id });
    return rows.length === 1;
  }

  async upsertSellerMarketplaceProfile(input: {
    agentId: string;
    principalId: string;
    description: string;
    imageUrl: string | null;
    updatedAt: Date;
  }) {
    const [profile] = await this.database
      .insert(sellerMarketplaceProfiles)
      .values({
        agentId: input.agentId,
        description: input.description,
        imageUrl: input.imageUrl,
        updatedByPrincipalId: input.principalId,
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
      })
      .onConflictDoUpdate({
        target: sellerMarketplaceProfiles.agentId,
        set: {
          description: input.description,
          imageUrl: input.imageUrl,
          updatedByPrincipalId: input.principalId,
          updatedAt: input.updatedAt,
        },
      })
      .returning();
    if (profile === undefined)
      throw new Error("Marketplace profile update did not persist");
    return {
      agentId: profile.agentId,
      description: profile.description,
      imageUrl: profile.imageUrl,
      updatedByPrincipalId: profile.updatedByPrincipalId,
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async updateSellerMarketplaceServiceEndpoint(input: {
    agentId: string;
    serviceId: string;
    endpoint: string;
    updatedAt: Date;
  }) {
    const [service] = await this.database
      .update(marketplaceServices)
      .set({
        endpoint: input.endpoint,
        availability: "unknown",
        verificationLevel: "DECLARED",
        lastVerifiedAt: null,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(marketplaceServices.id, input.serviceId),
          eq(marketplaceServices.agentId, input.agentId),
        ),
      )
      .returning({ endpoint: marketplaceServices.endpoint });
    if (service?.endpoint === null || service === undefined)
      throw new Error("Service endpoint could not be updated");
    return { endpoint: service.endpoint };
  }

  async transitionSubmission(input: {
    submissionId: string;
    from: SubmissionStatus;
    to: SubmissionStatus;
    evidence: Record<string, unknown>;
    agentId?: string;
    candidateId?: string;
  }) {
    assertSubmissionTransition(input.from, input.to);
    await this.database.transaction(async (transaction) => {
      const changed = await transaction
        .update(agentSubmissions)
        .set({
          status: input.to,
          agentId: input.agentId,
          candidateId: input.candidateId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentSubmissions.id, input.submissionId),
            eq(agentSubmissions.status, input.from),
          ),
        )
        .returning({ id: agentSubmissions.id });
      if (changed.length !== 1)
        throw new Error("Submission state changed concurrently");
      // Ownership can be proven before the background catalog worker has
      // resolved Relic's internal agent ID. Bind the authorization as soon as
      // that ID becomes durable so the seller can use the controls they just
      // unlocked, without requiring a second ownership proof.
      if (input.agentId !== undefined)
        await transaction
          .update(sellerAgentAuthorizations)
          .set({ agentId: input.agentId })
          .where(
            and(
              eq(sellerAgentAuthorizations.submissionId, input.submissionId),
              isNull(sellerAgentAuthorizations.revokedAt),
            ),
          );
      await transaction.insert(submissionTransitions).values({
        submissionId: input.submissionId,
        fromStatus: input.from,
        toStatus: input.to,
        evidence: input.evidence,
      });
    });
  }

  async transitionActivationLifecycle(input: {
    activationId: string;
    from: ActivationLifecycleState;
    to: ActivationLifecycleState;
    evidence: Record<string, unknown>;
    transactionHash?: string;
    blockNumber?: bigint;
  }) {
    assertActivationLifecycleTransition(input.from, input.to);
    await this.database.transaction(async (transaction) => {
      const changed = await transaction
        .update(activations)
        .set({ lifecycleState: input.to, updatedAt: new Date() })
        .where(
          and(
            eq(activations.id, input.activationId),
            eq(activations.lifecycleState, input.from),
          ),
        )
        .returning({ id: activations.id });
      if (changed.length !== 1)
        throw new Error("Activation state changed concurrently");
      await transaction.insert(activationLifecycleTransitions).values({
        activationId: input.activationId,
        fromState: input.from,
        toState: input.to,
        evidence: input.evidence,
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber,
      });
    });
  }

  async recordOutcome(input: {
    activationId: string;
    agentId: string;
    serviceId: string;
    invocationSuccessful: boolean;
    commerceSuccessful: boolean;
    executionDurationMs?: number;
    responseStatus?: string;
    deliveredAt?: Date;
    settlementState: string;
    observedCost: string;
    protocolEvidence: Record<string, unknown>;
  }) {
    const [row] = await this.database
      .insert(marketplaceOutcomes)
      .values(input)
      .onConflictDoUpdate({
        target: marketplaceOutcomes.activationId,
        set: {
          invocationSuccessful: input.invocationSuccessful,
          commerceSuccessful: input.commerceSuccessful,
          executionDurationMs: input.executionDurationMs,
          responseStatus: input.responseStatus,
          deliveredAt: input.deliveredAt,
          settlementState: input.settlementState,
          observedCost: input.observedCost,
          protocolEvidence: input.protocolEvidence,
          updatedAt: new Date(),
        },
      })
      .returning({ id: marketplaceOutcomes.id });
    if (row === undefined)
      throw new Error("Failed to persist marketplace outcome");
    return row.id;
  }

  async metricsBySupplyType() {
    return this.database.execute(sql`
      select
        s.supply_type::text supply_type,
        count(distinct s.id)::int submitted_agents,
        count(distinct s.id) filter (where s.ownership_verified_at is not null)::int ownership_verified,
        count(distinct ms.id)::int services_discovered,
        count(distinct ms.id) filter (where ms.verification_level in ('INVOCATION_VERIFIED', 'COMMERCE_VERIFIED'))::int services_verified,
        count(distinct lc.id) filter (where lc.status = 'ACTIONABLE')::int actionable_sellers,
        count(distinct a.id)::int activations_attempted,
        count(distinct a.id) filter (where a.lifecycle_state = 'COMPLETED')::int activations_completed,
        count(distinct a.id) filter (where a.lifecycle_state = 'FAILED')::int commerce_failures,
        count(distinct o.id) filter (where o.settlement_state = 'FAILED')::int settlement_failures
      from agent_submissions s
      left join agents ag on ag.id = s.agent_id
      left join launch_candidates lc on lc.agent_id = ag.id and lc.supply_type = s.supply_type
      left join marketplace_services ms on ms.agent_id = ag.id
      left join activations a on a.service_id = ms.id
      left join marketplace_outcomes o on o.activation_id = a.id
      group by s.supply_type order by s.supply_type
    `);
  }
}
