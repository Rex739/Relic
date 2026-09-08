import assert from "node:assert/strict";
import test from "node:test";
import { configuredHealthGuardPool, loadHealthGuardConfig } from "./config.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}`;
const pool = (id: string, offset: number) => ({
  id, name: `${id} pool`, protocol: "Venus", network: "BNB Chain", debtAsset: "USDT",
  debtAssetAddress: address(String(offset + 1)), debtVTokenAddress: address(String(offset + 2)),
  comptrollerAddress: address(String(offset + 3)), debtAssetDecimals: 18,
});
const environment = (pools: unknown): NodeJS.ProcessEnv => ({
  CHAIN_ID: "56", BSC_MAINNET_RPC_URL: "https://rpc.example", HEALTH_GUARD_POOLS_JSON: JSON.stringify(pools),
  MAX_REPAY_BASE_UNITS: "100", MINIMUM_BNB_GAS_RESERVE_WEI: "1",
});

test("loads multiple configured pools and resolves only a selected pool", () => {
  const config = loadHealthGuardConfig(environment([pool("venus-core-usdt", 0), pool("venus-isolated-usdt", 10)]));
  assert.equal(config.pools.size, 2);
  assert.equal(configuredHealthGuardPool(config, "venus-isolated-usdt").name, "venus-isolated-usdt pool");
  assert.throws(() => configuredHealthGuardPool(config, "not-configured"), /not configured/);
});

test("rejects duplicate pool identifiers before the runtime can start", () => {
  assert.throws(() => loadHealthGuardConfig(environment([pool("venus-core-usdt", 0), pool("venus-core-usdt", 10)])), /duplicate id/);
});
