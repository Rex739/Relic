import type {
  BudgetState,
  CanonicalExecutionAction,
  ExecutionPersistence,
  ExecutionPolicyResult,
  ExecutionReceipt,
  ExecutionRecord,
  ExecutionStatus,
  PolicyReason,
} from "@relic/domain";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  budgetReservations,
  executionApprovals,
  executionPolicyDecisions,
  executionReceipts,
  executionRequests,
  executionRuns,
  mandateEvents,
  mandates,
} from "./schema.js";

type RequestRow = typeof executionRequests.$inferSelect;
const record = (
  row: RequestRow,
  approval: typeof executionApprovals.$inferSelect | undefined,
  receipt: typeof executionReceipts.$inferSelect | undefined,
): ExecutionRecord => ({
  id: row.id,
  mandateId: row.mandateId,
  mandateVersion: row.mandateVersion,
  agentId: row.agentId,
  principalId: row.principalId,
  chainId: row.chainId as 56 | 97,
  idempotencyKey: row.idempotencyKey,
  rawRequest: row.rawRequest as Record<string, unknown>,
  action: row.normalizedAction as CanonicalExecutionAction,
  status: row.status,
  decision: row.decision,
  reasons: row.decisionReasons as PolicyReason[],
  approvalHash: approval?.normalizedHash ?? null,
  approvedAt: approval?.approvedAt.toISOString() ?? null,
  executedAt: null,
  completedAt: receipt?.observedAt.toISOString() ?? null,
  receipt:
    receipt === undefined
      ? null
      : {
          source: receipt.source as ExecutionReceipt["source"],
          outcome: receipt.outcome as Record<string, unknown>,
          evidence: receipt.evidence as Record<string, unknown>,
          cost: receipt.cost,
          transactionHash: receipt.transactionHash,
          jobId: receipt.jobId,
          observedAt: receipt.observedAt.toISOString(),
        },
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export class DrizzleExecutionStore implements ExecutionPersistence {
  public constructor(private readonly database: RelicDatabase) {}

  public async createOrFind(input: {
    id: string;
    idempotencyKey: string;
    principalId: string;
    rawRequest: Record<string, unknown>;
    action: CanonicalExecutionAction;
  }) {
    const inserted = await this.database
      .insert(executionRequests)
      .values({
        id: input.id,
        mandateId: input.action.mandateId,
        mandateVersion: input.action.mandateVersion,
        agentId: input.action.agentId,
        principalId: input.principalId,
        chainId: input.action.chainId,
        idempotencyKey: input.idempotencyKey,
        rawRequest: input.rawRequest,
        normalizedAction: input.action,
        normalizedHash: input.action.normalizedHash,
        status: "REQUESTED",
        deadline: new Date(input.action.deadline),
      })
      .onConflictDoNothing()
      .returning({ id: executionRequests.id });
    const existing =
      inserted[0]?.id ??
      (
        await this.database
          .select({ id: executionRequests.id })
          .from(executionRequests)
          .where(
            and(
              eq(executionRequests.principalId, input.principalId),
              or(
                eq(executionRequests.idempotencyKey, input.idempotencyKey),
                eq(
                  executionRequests.normalizedHash,
                  input.action.normalizedHash,
                ),
              ),
            ),
          )
          .limit(1)
      )[0]?.id;
    if (existing === undefined)
      throw new Error("Execution idempotency lookup failed");
    const found = await this.find(existing, input.principalId);
    if (found === null) throw new Error("Execution request was not readable");
    return { created: inserted.length === 1, record: found };
  }

  public async budgetState(
    mandateId: string,
    version: number,
    windowStart: Date,
  ): Promise<BudgetState> {
    const [sum] = await this.database
      .select({
        committed: sql<string>`coalesce(sum(${budgetReservations.amount}) filter (where ${budgetReservations.state} in ('COMMITTED','SUCCEEDED')), 0)`,
        succeeded: sql<string>`coalesce(sum(${budgetReservations.amount}) filter (where ${budgetReservations.state} = 'SUCCEEDED'), 0)`,
        released: sql<string>`coalesce(sum(${budgetReservations.releasedAmount}), 0)`,
        count: sql<number>`count(*) filter (where ${budgetReservations.createdAt} >= ${windowStart.toISOString()}::timestamptz)::int`,
      })
      .from(budgetReservations)
      .where(
        and(
          eq(budgetReservations.mandateId, mandateId),
          eq(budgetReservations.mandateVersion, version),
        ),
      );
    return {
      committedAmount: sum?.committed ?? "0",
      succeededAmount: sum?.succeeded ?? "0",
      releasedAmount: sum?.released ?? "0",
      periodActionCount: sum?.count ?? 0,
    };
  }

  public async recordDecision(input: {
    executionId: string;
    result: ExecutionPolicyResult;
    reserveAmount: string | null;
    aggregateLimit: string | null;
  }) {
    const principalId = await this.database.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(executionRequests)
        .where(eq(executionRequests.id, input.executionId))
        .limit(1);
      if (request === undefined) throw new Error("Execution request not found");
      await tx.execute(
        sql`select id from mandates where id = ${request.mandateId} for update`,
      );
      let result = input.result;
      if (
        result.decision !== "DENY" &&
        input.reserveAmount !== null &&
        input.aggregateLimit !== null
      ) {
        const [usage] = await tx
          .select({
            total: sql<string>`coalesce(sum(${budgetReservations.amount}), 0)`,
          })
          .from(budgetReservations)
          .where(
            and(
              eq(budgetReservations.mandateId, request.mandateId),
              eq(budgetReservations.mandateVersion, request.mandateVersion),
              inArray(budgetReservations.state, ["COMMITTED", "SUCCEEDED"]),
            ),
          );
        if (
          Number(usage?.total ?? "0") + Number(input.reserveAmount) >
          Number(input.aggregateLimit)
        )
          result = {
            ...result,
            decision: "DENY",
            reasons: [
              ...result.reasons.filter(
                (reason) => reason.code !== "policy_satisfied",
              ),
              {
                code: "aggregate_limit_race_prevented",
                message:
                  "The aggregate allowance was consumed by another request before this reservation committed.",
              },
            ],
          };
      }
      const status =
        result.decision === "DENY"
          ? result.reasons.some((reason) => reason.code === "stale_agent")
            ? "BLOCKED_STALE_AGENT"
            : "DENIED"
          : result.decision === "REQUIRE_APPROVAL"
            ? "APPROVAL_REQUIRED"
            : "APPROVED";
      await tx
        .update(executionRequests)
        .set({
          status,
          decision: result.decision,
          decisionReasons: result.reasons,
          updatedAt: new Date(),
        })
        .where(eq(executionRequests.id, input.executionId));
      await tx.insert(executionPolicyDecisions).values({
        executionRequestId: input.executionId,
        decision: result.decision,
        normalizedHash: result.normalizedHash,
        mandateVersion: result.mandateVersion,
        reasons: result.reasons,
        evidence: { signingAuthorization: false },
      });
      if (result.decision !== "DENY" && input.reserveAmount !== null)
        await tx.insert(budgetReservations).values({
          executionRequestId: input.executionId,
          mandateId: request.mandateId,
          mandateVersion: request.mandateVersion,
          asset:
            (request.normalizedAction as CanonicalExecutionAction).asset ??
            "UNKNOWN",
          amount: input.reserveAmount,
          state: "COMMITTED",
        });
      await tx.insert(mandateEvents).values([
        {
          mandateId: request.mandateId,
          eventType: "POLICY_EVALUATED",
          securitySensitive: true,
          details: {
            executionId: input.executionId,
            decision: result.decision,
            reasons: result.reasons,
          },
          evidenceReferences: { normalizedHash: result.normalizedHash },
        },
        {
          mandateId: request.mandateId,
          eventType:
            result.decision === "DENY"
              ? "EXECUTION_REJECTED"
              : result.decision === "REQUIRE_APPROVAL"
                ? "APPROVAL_REQUESTED"
                : "EXECUTION_REQUESTED",
          securitySensitive: true,
          details: { executionId: input.executionId },
          evidenceReferences: { normalizedHash: result.normalizedHash },
        },
      ]);
      return request.principalId;
    });
    const found = await this.find(input.executionId, principalId);
    if (found === null) throw new Error("Execution decision was not readable");
    return found;
  }

  public async approve(input: {
    executionId: string;
    principalId: string;
    normalizedHash: string;
    approved: boolean;
  }) {
    const changed = await this.database.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(executionRequests)
        .where(
          and(
            eq(executionRequests.id, input.executionId),
            eq(executionRequests.principalId, input.principalId),
            eq(executionRequests.normalizedHash, input.normalizedHash),
            eq(executionRequests.status, "APPROVAL_REQUIRED"),
          ),
        )
        .limit(1);
      if (request === undefined) return false;
      const [mandate] = await tx
        .select({ principalType: mandates.principalType })
        .from(mandates)
        .where(eq(mandates.id, request.mandateId))
        .limit(1);
      if (mandate?.principalType === "WALLET") return false;
      const inserted = await tx
        .insert(executionApprovals)
        .values({
          executionRequestId: input.executionId,
          principalId: input.principalId,
          normalizedHash: input.normalizedHash,
          approved: input.approved,
          authorizationKind: "DEVELOPMENT_API",
          walletAuthorization: false,
        })
        .onConflictDoNothing()
        .returning({ id: executionApprovals.id });
      if (inserted.length === 0) return false;
      await tx
        .update(executionRequests)
        .set({
          status: input.approved ? "APPROVED" : "CANCELLED",
          updatedAt: new Date(),
        })
        .where(eq(executionRequests.id, input.executionId));
      await tx.insert(mandateEvents).values({
        mandateId: request.mandateId,
        eventType: input.approved ? "EXECUTION_APPROVED" : "EXECUTION_REJECTED",
        securitySensitive: true,
        details: {
          executionId: input.executionId,
          developmentApiApproval: true,
          walletAuthorization: false,
        },
        evidenceReferences: { normalizedHash: input.normalizedHash },
      });
      return true;
    });
    return changed ? this.find(input.executionId, input.principalId) : null;
  }

  public async transition(input: {
    executionId: string;
    principalId: string;
    from: ExecutionStatus[];
    to: ExecutionStatus;
    receipt?: ExecutionReceipt;
    evidence?: Record<string, unknown>;
  }) {
    const changed = await this.database.transaction(async (tx) => {
      const rows = await tx
        .update(executionRequests)
        .set({ status: input.to, updatedAt: new Date() })
        .where(
          and(
            eq(executionRequests.id, input.executionId),
            eq(executionRequests.principalId, input.principalId),
            inArray(executionRequests.status, input.from),
          ),
        )
        .returning();
      const request = rows[0];
      if (request === undefined) return false;
      if (input.to === "EXECUTING")
        await tx.insert(executionRuns).values({
          executionRequestId: input.executionId,
          executorKind: "READ_ONLY_VERIFIED_RPC",
          status: "EXECUTING",
        });
      if (input.receipt !== undefined) {
        await tx.insert(executionReceipts).values({
          executionRequestId: input.executionId,
          source: input.receipt.source,
          outcome: input.receipt.outcome,
          evidence: input.receipt.evidence,
          cost: input.receipt.cost,
          transactionHash: input.receipt.transactionHash,
          jobId: input.receipt.jobId,
          observedAt: new Date(input.receipt.observedAt),
        });
        await tx
          .update(executionRuns)
          .set({ status: input.to, completedAt: new Date() })
          .where(eq(executionRuns.executionRequestId, input.executionId));
        await tx
          .update(budgetReservations)
          .set({
            state: input.to === "SUCCEEDED" ? "SUCCEEDED" : "RELEASED",
            ...(input.to === "FAILED"
              ? { releasedAmount: budgetReservations.amount }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(budgetReservations.executionRequestId, input.executionId));
      }
      await tx.insert(mandateEvents).values({
        mandateId: request.mandateId,
        eventType:
          input.to === "EXECUTING"
            ? "EXECUTION_STARTED"
            : input.to === "SUCCEEDED"
              ? "EXECUTION_COMPLETED"
              : "EXECUTION_FAILED",
        securitySensitive: true,
        details: { executionId: input.executionId, status: input.to },
        evidenceReferences: input.evidence ?? {},
      });
      return true;
    });
    return changed ? this.find(input.executionId, input.principalId) : null;
  }

  public async find(executionId: string, principalId: string) {
    const [row] = await this.database
      .select()
      .from(executionRequests)
      .where(
        and(
          eq(executionRequests.id, executionId),
          eq(executionRequests.principalId, principalId),
        ),
      )
      .limit(1);
    if (row === undefined) return null;
    const [approvals, receipts] = await Promise.all([
      this.database
        .select()
        .from(executionApprovals)
        .where(eq(executionApprovals.executionRequestId, executionId))
        .limit(1),
      this.database
        .select()
        .from(executionReceipts)
        .where(eq(executionReceipts.executionRequestId, executionId))
        .limit(1),
    ]);
    return record(row, approvals[0], receipts[0]);
  }

  public async list(mandateId: string, principalId: string) {
    const rows = await this.database
      .select({ id: executionRequests.id })
      .from(executionRequests)
      .where(
        and(
          eq(executionRequests.mandateId, mandateId),
          eq(executionRequests.principalId, principalId),
        ),
      )
      .orderBy(desc(executionRequests.createdAt));
    const records = await Promise.all(
      rows.map(({ id }) => this.find(id, principalId)),
    );
    return records.filter((item): item is ExecutionRecord => item !== null);
  }
}
