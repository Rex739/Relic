import test from "node:test";
import assert from "node:assert/strict";
import { VenusTransactionAdapter } from "./venusTransactionAdapter.js";
import type { VenusTestnetConfig } from "./networkConfig.js";

const config: VenusTestnetConfig = {
  chainId: 97,
  rpcUrl: "https://rpc.example",
  usdt: "0x1111111111111111111111111111111111111111",
  venusComptroller: "0x2222222222222222222222222222222222222222",
  venusUsdtVToken: "0x3333333333333333333333333333333333333333",
  usdtDecimals: 6,
  maxJobAmountBaseUnits: 100n,
  minimumBnbGasReserveWei: 1n,
};

test("encodes only exact Venus USDT approval, supply, and withdrawal calls", () => {
  const adapter = new VenusTransactionAdapter(config);
  assert.equal(adapter.approveExact(7n, 1n).to, config.usdt);
  assert.match(adapter.approveExact(7n, 1n).data, /^0x095ea7b3/);
  assert.equal(adapter.supply(7n, 1n).data, `0xa0712d68${"7".padStart(64, "0")}`);
  assert.equal(adapter.withdraw(7n, 1n).data, `0x852a12e3${"7".padStart(64, "0")}`);
});

test("rejects zero and negative transaction amounts", () => {
  const adapter = new VenusTransactionAdapter(config);
  assert.throws(() => adapter.supply(0n, 1n), /positive/);
  assert.throws(() => adapter.withdraw(-1n, 1n), /positive/);
});
