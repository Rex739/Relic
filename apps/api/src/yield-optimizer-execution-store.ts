import type { DrizzleAgentExecutionJobStore, PersistedAgentExecutionJob } from "@relic/database";

export type YieldExecutionState =
  | "FUNDED" | "POLICY_ACCEPTED" | "APPROVAL_SUBMITTED" | "APPROVED"
  | "SUPPLY_SUBMITTED" | "SUPPLIED" | "WITHDRAW_SUBMITTED" | "COMPLETED"
  | "REJECTED" | "RECOVERY_REQUIRED";

const serialise = (job: PersistedAgentExecutionJob) => ({
  id: job.id,
  commerceJobId: job.commerceJobId,
  idempotencyKey: job.idempotencyKey,
  state: job.status,
  revision: job.revision,
  approvalTxHash: job.approvalTxHash,
  supplyTxHash: job.supplyTxHash,
  withdrawTxHash: job.withdrawTxHash,
  recoveryReason: job.recoveryReason,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
});

/** Server-side facade: the caller never selects the agent ID or database row. */
export class YieldOptimizerExecutionStore {
  public constructor(
    private readonly store: DrizzleAgentExecutionJobStore,
    private readonly agentId: string,
  ) {}

  async createOrFind(input: { id: string; commerceJobId: string; idempotencyKey: string }) {
    const result = await this.store.createOrFind({ ...input, agentId: this.agentId });
    return { created: result.created, job: serialise(result.job) };
  }

  async transition(input: {
    id: string;
    expectedRevision: number;
    to: YieldExecutionState;
    transactionHash?: string;
    recoveryReason?: string;
  }) {
    const submitted = ["APPROVAL_SUBMITTED", "SUPPLY_SUBMITTED", "WITHDRAW_SUBMITTED"].includes(input.to);
    if (submitted && input.transactionHash === undefined) throw new Error("Submitted Yield Optimizer transitions require a transaction hash");
    if (input.to === "RECOVERY_REQUIRED" && input.recoveryReason === undefined) throw new Error("Yield Optimizer recovery requires a reason");
    const transition = {
      id: input.id,
      agentId: this.agentId,
      expectedRevision: input.expectedRevision,
      status: input.to,
    } as {
      id: string; agentId: string; expectedRevision: number; status: YieldExecutionState;
      approvalTxHash?: string; supplyTxHash?: string; withdrawTxHash?: string; recoveryReason?: string;
    };
    if (input.to === "APPROVAL_SUBMITTED") transition.approvalTxHash = input.transactionHash!;
    if (input.to === "SUPPLY_SUBMITTED") transition.supplyTxHash = input.transactionHash!;
    if (input.to === "WITHDRAW_SUBMITTED") transition.withdrawTxHash = input.transactionHash!;
    if (input.to === "RECOVERY_REQUIRED") transition.recoveryReason = input.recoveryReason!;
    const job = await this.store.transition(transition);
    return { job: job ? serialise(job) : null };
  }

  async get(id: string) {
    const job = await this.store.get({ id, agentId: this.agentId });
    return { job: job ? serialise(job) : null };
  }
}
