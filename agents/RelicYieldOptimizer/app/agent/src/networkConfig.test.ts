import test from "node:test";
import assert from "node:assert/strict";
import { loadVenusConfig } from "./networkConfig.js";

const mainnetEnv = {
  RELIC_YIELD_NETWORK: "bsc-mainnet",
  RELIC_YIELD_MAINNET_ENABLED: "true",
  CHAIN_ID: "56",
  BSC_MAINNET_RPC_URL: "https://rpc.example",
  VENUS_MAINNET_USDT: "0x1111111111111111111111111111111111111111",
  VENUS_MAINNET_COMPTROLLER: "0x2222222222222222222222222222222222222222",
  VENUS_MAINNET_USDT_VTOKEN: "0x3333333333333333333333333333333333333333",
  VENUS_MAINNET_USDT_DECIMALS: "18",
  MAX_JOB_AMOUNT_BASE_UNITS: "1000000",
  MINIMUM_BNB_GAS_RESERVE_WEI: "1000000000000000",
};

test("loads BSC Mainnet only after an explicit mainnet opt-in", () => {
  const config = loadVenusConfig(mainnetEnv);
  assert.equal(config.chainId, 56);
  assert.equal(config.network, "bsc-mainnet");
  assert.equal(config.usdtDecimals, 18);
});

test("fails closed when a mainnet deployment lacks explicit opt-in", () => {
  const { RELIC_YIELD_MAINNET_ENABLED: _unused, ...withoutOptIn } = mainnetEnv;
  assert.throws(() => loadVenusConfig(withoutOptIn), /Mainnet is disabled/);
});

test("does not use testnet variables for a mainnet deployment", () => {
  const { BSC_MAINNET_RPC_URL: _unused, ...withoutMainnetRpc } = mainnetEnv;
  assert.throws(() => loadVenusConfig(withoutMainnetRpc), /BSC_MAINNET_RPC_URL/);
});
