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

export interface HealthGuardReader {
  observation(mandate: HealthGuardMandate): Promise<HealthObservation>;
  allowance(owner: HealthGuardMandate["rescueWallet"]): Promise<bigint>;
  history(jobId: string): Promise<RepayHistory>;
  record(input: { jobId: string; idempotencyKey: string; amountBaseUnits: bigint; approvalTxHash?: `0x${string}`; repayTxHash?: `0x${string}`; at: Date }): Promise<void>;
  confirm(hash: `0x${string}`, operation: "approval" | "repay"): Promise<{ confirmed: boolean; detail?: string }>;
}

export type HealthGuardResult = Readonly<{ state: "NO_ACTION" | "REPAID" | "RECOVERY_REQUIRED"; reason: string; amountBaseUnits?: bigint; approvalTxHash?: `0x${string}`; repayTxHash?: `0x${string}` }>;

/** Executes one idempotent observation/repay cycle for one funded buyer job. */
export async function executeHealthGuardCycle(input: {
  config: HealthGuardConfig;
  job: FundedHealthGuardJob;
  reader: HealthGuardReader;
  signer: BoundedSessionSigner;
  now?: Date;
}): Promise<HealthGuardResult> {
  const now = input.now ?? new Date();
  const [observation, history] = await Promise.all([input.reader.observation(input.job.mandate), input.reader.history(input.job.mandate.jobId)]);
  const decision = decideRepayment({ config: input.config, mandate: input.job.mandate, observation, history, now });
  if (decision.kind === "wait") return { state: "NO_ACTION", reason: decision.reason };
  const adapter = new VenusHealthTransactionAdapter(input.config);
  let approvalTxHash: `0x${string}` | undefined;
  if (await input.reader.allowance(input.job.mandate.rescueWallet) < decision.amountBaseUnits) {
    approvalTxHash = await sendHealthGuardTransaction({ config: input.config, mandate: input.job.mandate, signer: input.signer, transaction: adapter.approveExact(decision.amountBaseUnits, input.job.maximumFeeWei) });
    const receipt = await input.reader.confirm(approvalTxHash, "approval");
    if (!receipt.confirmed) return { state: "RECOVERY_REQUIRED", reason: receipt.detail ?? "approval was not confirmed", approvalTxHash };
  }
  const repayTxHash = await sendHealthGuardTransaction({ config: input.config, mandate: input.job.mandate, signer: input.signer, transaction: adapter.repayBorrowBehalf(input.job.mandate.borrower, decision.amountBaseUnits, input.job.maximumFeeWei) });
  const receipt = await input.reader.confirm(repayTxHash, "repay");
  if (!receipt.confirmed) return { state: "RECOVERY_REQUIRED", reason: receipt.detail ?? "repayment was not confirmed", amountBaseUnits: decision.amountBaseUnits, approvalTxHash, repayTxHash };
  await input.reader.record({ jobId: input.job.mandate.jobId, idempotencyKey: input.job.idempotencyKey, amountBaseUnits: decision.amountBaseUnits, approvalTxHash, repayTxHash, at: now });
  return { state: "REPAID", reason: decision.reason, amountBaseUnits: decision.amountBaseUnits, approvalTxHash, repayTxHash };
}
