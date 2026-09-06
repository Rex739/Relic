import { z } from "zod";

export const BSC_TESTNET_CHAIN_ID = 97 as const;
export const BSC_TESTNET_WBNB =
  "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
export const BSC_TESTNET_TEST_USDT =
  "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;
export const PANCAKESWAP_V3_TESTNET_POSITION_MANAGER =
  "0x427bF5b37357632377eCbEC9de3626C71A5396c1" as const;
export const PANCAKESWAP_V3_TESTNET_SWAP_ROUTER =
  "0xD70C70AD87aa8D45b8D59600342FB3AEe76E3c68" as const;

const decimal = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,18})?$/u, "Use a positive decimal value");

const positiveDecimal = (label: string) =>
  decimal.refine((value) => toScaled(value) > 0n, `${label} must be greater than zero`);

export const lpRangeRebalanceRequestSchema = z
  .object({
    chainId: z.literal(BSC_TESTNET_CHAIN_ID),
    pair: z.literal("BNB/USDT"),
    positionTokenId: z
      .string()
      .trim()
      .regex(/^[1-9]\d*$/u, "Position ID must be a positive whole number"),
    capitalCap: positiveDecimal("Capital cap"),
    currentPrice: positiveDecimal("Current price"),
    currentLowerPrice: positiveDecimal("Current lower price"),
    currentUpperPrice: positiveDecimal("Current upper price"),
    rangeWidthBps: z.coerce.number().int().min(100).max(5_000),
    durationHours: z.coerce.number().int().min(1).max(168),
    lastRebalanceAt: z.iso.datetime().nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (toScaled(value.currentUpperPrice) <= toScaled(value.currentLowerPrice)) {
      context.addIssue({
        code: "custom",
        path: ["currentUpperPrice"],
        message: "Current upper price must be greater than current lower price",
      });
    }
  });

export type LpRangeRebalanceRequest = z.infer<typeof lpRangeRebalanceRequestSchema>;

export type LpRangeRebalancePlan = {
  schema: "relic.lp-range-rebalance-plan.v1";
  chainId: 97;
  pair: "BNB/USDT";
  positionTokenId: string;
  decision: "REBALANCE" | "HOLD";
  reason: string;
  currentRange: { lowerPrice: string; upperPrice: string };
  proposedRange: { lowerPrice: string; upperPrice: string } | null;
  capitalCap: string;
  minimumSecondsBetweenRebalances: 3_600;
  allowedContracts: readonly [string, string];
  requiredCapabilities: readonly ["swap_assets", "approve_contracts", "submit_transactions"];
  executionSteps: readonly string[];
  expiresAt: string;
  stopConditions: readonly string[];
};

const SCALE = 100_000_000n;

function toScaled(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(8, "0").slice(0, 8)}`);
}

function fromScaled(value: bigint): string {
  const digits = value.toString().padStart(9, "0");
  const whole = digits.slice(0, -8);
  const fraction = digits.slice(-8).replace(/0+$/u, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

export function createLpRangeRebalancePlan(
  raw: unknown,
  now = new Date(),
): LpRangeRebalancePlan {
  const input = lpRangeRebalanceRequestSchema.parse(raw);
  const current = toScaled(input.currentPrice);
  const lower = toScaled(input.currentLowerPrice);
  const upper = toScaled(input.currentUpperPrice);
  const cooldownMs = 3_600_000;
  const lastRebalanceAt =
    input.lastRebalanceAt === null ? null : new Date(input.lastRebalanceAt);
  const cooldownActive =
    lastRebalanceAt !== null && now.getTime() - lastRebalanceAt.getTime() < cooldownMs;
  const outsideRange = current < lower || current > upper;
  const rangeDelta = (current * BigInt(input.rangeWidthBps)) / 10_000n;
  const proposedLower = current - rangeDelta;
  const proposedUpper = current + rangeDelta;
  const base = {
    schema: "relic.lp-range-rebalance-plan.v1" as const,
    chainId: BSC_TESTNET_CHAIN_ID,
    pair: "BNB/USDT" as const,
    positionTokenId: input.positionTokenId,
    currentRange: {
      lowerPrice: input.currentLowerPrice,
      upperPrice: input.currentUpperPrice,
    },
    capitalCap: input.capitalCap,
    minimumSecondsBetweenRebalances: 3_600 as const,
    allowedContracts: [
      PANCAKESWAP_V3_TESTNET_POSITION_MANAGER,
      PANCAKESWAP_V3_TESTNET_SWAP_ROUTER,
    ] as const,
    requiredCapabilities: [
      "swap_assets",
      "approve_contracts",
      "submit_transactions",
    ] as const,
    expiresAt: new Date(now.getTime() + input.durationHours * 3_600_000).toISOString(),
    stopConditions: [
      "The buyer-approved capital cap would be exceeded",
      "The requested run time ends",
      "The buyer pauses or revokes the order",
      "A rebalance was completed less than one hour ago",
      "Any target contract or asset differs from the approved BNB/USDT scope",
    ] as const,
  };

  if (!outsideRange) {
    return {
      ...base,
      decision: "HOLD",
      reason: "Current price is still inside the active liquidity range.",
      proposedRange: null,
      executionSteps: [],
    };
  }
  if (cooldownActive) {
    return {
      ...base,
      decision: "HOLD",
      reason: "The one-hour rebalance cooldown is still active.",
      proposedRange: null,
      executionSteps: [],
    };
  }
  if (proposedLower <= 0n || proposedUpper <= proposedLower) {
    throw new Error("Requested range width produces an invalid price range");
  }
  return {
    ...base,
    decision: "REBALANCE",
    reason: "Current price has moved outside the active liquidity range.",
    proposedRange: {
      lowerPrice: fromScaled(proposedLower),
      upperPrice: fromScaled(proposedUpper),
    },
    executionSteps: [
      "Decrease liquidity on the approved position-manager NFT",
      "Collect principal and earned fees to the buyer-authorized account",
      "Use the approved V3 router only if a BNB/USDT ratio adjustment is required",
      "Mint the replacement BNB/USDT range through the approved position manager",
      "Verify receipts and publish the old range, new range, fees, and transaction hashes",
    ],
  };
}
