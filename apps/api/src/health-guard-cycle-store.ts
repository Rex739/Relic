import type { DrizzleHealthGuardCycleStore, PersistedHealthGuardCycle } from "@relic/database";

export type HealthGuardCycleState =
  | "OBSERVED" | "NO_ACTION" | "POLICY_ACCEPTED" | "APPROVAL_SUBMITTED"
  | "APPROVED" | "REPAY_SUBMITTED" | "COMPLETED" | "RECOVERY_REQUIRED";

const transitions: Readonly<Record<HealthGuardCycleState, readonly HealthGuardCycleState[]>> = {
  OBSERVED: ["NO_ACTION", "POLICY_ACCEPTED", "RECOVERY_REQUIRED"],
  NO_ACTION: [],
  POLICY_ACCEPTED: ["APPROVAL_SUBMITTED", "APPROVED", "RECOVERY_REQUIRED"],
  APPROVAL_SUBMITTED: ["APPROVED", "RECOVERY_REQUIRED"],
  APPROVED: ["REPAY_SUBMITTED", "RECOVERY_REQUIRED"],
  REPAY_SUBMITTED: ["COMPLETED", "RECOVERY_REQUIRED"],
  COMPLETED: [],
  RECOVERY_REQUIRED: [],
};

const serialise = (cycle: PersistedHealthGuardCycle) => ({
  id: cycle.id,
  commerceJobId: cycle.commerceJobId,
  idempotencyKey: cycle.idempotencyKey,
  state: cycle.status,
  revision: cycle.revision,
  observedAt: cycle.observedAt.toISOString(),
  healthFactorWad: cycle.healthFactorWad.toString(),
  outstandingDebtBaseUnits: cycle.outstandingDebtBaseUnits.toString(),
  rescueWalletBalanceBaseUnits: cycle.rescueWalletBalanceBaseUnits.toString(),
  decisionReason: cycle.decisionReason,
  repayAmountBaseUnits: cycle.repayAmountBaseUnits?.toString() ?? null,
  approvalTxHash: cycle.approvalTxHash,
  repaymentTxHash: cycle.repaymentTxHash,
  recoveryReason: cycle.recoveryReason,
  createdAt: cycle.createdAt.toISOString(),
  updatedAt: cycle.updatedAt.toISOString(),
});

/**
 * Internal-only boundary for the Health Guard private worker. It owns the
 * agent ID, validates state edges, and makes submitted repayments count toward
 * the buyer's aggregate limit before any later retry can issue another one.
 */
export class HealthGuardCycleStore {
  public constructor(
    private readonly store: DrizzleHealthGuardCycleStore,
    private readonly agentId: string,
  ) {}

  async createOrFind(input: {
    id: string;
    commerceJobId: string;
    idempotencyKey: string;
    observedAt: Date;
    healthFactorWad: bigint;
    outstandingDebtBaseUnits: bigint;
    rescueWalletBalanceBaseUnits: bigint;
  }) {
    const result = await this.store.createOrFind({ ...input, agentId: this.agentId });
    return { created: result.created, cycle: serialise(result.cycle) };
  }

  async transition(input: {
    id: string;
    expectedRevision: number;
    to: HealthGuardCycleState;
    decisionReason?: string;
    repayAmountBaseUnits?: bigint;
    transactionHash?: string;
    recoveryReason?: string;
  }) {
    const current = await this.store.get({ id: input.id, agentId: this.agentId });
    if (current === null) return { cycle: null };
    if (current.revision !== input.expectedRevision)
      throw new Error("Health Guard cycle revision conflict");
    if (!transitions[current.status].includes(input.to))
      throw new Error(`Invalid Health Guard transition ${current.status} -> ${input.to}`);
    if (input.to === "POLICY_ACCEPTED" && input.repayAmountBaseUnits === undefined)
      throw new Error("Health Guard policy acceptance requires a bounded repayment amount");
    if (input.to === "APPROVAL_SUBMITTED" || input.to === "REPAY_SUBMITTED") {
      if (input.transactionHash === undefined)
        throw new Error("Submitted Health Guard transitions require a transaction hash");
    }
    if (input.to === "RECOVERY_REQUIRED" && input.recoveryReason === undefined)
      throw new Error("Health Guard recovery requires a reason");
    const cycle = await this.store.transition({
      id: input.id,
      agentId: this.agentId,
      expectedRevision: input.expectedRevision,
      status: input.to,
      ...(input.decisionReason === undefined ? {} : { decisionReason: input.decisionReason }),
      ...(input.repayAmountBaseUnits === undefined ? {} : { repayAmountBaseUnits: input.repayAmountBaseUnits }),
      ...(input.to === "APPROVAL_SUBMITTED" ? { approvalTxHash: input.transactionHash! } : {}),
      ...(input.to === "REPAY_SUBMITTED" ? { repaymentTxHash: input.transactionHash! } : {}),
      ...(input.to === "RECOVERY_REQUIRED" ? { recoveryReason: input.recoveryReason! } : {}),
    });
    return { cycle: cycle ? serialise(cycle) : null };
  }

  async get(id: string) {
    const cycle = await this.store.get({ id, agentId: this.agentId });
    return { cycle: cycle ? serialise(cycle) : null };
  }

  async history(commerceJobId: string) {
    const history = await this.store.history({ agentId: this.agentId, commerceJobId });
    return {
      aggregateRepaidBaseUnits: history.aggregateRepaidBaseUnits.toString(),
      lastRepayAt: history.lastRepayAt?.toISOString() ?? null,
    };
  }
}
