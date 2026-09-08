import test from "node:test";
import assert from "node:assert/strict";
import { BSC_MAINNET_CHAIN_ID, type HealthGuardConfig } from "./config.js";
import { verifyHealthGuardDeployment } from "./venus-reader.js";

const config: HealthGuardConfig = {
  chainId: BSC_MAINNET_CHAIN_ID, rpcUrl: "https://rpc.example",
  pools: new Map([["venus-core-pool", { id: "venus-core-pool", name: "Test", protocol: "Venus", network: "BSC", debtAsset: "USDT", usdt: "0x0000000000000000000000000000000000000001", venusUsdtVToken: "0x0000000000000000000000000000000000000002", venusComptroller: "0x0000000000000000000000000000000000000003", usdtDecimals: 18 }]]),
  maxRepayBaseUnits: 1n, minimumBnbGasReserveWei: 1n, executionEnabled: false,
};
const pool = config.pools.get("venus-core-pool")!;

test("deployment verifier rejects a vToken bound to another underlying", async () => {
  await assert.rejects(
    verifyHealthGuardDeployment(config, pool, {
      getChainId: async () => 56,
      getCode: async () => "0x01",
      readContract: async (request: { functionName: string }) => request.functionName === "underlying"
        ? "0x0000000000000000000000000000000000000004"
        : pool.venusComptroller,
    } as never),
    /does not use configured debt asset/,
  );
});
