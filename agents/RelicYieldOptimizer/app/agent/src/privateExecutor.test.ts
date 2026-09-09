import test from "node:test";
import assert from "node:assert/strict";
import { YieldPrivateExecutor } from "./privateExecutor.js";
import type { VenusTestnetConfig } from "./networkConfig.js";
import type { VenusReadClient } from "./deploymentVerifier.js";
import { InMemoryYieldJobStore } from "./jobState.js";
import type { SessionTransactionSigner } from "./signerBoundary.js";

const usdt = "0x1111111111111111111111111111111111111111" as const;
const market = "0x2222222222222222222222222222222222222222" as const;
const comptroller = "0x3333333333333333333333333333333333333333" as const;
const config: VenusTestnetConfig = { chainId: 97, rpcUrl: "https://rpc.example", usdt, venusComptroller: comptroller, venusUsdtVToken: market, usdtDecimals: 6, maxJobAmountBaseUnits: 1n, minimumBnbGasReserveWei: 1n };
const client: VenusReadClient = {
  getChainId: async () => 97,
  getCode: async () => "0x6000",
  getTokenMetadata: async () => ({ symbol: "USDT", decimals: 6 }),
  getTokenBalance: async () => 0n,
  getVTokenUnderlying: async () => usdt,
  getVTokenComptroller: async () => comptroller,
};

test("is ready only after its Venus deployment checks succeed", async () => {
  const executor = new YieldPrivateExecutor(config, client);
  assert.deepEqual(await executor.readiness(), { ready: true });
  assert.equal((await executor.handleA2a({})).status, 503);
});

test("executes only a canonical funded-job relay when all runtime dependencies exist", async () => {
  const signer: SessionTransactionSigner = {
    getAddress: async () => "0x4444444444444444444444444444444444444444",
    getChainId: async () => 97,
    getNativeBalance: async () => 10n,
    simulate: async () => ({ ok: true }),
    send: async () => `0x${"1".repeat(64)}`,
  };
  const snapshots = [{ usdt: 10n, vToken: 0n }, { usdt: 9n, vToken: 1n }, { usdt: 10n, vToken: 0n }];
  const executor = new YieldPrivateExecutor(config, client, {
    signer,
    store: new InMemoryYieldJobStore(),
    reader: {
      allowance: async () => 1n,
      snapshot: async () => snapshots.shift() ?? { usdt: 10n, vToken: 0n },
      confirm: async () => ({ confirmed: true }),
    },
  });
  const result = await executor.handleA2a({
    kind: "relic.funded_yield_job.v1",
    id: "cf4a4e95-01ec-4e2d-afcf-7e6e4f7d5a6f",
    commerceJobId: "8183",
    idempotencyKey: "yield:8183:1",
    mandate: {
      jobId: "8183", account: "0x4444444444444444444444444444444444444444",
      expiresAt: "2027-09-08T00:00:00.000Z", maximumAmountBaseUnits: "1",
      minimumSecondsBetweenExecutions: "0",
    },
    amountBaseUnits: "1", maximumFeeWei: "1",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    id: "cf4a4e95-01ec-4e2d-afcf-7e6e4f7d5a6f",
    commerceJobId: "8183",
    state: "COMPLETED",
    approvalTxHash: null,
    supplyTxHash: `0x${"1".repeat(64)}`,
    withdrawTxHash: `0x${"1".repeat(64)}`,
    recoveryReason: null,
  });
});
