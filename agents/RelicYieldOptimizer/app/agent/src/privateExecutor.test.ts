import test from "node:test";
import assert from "node:assert/strict";
import { YieldPrivateExecutor } from "./privateExecutor.js";
import type { VenusTestnetConfig } from "./networkConfig.js";
import type { VenusReadClient } from "./deploymentVerifier.js";

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
