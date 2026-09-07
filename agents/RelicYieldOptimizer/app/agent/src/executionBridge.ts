import type { YieldIntent, YieldMandate } from "./executionPolicy.js";
import type { YieldJob, YieldJobStore } from "./jobState.js";
import type { VenusTestnetConfig } from "./networkConfig.js";
import { sendBoundedYieldTransaction, type SessionTransactionSigner } from "./signerBoundary.js";
import { VenusTransactionAdapter } from "./venusTransactionAdapter.js";

export interface VenusExecutionReader {
  allowance(owner: YieldMandate["account"]): Promise<bigint>;
  confirm(transactionHash: `0x${string}`, operation: "approval" | "supply" | "withdraw"): Promise<{ confirmed: boolean; detail?: string }>;
}

const next = async (store: YieldJobStore, input: Parameters<YieldJobStore["transition"]>[0]): Promise<YieldJob> => {
  const job = await store.transition(input);
  if (!job) throw new Error("Yield execution lost its durable job lock");
  return job;
};

/**
 * Deterministic V1 proof flow. Every broadcast is preceded by the signing
 * boundary and followed by a receipt check before another state may advance.
 */
export async function executeSupplyWithdrawal(input: {
  id: string;
  idempotencyKey: string;
  commerceJobId: string;
  config: VenusTestnetConfig;
  mandate: YieldMandate;
  amountBaseUnits: bigint;
  maximumFeeWei: bigint;
  signer: SessionTransactionSigner;
  reader: VenusExecutionReader;
  store: YieldJobStore;
  now?: Date;
}): Promise<YieldJob> {
  const now = input.now ?? new Date();
  const created = await input.store.createOrFind({ id: input.id, commerceJobId: input.commerceJobId, idempotencyKey: input.idempotencyKey, now });
  if (!created.created) return created.job;
  const adapter = new VenusTransactionAdapter(input.config);
  let job = await next(input.store, { id: input.id, expectedRevision: 0, to: "POLICY_ACCEPTED", now });
  const intent = (operation: YieldIntent["operation"]): YieldIntent => ({
    operation, chainId: input.config.chainId, account: input.mandate.account,
    target: operation === "approve" ? input.config.usdt : input.config.venusUsdtVToken,
    asset: input.config.usdt,
    spender: operation === "approve" ? input.config.venusUsdtVToken : undefined,
    amountBaseUnits: input.amountBaseUnits, deadline: input.mandate.expiresAt,
  });
  if (await input.reader.allowance(input.mandate.account) < input.amountBaseUnits) {
    const approvalHash = await sendBoundedYieldTransaction({ config: input.config, mandate: input.mandate, intent: intent("approve"), transaction: adapter.approveExact(input.amountBaseUnits, input.maximumFeeWei), signer: input.signer, now });
    job = await next(input.store, { id: job.id, expectedRevision: job.revision, to: "APPROVAL_SUBMITTED", transactionHash: approvalHash, now });
    const receipt = await input.reader.confirm(approvalHash, "approval");
    if (!receipt.confirmed) return next(input.store, { id: job.id, expectedRevision: job.revision, to: "RECOVERY_REQUIRED", recoveryReason: receipt.detail ?? "approval receipt was not confirmed", now });
    job = await next(input.store, { id: job.id, expectedRevision: job.revision, to: "APPROVED", now });
  } else {
    job = await next(input.store, { id: job.id, expectedRevision: job.revision, to: "APPROVED", now });
  }
  const supplyHash = await sendBoundedYieldTransaction({ config: input.config, mandate: input.mandate, intent: intent("supply"), transaction: adapter.supply(input.amountBaseUnits, input.maximumFeeWei), signer: input.signer, now });
  job = await next(input.store, { id: job.id, expectedRevision: job.revision, to: "SUPPLY_SUBMITTED", transactionHash: supplyHash, now });
  const supplyReceipt = await input.reader.confirm(supplyHash, "supply");
  if (!supplyReceipt.confirmed) return next(input.store, { id: job.id, expectedRevision: job.revision, to: "RECOVERY_REQUIRED", recoveryReason: supplyReceipt.detail ?? "supply receipt was not confirmed", now });
  job = await next(input.store, { id: job.id, expectedRevision: job.revision, to: "SUPPLIED", now });
  const withdrawHash = await sendBoundedYieldTransaction({ config: input.config, mandate: input.mandate, intent: intent("withdraw"), transaction: adapter.withdraw(input.amountBaseUnits, input.maximumFeeWei), signer: input.signer, now });
  job = await next(input.store, { id: job.id, expectedRevision: job.revision, to: "WITHDRAW_SUBMITTED", transactionHash: withdrawHash, now });
  const withdrawalReceipt = await input.reader.confirm(withdrawHash, "withdraw");
  return withdrawalReceipt.confirmed
    ? next(input.store, { id: job.id, expectedRevision: job.revision, to: "COMPLETED", now })
    : next(input.store, { id: job.id, expectedRevision: job.revision, to: "RECOVERY_REQUIRED", recoveryReason: withdrawalReceipt.detail ?? "withdrawal receipt was not confirmed", now });
}
