import type { DrizzleAgentExecutionJobStore, PersistedAgentExecutionJob } from "@relic/database";

export type GridExecutionState = "FUNDED" | "POLICY_ACCEPTED" | "APPROVAL_SUBMITTED" | "APPROVED" | "SUPPLY_SUBMITTED" | "COMPLETED" | "REJECTED" | "RECOVERY_REQUIRED";
const serialise = (job: PersistedAgentExecutionJob) => ({
  id: job.id, commerceJobId: job.commerceJobId, idempotencyKey: job.idempotencyKey,
  state: job.status, revision: job.revision, approvalTxHash: job.approvalTxHash,
  swapTxHash: job.supplyTxHash, recoveryReason: job.recoveryReason,
  createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
});

/** Durable private-executor lock. The API fixes agent identity, so callers
 * cannot use this store to inspect or mutate another service's work. */
export class GridTraderExecutionStore {
  constructor(private readonly store: DrizzleAgentExecutionJobStore, private readonly agentId: string) {}
  async createOrFind(input: { id: string; commerceJobId: string; idempotencyKey: string }) {
    const result = await this.store.createOrFind({ ...input, agentId: this.agentId });
    return { created: result.created, job: serialise(result.job) };
  }
  async transition(input: { id: string; expectedRevision: number; to: GridExecutionState; transactionHash?: string; recoveryReason?: string }) {
    const submitted = input.to === "APPROVAL_SUBMITTED" || input.to === "SUPPLY_SUBMITTED";
    if (submitted && input.transactionHash === undefined) throw new Error("Submitted Grid Trader transitions require a transaction hash");
    if (input.to === "RECOVERY_REQUIRED" && !input.recoveryReason?.trim()) throw new Error("Grid Trader recovery requires a reason");
    const job = await this.store.transition({
      id: input.id, agentId: this.agentId, expectedRevision: input.expectedRevision, status: input.to,
      ...(input.to === "APPROVAL_SUBMITTED" ? { approvalTxHash: input.transactionHash! } : {}),
      ...(input.to === "SUPPLY_SUBMITTED" ? { supplyTxHash: input.transactionHash! } : {}),
      ...(input.to === "RECOVERY_REQUIRED" ? { recoveryReason: input.recoveryReason! } : {}),
    });
    return { job: job ? serialise(job) : null };
  }
  async get(id: string) { const job = await this.store.get({ id, agentId: this.agentId }); return { job: job ? serialise(job) : null }; }
}
