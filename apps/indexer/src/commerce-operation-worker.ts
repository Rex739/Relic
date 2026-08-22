import type { DrizzleCommerceStore } from "@relic/database";
import type { CommerceOperationState } from "@relic/domain";
import type { PublicClient } from "viem";

type OperationRow = Record<string, unknown>;

const field = <T>(row: OperationRow, camel: string, snake: string) =>
  (row[camel] ?? row[snake]) as T | undefined;

const backoff = (retryCount: number, now: Date) =>
  new Date(now.getTime() + Math.min(30 * 60_000, 2 ** retryCount * 5_000));

export interface CommerceOperationWorkerResult {
  leased: number;
  awaitingSignature: number;
  pending: number;
  confirmed: number;
  finalized: number;
  reorged: number;
  failed: number;
}

/**
 * Reconciles durable commerce operations without ever signing or submitting a
 * transaction. READY work is explicitly parked at AWAITING_SIGNATURE; a
 * separate user-wallet or genuinely delegated signer boundary must submit it.
 */
export async function reconcileCommerceOperations(input: {
  store: DrizzleCommerceStore;
  client: Pick<PublicClient, "getBlockNumber" | "getTransactionReceipt">;
  workerId: string;
  confirmationDepth: number;
  limit?: number;
  maxRetries?: number;
  now?: Date;
}): Promise<CommerceOperationWorkerResult> {
  const now = input.now ?? new Date();
  const maxRetries = input.maxRetries ?? 8;
  const operations = await input.store.leaseOperations({
    workerId: input.workerId,
    limit: input.limit ?? 25,
    leaseSeconds: 60,
    now,
  });
  const result: CommerceOperationWorkerResult = {
    leased: operations.length,
    awaitingSignature: 0,
    pending: 0,
    confirmed: 0,
    finalized: 0,
    reorged: 0,
    failed: 0,
  };

  for (const operation of operations) {
    const id = field<string>(operation, "id", "id")!;
    const state = field<CommerceOperationState>(operation, "state", "state")!;
    const transactionHash = field<string>(
      operation,
      "transactionHash",
      "transaction_hash",
    );
    const recordedBlockHash = field<string>(
      operation,
      "blockHash",
      "block_hash",
    );
    const retryCount = Number(
      field<number>(operation, "retryCount", "retry_count") ?? 0,
    );

    if (state === "READY") {
      await input.store.transitionOperation({
        id,
        workerId: input.workerId,
        from: ["READY"],
        to: "AWAITING_SIGNATURE",
        evidence: {
          reason: "No autonomous buyer signing authority is configured",
          workerSubmittedTransaction: false,
        },
        nextAttemptAt: null,
      });
      result.awaitingSignature++;
      continue;
    }

    if (
      transactionHash === undefined ||
      !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)
    ) {
      await input.store.transitionOperation({
        id,
        workerId: input.workerId,
        from: [state],
        to: "FAILED",
        failure: { code: "missing_transaction_hash" },
        nextAttemptAt: null,
      });
      result.failed++;
      continue;
    }

    try {
      const receipt = await input.client.getTransactionReceipt({
        hash: transactionHash as `0x${string}`,
      });
      if (
        recordedBlockHash !== undefined &&
        recordedBlockHash.toLowerCase() !== receipt.blockHash.toLowerCase()
      ) {
        await input.store.transitionOperation({
          id,
          workerId: input.workerId,
          from: [state],
          to: "REORGED",
          transactionHash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          confirmationCount: 0,
          finalityState: "REORGED",
          evidence: { previousBlockHash: recordedBlockHash },
          nextAttemptAt: backoff(retryCount + 1, now),
          incrementRetry: true,
        });
        result.reorged++;
        continue;
      }
      if (receipt.status !== "success") {
        await input.store.transitionOperation({
          id,
          workerId: input.workerId,
          from: [state],
          to: "FAILED",
          transactionHash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          failure: { code: "transaction_reverted" },
          nextAttemptAt: null,
        });
        result.failed++;
        continue;
      }
      const head = await input.client.getBlockNumber();
      const confirmations = Number(head - receipt.blockNumber + 1n);
      const finalized = confirmations >= input.confirmationDepth;
      await input.store.transitionOperation({
        id,
        workerId: input.workerId,
        from: [state],
        to: finalized ? "FINALIZED" : "CONFIRMED",
        transactionHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        confirmationCount: confirmations,
        finalityState: finalized ? "FINALIZED" : "CONFIRMED",
        evidence: { receiptStatus: receipt.status },
        nextAttemptAt: finalized ? null : new Date(now.getTime() + 15_000),
      });
      if (finalized) result.finalized++;
      else result.confirmed++;
    } catch (error) {
      const exhausted = retryCount + 1 >= maxRetries;
      await input.store.transitionOperation({
        id,
        workerId: input.workerId,
        from: [state],
        to: exhausted ? "FAILED" : "PENDING",
        transactionHash,
        failure: {
          code: exhausted ? "receipt_retry_exhausted" : "receipt_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
        nextAttemptAt: exhausted ? null : backoff(retryCount + 1, now),
        incrementRetry: true,
      });
      if (exhausted) result.failed++;
      else result.pending++;
    }
  }
  return result;
}
