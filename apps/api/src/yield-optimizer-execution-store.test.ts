import { describe, expect, it } from "vitest";
import { YieldOptimizerExecutionStore } from "./yield-optimizer-execution-store.js";

const row = {
  id: "cf4a4e95-01ec-4e2d-afcf-7e6e4f7d5a6f", agentId: "a", commerceJobId: "8183", idempotencyKey: "yield:8183:1",
  status: "FUNDED", revision: 0, approvalTxHash: null, supplyTxHash: null, withdrawTxHash: null,
  recoveryReason: null, createdAt: new Date("2026-09-07T00:00:00.000Z"), updatedAt: new Date("2026-09-07T00:00:00.000Z"),
} as const;

describe("YieldOptimizerExecutionStore", () => {
  it("pins persistence to the configured agent ID", async () => {
    let received: unknown;
    const store = new YieldOptimizerExecutionStore({
      createOrFind: async (input: unknown) => { received = input; return { created: true, job: row }; },
      transition: async () => null,
      get: async () => null,
    } as never, "configured-agent");
    const result = await store.createOrFind({ id: row.id, commerceJobId: "8183", idempotencyKey: "yield:8183:1" });
    expect(received).toEqual({ id: row.id, commerceJobId: "8183", idempotencyKey: "yield:8183:1", agentId: "configured-agent" });
    expect(result.job.state).toBe("FUNDED");
  });
});
