import { and, eq, sql } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import { agentExecutionJobs, agentExecutionJobStatus } from "./schema.js";

export type AgentExecutionJobStatus = (typeof agentExecutionJobStatus.enumValues)[number];

export type PersistedAgentExecutionJob = Readonly<{
  id: string;
  agentId: string;
  commerceJobId: string;
  idempotencyKey: string;
  status: AgentExecutionJobStatus;
  revision: number;
  approvalTxHash: string | null;
  supplyTxHash: string | null;
  withdrawTxHash: string | null;
  recoveryReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

const record = (row: typeof agentExecutionJobs.$inferSelect): PersistedAgentExecutionJob => ({
  id: row.id,
  agentId: row.agentId,
  commerceJobId: row.commerceJobId,
  idempotencyKey: row.idempotencyKey,
  status: row.status,
  revision: row.revision,
  approvalTxHash: row.approvalTxHash,
  supplyTxHash: row.supplyTxHash,
  withdrawTxHash: row.withdrawTxHash,
  recoveryReason: row.recoveryReason,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Durable counterpart to the executor's YieldJobStore contract.
 *
 * `transition` is compare-and-swap on revision, so two replicas cannot both
 * advance or replace the receipt for the same operation.
 */
export class DrizzleAgentExecutionJobStore {
  public constructor(private readonly database: RelicDatabase) {}

  async createOrFind(input: {
    id: string;
    agentId: string;
    commerceJobId: string;
    idempotencyKey: string;
  }): Promise<{ created: boolean; job: PersistedAgentExecutionJob }> {
    const inserted = await this.database
      .insert(agentExecutionJobs)
      .values(input)
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return { created: true, job: record(inserted[0]) };
    const existing = await this.database
      .select()
      .from(agentExecutionJobs)
      .where(
        and(
          eq(agentExecutionJobs.agentId, input.agentId),
          eq(agentExecutionJobs.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing[0]) throw new Error("Agent execution idempotency lookup failed");
    return { created: false, job: record(existing[0]) };
  }

  async transition(input: {
    id: string;
    agentId: string;
    expectedRevision: number;
    status: AgentExecutionJobStatus;
    approvalTxHash?: string | null;
    supplyTxHash?: string | null;
    withdrawTxHash?: string | null;
    recoveryReason?: string | null;
  }): Promise<PersistedAgentExecutionJob | null> {
    const [updated] = await this.database
      .update(agentExecutionJobs)
      .set({
        status: input.status,
        revision: sql`${agentExecutionJobs.revision} + 1`,
        approvalTxHash: input.approvalTxHash,
        supplyTxHash: input.supplyTxHash,
        withdrawTxHash: input.withdrawTxHash,
        recoveryReason: input.recoveryReason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentExecutionJobs.id, input.id),
          eq(agentExecutionJobs.agentId, input.agentId),
          eq(agentExecutionJobs.revision, input.expectedRevision),
        ),
      )
      .returning();
    return updated ? record(updated) : null;
  }

  async get(input: { id: string; agentId: string }): Promise<PersistedAgentExecutionJob | null> {
    const [row] = await this.database
      .select()
      .from(agentExecutionJobs)
      .where(and(eq(agentExecutionJobs.id, input.id), eq(agentExecutionJobs.agentId, input.agentId)))
      .limit(1);
    return row ? record(row) : null;
  }
}
