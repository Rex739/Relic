import type {
  DrizzleCommerceStore,
  PreparedSetupOperation,
} from "@relic/database";
import type { CommerceOperationState } from "@relic/domain";
import type { PublicClient } from "viem";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseEventLogs,
} from "viem";

type OperationRow = Record<string, unknown>;

const field = <T>(row: OperationRow, camel: string, snake: string) =>
  (row[camel] ?? row[snake]) as T | undefined;

const backoff = (retryCount: number, now: Date) =>
  new Date(now.getTime() + Math.min(30 * 60_000, 2 ** retryCount * 5_000));

const jobCreatedAbi = [
  {
    type: "event",
    name: "JobCreated",
    inputs: [
      { indexed: true, name: "jobId", type: "uint256" },
      { indexed: true, name: "client", type: "address" },
      { indexed: true, name: "provider", type: "address" },
      { indexed: false, name: "evaluator", type: "address" },
      { indexed: false, name: "expiredAt", type: "uint256" },
      { indexed: false, name: "hook", type: "address" },
    ],
  },
] as const;

const registerJobAbi = [
  {
    type: "function",
    name: "registerJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "policy", type: "address" },
    ],
    outputs: [],
  },
] as const;

const setupJobAbi = [
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "expectedBudget", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const setupHeadroom = {
  APPROVE_TOKEN: 13 * 60,
  CREATE_JOB: 12 * 60,
  REGISTER_JOB: 8 * 60,
  SET_BUDGET: 4 * 60,
  FUND: 2 * 60,
} as const;

const nextSetupOperation = (input: {
  operation: OperationRow;
  externalJobId: string | undefined;
  policyAddress: string | undefined;
  now: Date;
}): PreparedSetupOperation | undefined => {
  const currentType = field<string>(
    input.operation,
    "operationType",
    "operation_type",
  );
  if (currentType === "FUND") return undefined;
  if (currentType === "APPROVE_TOKEN") {
    const activationId = field<string>(
      input.operation,
      "activationId",
      "activation_id",
    );
    const evidence = field<Record<string, unknown>>(
      input.operation,
      "evidence",
      "evidence",
    );
    const next = evidence?.nextOperation as Record<string, unknown> | undefined;
    if (
      activationId === undefined ||
      next === undefined ||
      next.operationType !== "CREATE_JOB" ||
      typeof next.contract !== "string" ||
      typeof next.calldata !== "string" ||
      typeof next.preparedPayloadHash !== "string" ||
      typeof next.negotiatedAt !== "number" ||
      typeof next.quoteExpiresAt !== "number" ||
      next.functionArguments === null ||
      typeof next.functionArguments !== "object"
    )
      throw new Error(
        "Token approval is missing its bound CREATE_JOB operation",
      );
    const remaining =
      next.quoteExpiresAt - Math.floor(input.now.getTime() / 1_000);
    const safe = remaining >= setupHeadroom.CREATE_JOB;
    return {
      operationType: "CREATE_JOB",
      idempotencyKey: `activation:${activationId}:create-job`,
      state: safe ? "AWAITING_SIGNATURE" : "CANCELLED",
      preparedPayloadHash: next.preparedPayloadHash,
      ...(safe
        ? {}
        : {
            failure: {
              code: "SIGNED_QUOTE_WINDOW_UNSAFE",
              quoteExpiresAt: next.quoteExpiresAt,
              remainingSeconds: remaining,
              requiredSeconds: setupHeadroom.CREATE_JOB,
            },
          }),
      evidence: {
        ...next,
        commerceValidation: true,
        transactionPrepared: true,
        transactionSubmitted: false,
        quoteMinimumRemainingSeconds: setupHeadroom.CREATE_JOB,
      },
    };
  }
  const nextType =
    currentType === "CREATE_JOB"
      ? "REGISTER_JOB"
      : currentType === "REGISTER_JOB"
        ? "SET_BUDGET"
        : currentType === "SET_BUDGET"
          ? "FUND"
          : undefined;
  if (nextType === undefined) return undefined;
  const activationId = field<string>(
    input.operation,
    "activationId",
    "activation_id",
  );
  const evidence = field<Record<string, unknown>>(
    input.operation,
    "evidence",
    "evidence",
  );
  const currentArguments = evidence?.functionArguments as
    Record<string, unknown> | undefined;
  const jobId =
    input.externalJobId ??
    (typeof currentArguments?.jobId === "string"
      ? currentArguments.jobId
      : undefined);
  const quoteExpiresAt = evidence?.quoteExpiresAt;
  const negotiatedAt = evidence?.negotiatedAt;
  const commerceAddress =
    currentType === "CREATE_JOB"
      ? evidence?.contract
      : (evidence?.commerceAddress ?? evidence?.contract);
  const routerAddress =
    currentType === "CREATE_JOB"
      ? currentArguments?.evaluator
      : evidence?.routerAddress;
  const amountBaseUnits =
    typeof evidence?.amountBaseUnits === "string"
      ? evidence.amountBaseUnits
      : "0";
  if (
    activationId === undefined ||
    jobId === undefined ||
    typeof quoteExpiresAt !== "number" ||
    typeof negotiatedAt !== "number" ||
    typeof commerceAddress !== "string" ||
    typeof routerAddress !== "string" ||
    input.policyAddress === undefined
  )
    throw new Error("Commerce setup session evidence is incomplete");
  const policy = getAddress(input.policyAddress);
  const commerce = getAddress(commerceAddress);
  const router = getAddress(routerAddress);
  const id = BigInt(jobId);
  const data =
    nextType === "REGISTER_JOB"
      ? encodeFunctionData({
          abi: registerJobAbi,
          functionName: "registerJob",
          args: [id, policy],
        })
      : nextType === "SET_BUDGET"
        ? encodeFunctionData({
            abi: setupJobAbi,
            functionName: "setBudget",
            args: [id, BigInt(amountBaseUnits), "0x"],
          })
        : encodeFunctionData({
            abi: setupJobAbi,
            functionName: "fund",
            args: [id, BigInt(amountBaseUnits), "0x"],
          });
  const remaining = quoteExpiresAt - Math.floor(input.now.getTime() / 1_000);
  const safe = remaining >= setupHeadroom[nextType];
  const failure = safe
    ? undefined
    : {
        code: "SIGNED_QUOTE_WINDOW_UNSAFE",
        quoteExpiresAt,
        remainingSeconds: remaining,
        requiredSeconds: setupHeadroom[nextType],
      };
  return {
    operationType: nextType,
    idempotencyKey: `activation:${activationId}:${nextType.toLowerCase().replaceAll("_", "-")}:${jobId}`,
    state: safe ? "AWAITING_SIGNATURE" : "CANCELLED",
    preparedPayloadHash: keccak256(data),
    ...(failure === undefined ? {} : { failure }),
    evidence: {
      setupSession: true,
      transactionPrepared: true,
      transactionSubmitted: false,
      contract: nextType === "REGISTER_JOB" ? router : commerce,
      commerceAddress: commerce,
      routerAddress: router,
      policyAddress: policy,
      negotiatedAt,
      quoteExpiresAt,
      quoteMinimumRemainingSeconds: setupHeadroom[nextType],
      amountBaseUnits,
      paymentTokenAddress: evidence?.paymentTokenAddress,
      calldata: data,
      preparedPayloadHash: keccak256(data),
      functionArguments:
        nextType === "REGISTER_JOB"
          ? { jobId, policy }
          : nextType === "SET_BUDGET"
            ? { jobId, amount: amountBaseUnits, optParams: "0x" }
            : { jobId, expectedBudget: amountBaseUnits, optParams: "0x" },
      ...(failure === undefined ? {} : { setupSessionFailure: failure }),
    },
  };
};

const createJobProjection = (
  operation: OperationRow,
  receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>,
) => {
  const evidence = field<Record<string, unknown>>(
    operation,
    "evidence",
    "evidence",
  );
  const expected = evidence?.functionArguments as
    Record<string, unknown> | undefined;
  const contract = evidence?.contract;
  const signerAddress = field<string>(
    operation,
    "signerAddress",
    "signer_address",
  );
  if (
    typeof contract !== "string" ||
    typeof signerAddress !== "string" ||
    expected === undefined ||
    typeof expected.provider !== "string" ||
    typeof expected.evaluator !== "string" ||
    typeof expected.hook !== "string" ||
    typeof expected.expiredAt !== "string"
  )
    throw new Error("Finalized CREATE_JOB evidence is incomplete");
  const events = parseEventLogs({
    abi: jobCreatedAbi,
    eventName: "JobCreated",
    logs: receipt.logs,
    strict: false,
  }).filter(
    (event) =>
      getAddress(event.address) === getAddress(contract) &&
      event.eventName === "JobCreated",
  );
  if (events.length !== 1)
    throw new Error("CREATE_JOB receipt must contain exactly one JobCreated");
  const event = events[0]!;
  const { jobId, client, provider, evaluator, expiredAt, hook } = event.args;
  if (
    jobId === undefined ||
    client === undefined ||
    provider === undefined ||
    evaluator === undefined ||
    expiredAt === undefined ||
    hook === undefined ||
    getAddress(client) !== getAddress(signerAddress) ||
    getAddress(provider) !== getAddress(expected.provider) ||
    getAddress(evaluator) !== getAddress(expected.evaluator) ||
    getAddress(hook) !== getAddress(expected.hook) ||
    expiredAt.toString() !== expected.expiredAt
  )
    throw new Error("JobCreated event does not match prepared CREATE_JOB");
  return {
    externalJobId: jobId.toString(),
    evidence: {
      receiptStatus: receipt.status,
      jobCreated: {
        jobId: jobId.toString(),
        client,
        provider,
        evaluator,
        expiredAt: expiredAt.toString(),
        hook,
        logIndex: event.logIndex,
      },
    },
  };
};

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
  operationId?: string;
  now?: Date;
  policyAddress?: string;
}): Promise<CommerceOperationWorkerResult> {
  const now = input.now ?? new Date();
  const maxRetries = input.maxRetries ?? 8;
  const operations = await input.store.leaseOperations({
    workerId: input.workerId,
    limit: input.limit ?? 25,
    leaseSeconds: 60,
    ...(input.operationId === undefined
      ? {}
      : { operationId: input.operationId }),
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
        recordedBlockHash != null &&
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
      const operationType = field<string>(
        operation,
        "operationType",
        "operation_type",
      );
      if (finalized && operationType === "CREATE_JOB") {
        const projection = createJobProjection(operation, receipt);
        const nextOperation = nextSetupOperation({
          operation,
          externalJobId: projection.externalJobId,
          policyAddress: input.policyAddress,
          now,
        });
        await input.store.finalizeCreateJobOperation({
          id,
          workerId: input.workerId,
          from: [state],
          transactionHash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          confirmationCount: confirmations,
          externalJobId: projection.externalJobId,
          evidence: projection.evidence,
          ...(nextOperation === undefined ? {} : { nextOperation }),
        });
        result.finalized++;
        continue;
      }
      if (
        finalized &&
        ["APPROVE_TOKEN", "REGISTER_JOB", "SET_BUDGET", "FUND"].includes(
          String(operationType),
        )
      ) {
        const nextOperation = nextSetupOperation({
          operation,
          policyAddress: input.policyAddress,
          externalJobId: undefined,
          now,
        });
        await input.store.finalizeSetupOperation({
          id,
          workerId: input.workerId,
          from: [state],
          transactionHash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          confirmationCount: confirmations,
          evidence: { receiptStatus: receipt.status },
          ...(nextOperation === undefined ? {} : { nextOperation }),
        });
        result.finalized++;
        continue;
      }
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
        failure: null,
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
