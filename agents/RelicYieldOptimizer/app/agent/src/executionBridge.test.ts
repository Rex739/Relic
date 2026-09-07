import test from "node:test";
import assert from "node:assert/strict";
import { executeSupplyWithdrawal, type VenusExecutionReader } from "./executionBridge.js";
import { InMemoryYieldJobStore } from "./jobState.js";
import type { VenusTestnetConfig } from "./networkConfig.js";
import type { YieldMandate } from "./executionPolicy.js";
import type { SessionTransactionSigner } from "./signerBoundary.js";

const account = "0x1111111111111111111111111111111111111111" as const;
const config: VenusTestnetConfig = { chainId: 97, rpcUrl: "https://rpc.example", usdt: "0x2222222222222222222222222222222222222222", venusComptroller: "0x3333333333333333333333333333333333333333", venusUsdtVToken: "0x4444444444444444444444444444444444444444", usdtDecimals: 6, maxJobAmountBaseUnits: 10n, minimumBnbGasReserveWei: 1n };
const mandate: YieldMandate = { jobId: "8183-1", account, expiresAt: new Date("2026-09-08T00:00:00.000Z"), maximumAmountBaseUnits: 10n, minimumSecondsBetweenExecutions: 0 };
let sequence = 0;
const signer: SessionTransactionSigner = { getAddress: async () => account, getChainId: async () => 97, getNativeBalance: async () => 100n, simulate: async () => ({ ok: true }), send: async () => `0x${String(++sequence).padStart(64, "0")}` as `0x${string}` };

test("persists every confirmed step and completes only after withdrawal", async () => {
  const store = new InMemoryYieldJobStore();
  const snapshots = [{ usdt: 100n, vToken: 0n }, { usdt: 95n, vToken: 5n }, { usdt: 100n, vToken: 0n }];
  const reader: VenusExecutionReader = {
    allowance: async () => 0n,
    snapshot: async () => snapshots.shift() ?? { usdt: 100n, vToken: 0n },
    confirm: async () => ({ confirmed: true }),
  };
  const job = await executeSupplyWithdrawal({ id: "job", idempotencyKey: "job:1", commerceJobId: "8183-1", config, mandate, amountBaseUnits: 5n, maximumFeeWei: 1n, signer, reader, store, now: new Date("2026-09-07T15:00:00.000Z") });
  assert.equal(job.state, "COMPLETED");
  assert.ok(job.approvalTxHash && job.supplyTxHash && job.withdrawTxHash);
});

test("moves an unconfirmed receipt to recovery rather than retrying", async () => {
  const store = new InMemoryYieldJobStore();
  const reader: VenusExecutionReader = {
    allowance: async () => 5n,
    snapshot: async () => ({ usdt: 100n, vToken: 0n }),
    confirm: async () => ({ confirmed: false, detail: "RPC timeout" }),
  };
  const job = await executeSupplyWithdrawal({ id: "job", idempotencyKey: "job:2", commerceJobId: "8183-2", config, mandate, amountBaseUnits: 5n, maximumFeeWei: 1n, signer, reader, store, now: new Date("2026-09-07T15:00:00.000Z") });
  assert.equal(job.state, "RECOVERY_REQUIRED");
  assert.equal(job.recoveryReason, "RPC timeout");
});

test("moves a confirmed but unreconciled supply into recovery", async () => {
  const store = new InMemoryYieldJobStore();
  const snapshots = [{ usdt: 100n, vToken: 0n }, { usdt: 95n, vToken: 0n }];
  const reader: VenusExecutionReader = {
    allowance: async () => 5n,
    snapshot: async () => snapshots.shift() ?? { usdt: 100n, vToken: 0n },
    confirm: async () => ({ confirmed: true }),
  };
  const job = await executeSupplyWithdrawal({ id: "job", idempotencyKey: "job:3", commerceJobId: "8183-3", config, mandate, amountBaseUnits: 5n, maximumFeeWei: 1n, signer, reader, store, now: new Date("2026-09-07T15:00:00.000Z") });
  assert.equal(job.state, "RECOVERY_REQUIRED");
  assert.match(job.recoveryReason ?? "", /expected USDT and vToken/);
});
