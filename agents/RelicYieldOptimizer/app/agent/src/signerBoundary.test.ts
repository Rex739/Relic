import test from "node:test";
import assert from "node:assert/strict";
import { sendBoundedYieldTransaction, type SessionTransactionSigner } from "./signerBoundary.js";
import type { VenusTestnetConfig } from "./networkConfig.js";
import type { YieldIntent, YieldMandate } from "./executionPolicy.js";

const account = "0x1111111111111111111111111111111111111111" as const;
const usdt = "0x2222222222222222222222222222222222222222" as const;
const market = "0x3333333333333333333333333333333333333333" as const;
const config: VenusTestnetConfig = {
  chainId: 97, rpcUrl: "https://rpc.example", usdt, venusComptroller: account,
  venusUsdtVToken: market, usdtDecimals: 6, maxJobAmountBaseUnits: 100n,
  minimumBnbGasReserveWei: 10n,
};
const mandate: YieldMandate = {
  jobId: "job", account, expiresAt: new Date("2026-09-08T00:00:00.000Z"),
  maximumAmountBaseUnits: 100n, minimumSecondsBetweenExecutions: 0,
};
const intent: YieldIntent = {
  operation: "supply", chainId: 97, account, target: market, asset: usdt,
  amountBaseUnits: 10n, deadline: new Date("2026-09-07T16:00:00.000Z"),
};
const transaction = { to: market, data: "0xdeadbeef" as const, value: 0n, maximumFeeWei: 5n };
const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const signer = (overrides: Partial<SessionTransactionSigner> = {}): SessionTransactionSigner => ({
  getAddress: async () => account,
  getChainId: async () => 97,
  getNativeBalance: async () => 20n,
  simulate: async () => ({ ok: true }),
  send: async () => hash,
  ...overrides,
});

test("broadcasts only after policy, gas-reserve, and simulation checks", async () => {
  assert.equal(await sendBoundedYieldTransaction({ config, mandate, intent, transaction, signer: signer(), now: new Date("2026-09-07T15:00:00.000Z") }), hash);
});

test("rejects a failed simulation or insufficient gas reserve before broadcast", async () => {
  await assert.rejects(
    sendBoundedYieldTransaction({ config, mandate, intent, transaction, signer: signer({ simulate: async () => ({ ok: false, reason: "reverted" }) }), now: new Date("2026-09-07T15:00:00.000Z") }),
    /simulation failed/,
  );
  await assert.rejects(
    sendBoundedYieldTransaction({ config, mandate, intent, transaction, signer: signer({ getNativeBalance: async () => 14n }), now: new Date("2026-09-07T15:00:00.000Z") }),
    /insufficient BNB/,
  );
});
