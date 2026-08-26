/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  parseAbiParameters,
} from "viem";

import { reconcileCommerceOperations } from "../src/commerce-operation-worker.js";

const operation = (overrides: Record<string, unknown> = {}) => ({
  id: "4dc96f82-2ec0-4b2c-9320-ce9949b48c7c",
  state: "SUBMITTED",
  transaction_hash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  retry_count: 0,
  ...overrides,
});

const storeFor = (rows: Record<string, unknown>[]) => {
  const transitions: Array<Record<string, unknown>> = [];
  const finalizations: Array<Record<string, unknown>> = [];
  const setupFinalizations: Array<Record<string, unknown>> = [];
  return {
    transitions,
    finalizations,
    setupFinalizations,
    store: {
      leaseOperations: async () => rows,
      transitionOperation: async (input: Record<string, unknown>) => {
        transitions.push(input);
        return input;
      },
      finalizeCreateJobOperation: async (input: Record<string, unknown>) => {
        finalizations.push(input);
        return input;
      },
      finalizeSetupOperation: async (input: Record<string, unknown>) => {
        setupFinalizations.push(input);
        return input;
      },
    },
  };
};

describe("commerce operation reconciliation", () => {
  it("never submits READY work and leaves it awaiting a user signature", async () => {
    const fake = storeFor([
      operation({ state: "READY", transaction_hash: null }),
    ]);
    const result = await reconcileCommerceOperations({
      store: fake.store as never,
      client: {} as never,
      workerId: "worker-a",
      confirmationDepth: 15,
      policyAddress: "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
      now: new Date("2026-08-25T04:15:00.000Z"),
    });
    expect(result.awaitingSignature).toBe(1);
    expect(fake.transitions[0]).toMatchObject({
      from: ["READY"],
      to: "AWAITING_SIGNATURE",
    });
  });

  it("finalizes a successful receipt only after confirmation depth", async () => {
    const fake = storeFor([operation({ block_hash: null })]);
    const result = await reconcileCommerceOperations({
      store: fake.store as never,
      client: {
        getTransactionReceipt: async () => ({
          blockNumber: 100n,
          blockHash: `0x${"ab".repeat(32)}`,
          status: "success",
        }),
        getBlockNumber: async () => 114n,
      } as never,
      workerId: "worker-a",
      confirmationDepth: 15,
    });
    expect(result.finalized).toBe(1);
    expect(fake.transitions[0]).toMatchObject({
      to: "FINALIZED",
      confirmationCount: 15,
      finalityState: "FINALIZED",
    });
  });

  it("validates JobCreated and atomically projects CREATE_JOB finality", async () => {
    const commerce = "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE";
    const client = "0x2289c7c6713A1F0c91f495c15258b47B22e3f9A3";
    const provider = "0x323F064B777745703Fa8eB56109A763503AeE4Dd";
    const router = "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25";
    const abi = parseAbi([
      "event JobCreated(uint256 indexed jobId,address indexed client,address indexed provider,address evaluator,uint256 expiredAt,address hook)",
    ]);
    const fake = storeFor([
      operation({
        operation_type: "CREATE_JOB",
        activation_id: "45e5394a-43aa-47ee-acc9-e86637245bff",
        signer_address: client,
        evidence: {
          contract: commerce,
          negotiatedAt: 1_787_631_300,
          quoteExpiresAt: 1_787_632_200,
          functionArguments: {
            provider,
            evaluator: router,
            expiredAt: "1787699791",
            hook: router,
          },
        },
      }),
    ]);
    const result = await reconcileCommerceOperations({
      store: fake.store as never,
      client: {
        getTransactionReceipt: async () => ({
          blockNumber: 100n,
          blockHash: `0x${"ab".repeat(32)}`,
          status: "success",
          logs: [
            {
              address: commerce,
              topics: encodeEventTopics({
                abi,
                eventName: "JobCreated",
                args: { jobId: 618n, client, provider },
              }),
              data: encodeAbiParameters(
                parseAbiParameters(
                  "address evaluator,uint256 expiredAt,address hook",
                ),
                [router, 1787699791n, router],
              ),
              logIndex: 0,
            },
          ],
        }),
        getBlockNumber: async () => 114n,
      } as never,
      workerId: "worker-a",
      confirmationDepth: 15,
      policyAddress: "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
      now: new Date(1_787_631_300_000),
    });
    expect(result.finalized).toBe(1);
    expect(fake.transitions).toHaveLength(0);
    expect(fake.finalizations[0]).toMatchObject({
      externalJobId: "618",
      confirmationCount: 15,
      evidence: {
        receiptStatus: "success",
        jobCreated: { jobId: "618", client, provider },
      },
      nextOperation: {
        operationType: "REGISTER_JOB",
        state: "AWAITING_SIGNATURE",
      },
    });
  });

  it.each([
    ["REGISTER_JOB", "SET_BUDGET"],
    ["SET_BUDGET", "FUND"],
    ["FUND", undefined],
  ] as const)(
    "finalizes %s and durably prepares only the expected next manual step",
    async (operationType, expectedNext) => {
      const fake = storeFor([
        operation({
          operation_type: operationType,
          activation_id: "45e5394a-43aa-47ee-acc9-e86637245bff",
          evidence: {
            contract: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
            commerceAddress: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
            routerAddress: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
            negotiatedAt: 1_787_631_300,
            quoteExpiresAt: 1_787_632_200,
            functionArguments: { jobId: "621" },
          },
        }),
      ]);
      const result = await reconcileCommerceOperations({
        store: fake.store as never,
        client: {
          getTransactionReceipt: async () => ({
            blockNumber: 100n,
            blockHash: `0x${"ab".repeat(32)}`,
            status: "success",
          }),
          getBlockNumber: async () => 114n,
        } as never,
        workerId: "worker-a",
        confirmationDepth: 15,
        policyAddress: "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
        now: new Date(1_787_631_300_000),
      });
      expect(result.finalized).toBe(1);
      expect(fake.setupFinalizations).toHaveLength(1);
      if (expectedNext === undefined) {
        expect(fake.setupFinalizations[0]).not.toHaveProperty("nextOperation");
      } else {
        expect(fake.setupFinalizations[0]?.nextOperation).toMatchObject({
          operationType: expectedNext,
          state: "AWAITING_SIGNATURE",
        });
      }
    },
  );

  it("fails closed by cancelling the next step when quote headroom is unsafe", async () => {
    const fake = storeFor([
      operation({
        operation_type: "SET_BUDGET",
        activation_id: "45e5394a-43aa-47ee-acc9-e86637245bff",
        evidence: {
          contract: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
          commerceAddress: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
          routerAddress: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
          negotiatedAt: 1_787_631_300,
          quoteExpiresAt: 1_787_631_350,
          functionArguments: { jobId: "621" },
        },
      }),
    ]);
    await reconcileCommerceOperations({
      store: fake.store as never,
      client: {
        getTransactionReceipt: async () => ({
          blockNumber: 100n,
          blockHash: `0x${"ab".repeat(32)}`,
          status: "success",
        }),
        getBlockNumber: async () => 114n,
      } as never,
      workerId: "worker-a",
      confirmationDepth: 15,
      policyAddress: "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
      now: new Date(1_787_631_300_000),
    });
    expect(fake.setupFinalizations[0]?.nextOperation).toMatchObject({
      operationType: "FUND",
      state: "CANCELLED",
      failure: { code: "SIGNED_QUOTE_WINDOW_UNSAFE" },
    });
  });

  it("marks changed block evidence as reorged", async () => {
    const fake = storeFor([operation({ block_hash: `0x${"cd".repeat(32)}` })]);
    const result = await reconcileCommerceOperations({
      store: fake.store as never,
      client: {
        getTransactionReceipt: async () => ({
          blockNumber: 100n,
          blockHash: `0x${"ab".repeat(32)}`,
          status: "success",
        }),
      } as never,
      workerId: "worker-a",
      confirmationDepth: 15,
    });
    expect(result.reorged).toBe(1);
    expect(fake.transitions[0]).toMatchObject({
      to: "REORGED",
      finalityState: "REORGED",
      incrementRetry: true,
    });
  });

  it("uses bounded retries for unavailable receipts", async () => {
    const fake = storeFor([operation({ retry_count: 7 })]);
    const result = await reconcileCommerceOperations({
      store: fake.store as never,
      client: {
        getTransactionReceipt: async () => {
          throw new Error("not found");
        },
      } as never,
      workerId: "worker-a",
      confirmationDepth: 15,
      maxRetries: 8,
    });
    expect(result.failed).toBe(1);
    expect(fake.transitions[0]).toMatchObject({
      to: "FAILED",
      failure: { code: "receipt_retry_exhausted" },
    });
  });
});
