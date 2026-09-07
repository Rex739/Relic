import test from "node:test";
import assert from "node:assert/strict";
import { verifyVenusDeployment, type VenusReadClient } from "./deploymentVerifier.js";
import type { VenusTestnetConfig } from "./networkConfig.js";

const usdt = "0x1111111111111111111111111111111111111111" as const;
const comptroller = "0x2222222222222222222222222222222222222222" as const;
const vToken = "0x3333333333333333333333333333333333333333" as const;
const config: VenusTestnetConfig = {
  chainId: 97, rpcUrl: "https://rpc.example", usdt, venusComptroller: comptroller,
  venusUsdtVToken: vToken, usdtDecimals: 18, maxJobAmountBaseUnits: 100n,
  minimumBnbGasReserveWei: 1n,
};

const client = (overrides: Partial<VenusReadClient> = {}): VenusReadClient => ({
  getChainId: async () => 97,
  getCode: async () => "0x1234",
  getTokenMetadata: async () => ({ symbol: "USDT", decimals: 18 }),
  getVTokenUnderlying: async () => usdt,
  getVTokenComptroller: async () => comptroller,
  getVTokenCash: async () => 500n,
  ...overrides,
});

test("verifies the deployed Venus market relationship", async () => {
  const verified = await verifyVenusDeployment(client(), config, new Date("2026-09-07T12:00:00.000Z"));
  assert.equal(verified.usdtSymbol, "USDT");
  assert.equal(verified.withdrawableCashBaseUnits, 500n);
});

test("fails closed if the market points at another underlying asset", async () => {
  await assert.rejects(
    verifyVenusDeployment(client({ getVTokenUnderlying: async () => comptroller }), config),
    /underlying/,
  );
});

test("fails closed if the RPC is not BSC Testnet", async () => {
  await assert.rejects(
    verifyVenusDeployment(client({ getChainId: async () => 56 }), config),
    /not BSC Testnet/,
  );
});
