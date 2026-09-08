import { and, eq, inArray, sql } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import { healthGuardCycles, healthGuardCycleStatus } from "./schema.js";

export type HealthGuardCycleStatus = (typeof healthGuardCycleStatus.enumValues)[number];

export type PersistedHealthGuardCycle = Readonly<{
  id: string;
  agentId: string;
  commerceJobId: string;
  idempotencyKey: string;
  status: HealthGuardCycleStatus;
  revision: number;
  observedAt: Date;
  healthFactorWad: bigint;
  outstandingDebtBaseUnits: bigint;
  rescueWalletBalanceBaseUnits: bigint;
  decisionReason: string | null;
  repayAmountBaseUnits: bigint | null;
  approvalTxHash: string | null;
  repaymentTxHash: string | null;
  recoveryReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

const baseUnits = (value: string | null): bigint | null => value === null ? null : BigInt(value);
const record = (row: typeof healthGuardCycles.$inferSelect): PersistedHealthGuardCycle => ({
  id: row.id,
  agentId: row.agentId,
  commerceJobId: row.commerceJobId,
  idempotencyKey: row.idempotencyKey,
  status: row.status,
  revision: row.revision,
  observedAt: row.observedAt,
  healthFactorWad: BigInt(row.healthFactorWad),
  outstandingDebtBaseUnits: BigInt(row.outstandingDebtBaseUnits),
  rescueWalletBalanceBaseUnits: BigInt(row.rescueWalletBalanceBaseUnits),
  decisionReason: row.decisionReason,
  repayAmountBaseUnits: baseUnits(row.repayAmountBaseUnits),
  approvalTxHash: row.approvalTxHash,
  repaymentTxHash: row.repaymentTxHash,
  recoveryReason: row.recoveryReason,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Durable, per-cycle ledger for recurring Health Guard observations. */
export class DrizzleHealthGuardCycleStore {
  public constructor(private readonly database: RelicDatabase) {}

  async createOrFind(input: {
    id: string;
    agentId: string;
    commerceJobId: string;
    idempotencyKey: string;
    observedAt: Date;
    healthFactorWad: bigint;
    outstandingDebtBaseUnits: bigint;
    rescueWalletBalanceBaseUnits: bigint;
  }): Promise<{ created: boolean; cycle: PersistedHealthGuardCycle }> {
    const inserted = await this.database
      .insert(healthGuardCycles)
      .values({
        ...input,
        healthFactorWad: input.healthFactorWad.toString(),
        outstandingDebtBaseUnits: input.outstandingDebtBaseUnits.toString(),
        rescueWalletBalanceBaseUnits: input.rescueWalletBalanceBaseUnits.toString(),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return { created: true, cycle: record(inserted[0]) };
    const [existing] = await this.database
      .select()
      .from(healthGuardCycles)
      .where(and(eq(healthGuardCycles.agentId, input.agentId), eq(healthGuardCycles.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (!existing) throw new Error("Health Guard cycle idempotency lookup failed");
    return { created: false, cycle: record(existing) };
  }

  async transition(input: {
    id: string;
    agentId: string;
    expectedRevision: number;
    status: HealthGuardCycleStatus;
    decisionReason?: string | null;
    repayAmountBaseUnits?: bigint | null;
    approvalTxHash?: string | null;
    repaymentTxHash?: string | null;
    recoveryReason?: string | null;
  }): Promise<PersistedHealthGuardCycle | null> {
    const [updated] = await this.database
      .update(healthGuardCycles)
      .set({
        status: input.status,
        revision: sql`${healthGuardCycles.revision} + 1`,
        ...(input.decisionReason === undefined ? {} : { decisionReason: input.decisionReason }),
        ...(input.repayAmountBaseUnits === undefined ? {} : { repayAmountBaseUnits: input.repayAmountBaseUnits?.toString() ?? null }),
        ...(input.approvalTxHash === undefined ? {} : { approvalTxHash: input.approvalTxHash }),
        ...(input.repaymentTxHash === undefined ? {} : { repaymentTxHash: input.repaymentTxHash }),
        ...(input.recoveryReason === undefined ? {} : { recoveryReason: input.recoveryReason }),
        updatedAt: new Date(),
      })
      .where(and(
        eq(healthGuardCycles.id, input.id),
        eq(healthGuardCycles.agentId, input.agentId),
        eq(healthGuardCycles.revision, input.expectedRevision),
      ))
      .returning();
    return updated ? record(updated) : null;
  }

  async get(input: { id: string; agentId: string }): Promise<PersistedHealthGuardCycle | null> {
    const [row] = await this.database
      .select()
      .from(healthGuardCycles)
      .where(and(eq(healthGuardCycles.id, input.id), eq(healthGuardCycles.agentId, input.agentId)))
      .limit(1);
    return row ? record(row) : null;
  }

  /** Submitted repayments count toward the cap until a human resolves recovery. */
  async history(input: { agentId: string; commerceJobId: string }): Promise<{
    aggregateRepaidBaseUnits: bigint;
    lastRepayAt?: Date;
  }> {
    const [summary] = await this.database
      .select({
        total: sql<string>`coalesce(sum(${healthGuardCycles.repayAmountBaseUnits}), 0)`,
        lastRepayAt: sql<Date | null>`max(${healthGuardCycles.updatedAt})`,
      })
      .from(healthGuardCycles)
      .where(and(
        eq(healthGuardCycles.agentId, input.agentId),
        eq(healthGuardCycles.commerceJobId, input.commerceJobId),
        inArray(healthGuardCycles.status, ["REPAY_SUBMITTED", "COMPLETED"]),
      ));
    return {
      aggregateRepaidBaseUnits: BigInt(summary?.total ?? "0"),
      ...(summary?.lastRepayAt === null || summary?.lastRepayAt === undefined ? {} : { lastRepayAt: summary.lastRepayAt }),
    };
  }
}
