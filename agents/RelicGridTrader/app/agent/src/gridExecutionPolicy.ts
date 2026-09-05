/** Fail-closed execution rules for one Grid Trader order. */

export const BSC_TESTNET_CHAIN_ID = 97;
export const PANCAKESWAP_V3_TESTNET_SWAP_ROUTER =
  "0xD70C70AD87aa8D45b8D59600342FB3AEe76E3c68" as const;
export const BSC_TESTNET_WBNB =
  "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
/** PancakeSwap's BSC Testnet TEST_USDT (18 decimals), never mainnet USDT. */
export const BSC_TESTNET_TEST_USDT =
  "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;

type Address = `0x${string}`;

export type GridExecutionPolicy = {
  orderId: string;
  chainId: typeof BSC_TESTNET_CHAIN_ID;
  account: Address;
  recipient: Address;
  usdt: typeof BSC_TESTNET_TEST_USDT;
  wrappedBnb: typeof BSC_TESTNET_WBNB;
  router: typeof PANCAKESWAP_V3_TESTNET_SWAP_ROUTER;
  capitalCapBaseUnits: bigint;
  expiresAt: Date;
  minimumSecondsBetweenExecutions: number;
};

export type GridInventory = {
  usdtBaseUnits: bigint;
  wrappedBnbBaseUnits: bigint;
  lastExecutionAt?: Date;
};

export type GridSwapIntent = {
  chainId: number;
  target: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountInBaseUnits: bigint;
  minimumAmountOutBaseUnits: bigint;
  recipient: Address;
  deadline: Date;
};

const equalAddress = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

const fail = (message: string): never => {
  throw new Error(`Grid execution denied: ${message}`);
};

/**
 * Checks a structured swap intent before calldata is built or a session key is
 * asked to sign. Raw calldata never reaches this boundary.
 */
export function validateGridSwap(
  policy: GridExecutionPolicy,
  inventory: GridInventory,
  intent: GridSwapIntent,
  now = new Date(),
): void {
  if (now >= policy.expiresAt) fail("order permission has expired");
  if (intent.deadline > policy.expiresAt || intent.deadline <= now)
    fail("swap deadline is outside the order permission window");
  if (intent.chainId !== policy.chainId) fail("wrong network");
  if (!equalAddress(intent.target, policy.router)) fail("target is not the approved PancakeSwap router");
  if (!equalAddress(intent.recipient, policy.recipient)) fail("swap output recipient is not the buyer account");
  if (intent.amountInBaseUnits <= 0n || intent.minimumAmountOutBaseUnits <= 0n)
    fail("swap amounts must be positive");
  if (
    inventory.lastExecutionAt &&
    now.getTime() - inventory.lastExecutionAt.getTime() < policy.minimumSecondsBetweenExecutions * 1_000
  )
    fail("cooldown has not elapsed");

  const isBuy = equalAddress(intent.tokenIn, policy.usdt) && equalAddress(intent.tokenOut, policy.wrappedBnb);
  const isSell = equalAddress(intent.tokenIn, policy.wrappedBnb) && equalAddress(intent.tokenOut, policy.usdt);
  if (!isBuy && !isSell) fail("pair is outside the approved BNB/USDT market");
  if (isBuy && intent.amountInBaseUnits > inventory.usdtBaseUnits)
    fail("USDT input exceeds remaining buyer-approved capital");
  if (isSell && intent.amountInBaseUnits > inventory.wrappedBnbBaseUnits)
    fail("WBNB input was not acquired by this order");
}

/** Update order inventory only after an on-chain receipt is independently verified. */
export function applyApprovedSwap(
  inventory: GridInventory,
  intent: GridSwapIntent,
  now = new Date(),
): GridInventory {
  const isBuy = intent.tokenIn.toLowerCase() !== BSC_TESTNET_WBNB.toLowerCase();
  return isBuy
    ? {
        usdtBaseUnits: inventory.usdtBaseUnits - intent.amountInBaseUnits,
        wrappedBnbBaseUnits: inventory.wrappedBnbBaseUnits + intent.minimumAmountOutBaseUnits,
        lastExecutionAt: now,
      }
    : {
        usdtBaseUnits: inventory.usdtBaseUnits + intent.minimumAmountOutBaseUnits,
        wrappedBnbBaseUnits: inventory.wrappedBnbBaseUnits - intent.amountInBaseUnits,
        lastExecutionAt: now,
      };
}
