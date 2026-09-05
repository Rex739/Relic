import assert from "node:assert/strict";
import test from "node:test";

import {
  BSC_TESTNET_CHAIN_ID,
  BSC_TESTNET_TEST_USDT,
  BSC_TESTNET_WBNB,
  PANCAKESWAP_V3_TESTNET_SWAP_ROUTER,
  applyApprovedSwap,
  validateGridSwap,
  type GridExecutionPolicy,
  type GridInventory,
  type GridSwapIntent,
} from "./gridExecutionPolicy.js";

const account = "0x1111111111111111111111111111111111111111" as const;
const usdt = BSC_TESTNET_TEST_USDT;
const now = new Date("2026-09-05T12:00:00.000Z");
const policy: GridExecutionPolicy = {
  orderId: "order-1",
  chainId: BSC_TESTNET_CHAIN_ID,
  account,
  recipient: account,
  usdt,
  wrappedBnb: BSC_TESTNET_WBNB,
  router: PANCAKESWAP_V3_TESTNET_SWAP_ROUTER,
  capitalCapBaseUnits: 100_000_000n,
  expiresAt: new Date("2026-09-06T12:00:00.000Z"),
  minimumSecondsBetweenExecutions: 900,
};
const inventory: GridInventory = { usdtBaseUnits: 100_000_000n, wrappedBnbBaseUnits: 0n };
const buy: GridSwapIntent = {
  chainId: BSC_TESTNET_CHAIN_ID,
  target: PANCAKESWAP_V3_TESTNET_SWAP_ROUTER,
  tokenIn: usdt,
  tokenOut: BSC_TESTNET_WBNB,
  amountInBaseUnits: 25_000_000n,
  minimumAmountOutBaseUnits: 40_000_000_000_000_000n,
  recipient: account,
  deadline: new Date("2026-09-05T12:10:00.000Z"),
};

test("allows the exact approved swap and records inventory", () => {
  validateGridSwap(policy, inventory, buy, now);
  assert.deepEqual(applyApprovedSwap(inventory, buy, now), {
    usdtBaseUnits: 75_000_000n,
    wrappedBnbBaseUnits: 40_000_000_000_000_000n,
    lastExecutionAt: now,
  });
});

test("denies a different contract, recipient, or capital overrun", () => {
  assert.throws(() => validateGridSwap(policy, inventory, { ...buy, target: account }, now));
  assert.throws(() => validateGridSwap(policy, inventory, { ...buy, recipient: usdt }, now));
  assert.throws(() => validateGridSwap(policy, inventory, { ...buy, amountInBaseUnits: 100_000_001n }, now));
});

test("denies unacquired WBNB and enforces cooldown", () => {
  const sell = { ...buy, tokenIn: BSC_TESTNET_WBNB, tokenOut: usdt };
  assert.throws(() => validateGridSwap(policy, inventory, sell, now));
  const afterBuy = applyApprovedSwap(inventory, buy, now);
  assert.throws(() => validateGridSwap(policy, afterBuy, sell, now));
});
