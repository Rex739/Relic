import assert from "node:assert/strict";
import test from "node:test";
import { HealthGuardPrivateExecutor } from "./private-executor.js";
import type { HealthGuardConfig } from "./config.js";
import type { HealthGuardCycleStore } from "./executor.js";
import type { BoundedSessionSigner } from "./signer.js";

const usdt = "0x1111111111111111111111111111111111111111" as const;
const market = "0x2222222222222222222222222222222222222222" as const;
const config: HealthGuardConfig = {
  chainId: 56, rpcUrl: "https://rpc.example", usdt, venusUsdtVToken: market,
  venusComptroller: "0x3333333333333333333333333333333333333333",
  usdtDecimals: 6, maxRepayBaseUnits: 10n, minimumBnbGasReserveWei: 1n, executionEnabled: true,
};

test("runs only a canonical funded Mainnet job and records its receipt", async () => {
  let revision = 0;
  const transitions: string[] = [];
  const cycles: HealthGuardCycleStore = {
    createOrFind: async () => ({ created: true, state: "OBSERVED" }),
    history: async () => ({ aggregateRepaidBaseUnits: 0n }),
    transition: async (input) => {
      assert.equal(input.expectedRevision, revision);
      revision += 1;
      transitions.push(input.to);
      return { state: input.to, revision };
    },
  };
  const signer: BoundedSessionSigner = {
    getAddress: async () => "0x4444444444444444444444444444444444444444",
    getChainId: async () => 56,
    getNativeBalance: async () => 10n,
    simulate: async () => ({ ok: true }),
    send: async () => `0x${"1".repeat(64)}`,
  };
  const executor = new HealthGuardPrivateExecutor(
    config,
    async () => undefined,
    async () => ({
      kind: "relic.funded_health_guard_job.v1",
      id: "cf4a4e95-01ec-4e2d-afcf-7e6e4f7d5a6f",
      idempotencyKey: "health-guard:8183:1",
      maximumFeeWei: "1",
      mandate: {
        jobId: "8183", poolId: "venus-core-pool", borrower: "0x4444444444444444444444444444444444444444", rescueWallet: "0x4444444444444444444444444444444444444444",
        triggerHealthFactorWad: "2", targetHealthFactorWad: "3", maximumRepayBaseUnits: "5", aggregateRepayLimitBaseUnits: "10",
        minimumSecondsBetweenRepays: "60", expiresAt: "2027-01-01T00:00:00.000Z",
      },
    }),
    async () => ({
      signer,
      cycles,
      reader: {
        observation: async () => ({ healthFactorWad: 1n, outstandingDebtBaseUnits: 5n, rescueWalletUsdtBaseUnits: 5n, observedAt: new Date() }),
        allowance: async () => 5n,
        confirm: async () => ({ confirmed: true }),
      },
    }),
  );
  const result = await executor.runCycle({
    commerceJobId: "8183",
    cycle: { id: "cf4a4e95-01ec-4e2d-afcf-7e6e4f7d5a6f", idempotencyKey: "delivery:8183:1" },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(transitions, ["POLICY_ACCEPTED", "REPAY_SUBMITTED", "COMPLETED"]);
});
