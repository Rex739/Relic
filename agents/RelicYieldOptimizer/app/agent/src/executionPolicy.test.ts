import test from "node:test";
import assert from "node:assert/strict";
import { validateYieldIntent } from "./executionPolicy.js";
import type { VenusTestnetConfig } from "./networkConfig.js";

const usdt = "0x1111111111111111111111111111111111111111" as const;
const comptroller = "0x2222222222222222222222222222222222222222" as const;
const vToken = "0x3333333333333333333333333333333333333333" as const;
const buyer = "0x4444444444444444444444444444444444444444" as const;
const config: VenusTestnetConfig = {
  chainId: 97,
  rpcUrl: "https://rpc.example",
  usdt,
  venusComptroller: comptroller,
  venusUsdtVToken: vToken,
  usdtDecimals: 18,
  maxJobAmountBaseUnits: 100n,
  minimumBnbGasReserveWei: 1n,
};
const now = new Date("2026-09-07T12:00:00.000Z");
const mandate = {
  jobId: "job-1",
  account: buyer,
  expiresAt: new Date("2026-09-07T13:00:00.000Z"),
  maximumAmountBaseUnits: 100n,
  minimumSecondsBetweenExecutions: 60,
};

test("permits an exact USDT approval for the verified Venus market", () => {
  assert.doesNotThrow(() =>
    validateYieldIntent(config, mandate, {
      operation: "approve", chainId: 97, account: buyer, target: usdt,
      spender: vToken, amountBaseUnits: 10n, deadline: mandate.expiresAt,
    }, now),
  );
});

test("rejects an unlimited or unapproved approval target", () => {
  assert.throws(() =>
    validateYieldIntent(config, mandate, {
      operation: "approve", chainId: 97, account: buyer, target: usdt,
      spender: comptroller, amountBaseUnits: 10n, deadline: mandate.expiresAt,
    }, now), /approval spender/);
  assert.throws(() =>
    validateYieldIntent(config, mandate, {
      operation: "approve", chainId: 97, account: buyer, target: usdt,
      spender: vToken, amountBaseUnits: 101n, deadline: mandate.expiresAt,
    }, now), /buyer mandate/);
});

test("rejects supply through any contract other than the verified market", () => {
  assert.throws(() =>
    validateYieldIntent(config, mandate, {
      operation: "supply", chainId: 97, account: buyer, target: comptroller,
      asset: usdt, amountBaseUnits: 10n, deadline: mandate.expiresAt,
    }, now), /approved Venus/);
});
