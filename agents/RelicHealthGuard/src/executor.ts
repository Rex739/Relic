import type { HealthGuardConfig } from "./config.js";
import { decideRepayment, type HealthGuardMandate, type HealthObservation, type RepayHistory } from "./policy.js";
import { sendHealthGuardTransaction, type BoundedSessionSigner } from "./signer.js";
import { VenusHealthTransactionAdapter } from "./transaction.js";

export type FundedHealthGuardJob = Readonly<{
  id: string;
  idempotencyKey: string;
  mandate: HealthGuardMandate;
  maximumFeeWei: bigint;
}>;

/** A scheduler supplies a new idempotency key for every observation cycle. */
export type HealthGuardCycleIdentity = Readonly<{ id: string; idempotencyKey: string }>;

export interface HealthGuardReader {
  observation(mandate: HealthGuardMandate): Promise<HealthObservation>;
  allowance(owner: HealthGuardMandate["rescueWallet"]): Promise<bigint>;
  confirm(hash: `0x${string}`, operation: "approval" | "repay"): Promise<{ confirmed: boolean; detail?: string }>;
}

export type HealthGuardCycleStore = Readonly<{
  createOrFind(input: HealthGuardCycleIdentity & {
    commerceJobId: string;
    observation: HealthObservation;
  }): Promise<{ created: boolean; state: string }>;
  history(commerceJobId: string): Promise<RepayHistory>;
  transition(input: HealthGuardCycleIdentity & {
    to: "NO_ACTION" | "POLICY_ACCEPTED" | "APPROVAL_SUBMITTED" | "APPROVED" | "REPAY_SUBMITTED" | "COMPLETED" | "RECOVERY_REQUIRED";
    expectedRevision: number;
    decisionReason?: string;
    repayAmountBaseUnits?: bigint;
    transactionHash?: `0x${string}`;
    recoveryReason?: string;
  }): Promise<{ state: string; revision: number } | null>;
}>;

export type HealthGuardResult = Readonly<{ state: "NO_ACTION" | "REPAID" | "RECOVERY_REQUIRED"; reason: string; amountBaseUnits?: bigint; approvalTxHash?: `0x${string}`; repayTxHash?: `0x${string}` }>;

/** Executes one idempotent observation/repay cycle for one funded buyer job. */
export async function executeHealthGuardCycle(input: {
  config: HealthGuardConfig;
  job: FundedHealthGuardJob;
  reader: HealthGuardReader;
  cycles: HealthGuardCycleStore;
  cycle: HealthGuardCycleIdentity;
  signer: BoundedSessionSigner;
  now?: Date;
}): Promise<HealthGuardResult> {
  const now = input.now ?? new Date();
  const observation = await input.reader.observation(input.job.mandate);
  const created = await input.cycles.createOrFind({
    ...input.cycle,
    commerceJobId: input.job.mandate.jobId,
    observation,
  });
  // A retry of the same scheduler delivery may never issue a second transfer.
  if (!created.created) {
    if (created.state === "NO_ACTION") return { state: "NO_ACTION", reason: "cycle_already_recorded" };
    if (created.state === "COMPLETED") return { state: "REPAID", reason: "cycle_already_completed" };
    return { state: "RECOVERY_REQUIRED", reason: "cycle_requires_reconciliation" };
  }
  let revision = 0;
  const transition = async (inputState: Omit<Parameters<HealthGuardCycleStore["transition"]>[0], "expectedRevision">) => {
    const cycle = await input.cycles.transition({ ...inputState, expectedRevision: revision });
    if (cycle === null) throw new Error("Health Guard cycle persistence conflict");
    revision = cycle.revision;
    return cycle;
  };
  const history = await input.cycles.history(input.job.mandate.jobId);
  const decision = decideRepayment({ config: input.config, mandate: input.job.mandate, observation, history, now });
  if (decision.kind === "wait") {
    await transition({ ...input.cycle, to: "NO_ACTION", decisionReason: decision.reason });
    return { state: "NO_ACTION", reason: decision.reason };
  }
  await transition({
    ...input.cycle,
    to: "POLICY_ACCEPTED",
    decisionReason: decision.reason,
    repayAmountBaseUnits: decision.amountBaseUnits,
  });
  const adapter = new VenusHealthTransactionAdapter(input.config);
  let approvalTxHash: `0x${string}` | undefined;
  if (await input.reader.allowance(input.job.mandate.rescueWallet) < decision.amountBaseUnits) {
    approvalTxHash = await sendHealthGuardTransaction({ config: input.config, mandate: input.job.mandate, signer: input.signer, transaction: adapter.approveExact(decision.amountBaseUnits, input.job.maximumFeeWei) });
    await transition({ ...input.cycle, to: "APPROVAL_SUBMITTED", transactionHash: approvalTxHash });
    const receipt = await input.reader.confirm(approvalTxHash, "approval");
    if (!receipt.confirmed) {
      await transition({ ...input.cycle, to: "RECOVERY_REQUIRED", recoveryReason: receipt.detail ?? "approval was not confirmed" });
      return { state: "RECOVERY_REQUIRED", reason: receipt.detail ?? "approval was not confirmed", approvalTxHash };
    }
    await transition({ ...input.cycle, to: "APPROVED" });
  }
  const repayTxHash = await sendHealthGuardTransaction({ config: input.config, mandate: input.job.mandate, signer: input.signer, transaction: adapter.repayBorrowBehalf(input.job.mandate.borrower, decision.amountBaseUnits, input.job.maximumFeeWei) });
  await transition({ ...input.cycle, to: "REPAY_SUBMITTED", transactionHash: repayTxHash });
  const receipt = await input.reader.confirm(repayTxHash, "repay");
  if (!receipt.confirmed) {
    await transition({ ...input.cycle, to: "RECOVERY_REQUIRED", recoveryReason: receipt.detail ?? "repayment was not confirmed" });
    return { state: "RECOVERY_REQUIRED", reason: receipt.detail ?? "repayment was not confirmed", amountBaseUnits: decision.amountBaseUnits, approvalTxHash, repayTxHash };
  }
  await transition({ ...input.cycle, to: "COMPLETED" });
  return { state: "REPAID", reason: decision.reason, amountBaseUnits: decision.amountBaseUnits, approvalTxHash, repayTxHash };
}
