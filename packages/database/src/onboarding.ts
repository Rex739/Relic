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
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  activationLifecycleTransitions,
  activations,
  agentIdentities,
  agentSubmissions,
  marketplaceOutcomes,
  ownershipChallenges,
  submissionTransitions,
} from "./schema.js";

const asSubmission = (
  row: typeof agentSubmissions.$inferSelect,
): AgentSubmission => ({
  id: row.id,
  chainId: row.chainId,
  externalAgentId: row.externalAgentId,
  supplyType: row.supplyType,
  status: row.status,
  submitterAddress: row.submitterAddress as `0x${string}` | null,
  ownershipVerifiedAt: row.ownershipVerifiedAt?.toISOString() ?? null,
  agentId: row.agentId,
  candidateId: row.candidateId,
  developerOverrides: row.developerOverrides as Record<string, unknown>,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
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
            eq(agentSubmissions.externalAgentId, input.externalAgentId),
          ),
        )
        .limit(1);
      if (existing !== undefined) {
        const [updated] = await transaction
          .update(agentSubmissions)
          .set({
            submitterAddress: input.submitterAddress,
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
          externalAgentId: input.externalAgentId,
          supplyType: input.supplyType,
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
    nonceHash: string;
    message: string;
    expectedOwner: `0x${string}`;
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
      message: row.message,
      expectedOwner: row.expectedOwner as `0x${string}`,
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
      message: row.message,
      expectedOwner: row.expectedOwner as `0x${string}`,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async consumeOwnershipChallenge(input: {
    challengeId: string;
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
            isNull(ownershipChallenges.consumedAt),
            gt(ownershipChallenges.expiresAt, input.verifiedAt),
            sql`lower(${ownershipChallenges.expectedOwner}) = lower(${input.signerAddress})`,
          ),
        )
        .returning({ submissionId: ownershipChallenges.submissionId });
      if (challenge === undefined) return false;
      await transaction
        .update(agentSubmissions)
        .set({
          ownershipVerifiedAt: input.verifiedAt,
          updatedAt: input.verifiedAt,
        })
        .where(eq(agentSubmissions.id, challenge.submissionId));
      return true;
    });
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
