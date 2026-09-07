import test from "node:test";
import assert from "node:assert/strict";
import { VenusOnchainExecutionReader } from "./venusExecutionReader.js";
import type { VenusTestnetConfig } from "./networkConfig.js";

const config: VenusTestnetConfig = {
  chainId: 97, rpcUrl: "https://rpc.example", usdt: "0x1111111111111111111111111111111111111111",
  venusComptroller: "0x2222222222222222222222222222222222222222", venusUsdtVToken: "0x3333333333333333333333333333333333333333",
  usdtDecimals: 6, maxJobAmountBaseUnits: 10n, minimumBnbGasReserveWei: 1n,
};
const account = "0x4444444444444444444444444444444444444444" as const;

test("reads only the configured USDT and Venus market", async () => {
  const calls: string[] = [];
  const reader = new VenusOnchainExecutionReader(config, {
    getTokenAllowance: async (token, _owner, spender) => { calls.push(`${token}:${spender}`); return 7n; },
    getTokenBalance: async (token) => token === config.usdt ? 19n : 3n,
    getTransactionReceipt: async () => ({ confirmed: true }),
  });
  assert.equal(await reader.allowance(account), 7n);
  assert.deepEqual(await reader.snapshot(account), { usdt: 19n, vToken: 3n });
  assert.deepEqual(calls, [`${config.usdt}:${config.venusUsdtVToken}`]);
});
