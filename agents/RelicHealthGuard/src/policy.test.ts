import test from "node:test";
import assert from "node:assert/strict";
import { BSC_MAINNET_CHAIN_ID, type HealthGuardConfig } from "./config.js";
import { decideRepayment, WAD, type HealthGuardMandate } from "./policy.js";

const config: HealthGuardConfig = {
  chainId: BSC_MAINNET_CHAIN_ID, rpcUrl: "https://rpc.example", usdt: "0x0000000000000000000000000000000000000001",
  venusUsdtVToken: "0x0000000000000000000000000000000000000002", venusComptroller: "0x0000000000000000000000000000000000000003",
  usdtDecimals: 18, maxRepayBaseUnits: 100n, minimumBnbGasReserveWei: 1n, executionEnabled: true,
};
const now = new Date("2026-09-08T00:00:00.000Z");
const mandate: HealthGuardMandate = {
  jobId: "42", poolId: "venus-core-pool", borrower: "0x0000000000000000000000000000000000000004", rescueWallet: "0x0000000000000000000000000000000000000005",
  triggerHealthFactorWad: 120n * WAD / 100n, targetHealthFactorWad: 150n * WAD / 100n,
  maximumRepayBaseUnits: 40n, aggregateRepayLimitBaseUnits: 100n, minimumSecondsBetweenRepays: 300,
  expiresAt: new Date("2026-09-09T00:00:00.000Z"),
};

test("repays only the smallest real, authorized limit", () => {
  const result = decideRepayment({ config, mandate, now, history: { aggregateRepaidBaseUnits: 70n }, observation: {
    healthFactorWad: WAD, outstandingDebtBaseUnits: 80n, rescueWalletUsdtBaseUnits: 50n, observedAt: now,
  } });
  assert.deepEqual(result, { kind: "repay", amountBaseUnits: 30n, reason: "health_factor_below_trigger" });
});

test("never invents a repayment when the factor is healthy or evidence is stale", () => {
  const healthy = decideRepayment({ config, mandate, now, history: { aggregateRepaidBaseUnits: 0n }, observation: {
    healthFactorWad: 2n * WAD, outstandingDebtBaseUnits: 80n, rescueWalletUsdtBaseUnits: 80n, observedAt: now,
  } });
  assert.equal(healthy.kind, "wait");
  const stale = decideRepayment({ config, mandate, now, history: { aggregateRepaidBaseUnits: 0n }, observation: {
    healthFactorWad: WAD, outstandingDebtBaseUnits: 80n, rescueWalletUsdtBaseUnits: 80n, observedAt: new Date(now.getTime() - 121_000),
  } });
  assert.deepEqual(stale, { kind: "wait", reason: "stale_observation" });
});
