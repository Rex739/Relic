/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from "vitest";

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
  return {
    transitions,
    store: {
      leaseOperations: async () => rows,
      transitionOperation: async (input: Record<string, unknown>) => {
        transitions.push(input);
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
    });
    expect(result.awaitingSignature).toBe(1);
    expect(fake.transitions[0]).toMatchObject({
      from: ["READY"],
      to: "AWAITING_SIGNATURE",
    });
  });

  it("finalizes a successful receipt only after confirmation depth", async () => {
    const fake = storeFor([operation()]);
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
