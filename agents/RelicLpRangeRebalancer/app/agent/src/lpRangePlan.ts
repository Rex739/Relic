import { z } from "zod";

const SCALE = 100_000_000n;
const COOLDOWN_SECONDS = 3_600;

export const BSC_TESTNET_CHAIN_ID = 97 as const;
export const PANCAKESWAP_V3_TESTNET_POSITION_MANAGER =
  "0x427bF5b37357632377eCbEC9de3626C71A5396c1" as const;
export const PANCAKESWAP_V3_TESTNET_SWAP_ROUTER =
  "0xD70C70AD87aa8D45b8D59600342FB3AEe76E3c68" as const;

const decimal = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,18})?$/u, "must be a positive decimal")
  .refine((value) => toScaled(value) > 0n, "must be greater than zero");

export const rebalanceRequestSchema = z
  .object({
    chainId: z.literal(BSC_TESTNET_CHAIN_ID).default(BSC_TESTNET_CHAIN_ID),
    pair: z.literal("BNB/USDT").default("BNB/USDT"),
    positionTokenId: z.string().trim().regex(/^[1-9]\d*$/u),
    capitalCap: decimal,
    currentPrice: decimal,
    currentLowerPrice: decimal,
    currentUpperPrice: decimal,
    rangeWidthBps: z.coerce.number().int().min(100).max(5_000),
    durationHours: z.coerce.number().int().min(1).max(168),
    lastRebalanceAt: z.string().datetime().nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (toScaled(value.currentUpperPrice) <= toScaled(value.currentLowerPrice)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentUpperPrice"],
        message: "must be greater than currentLowerPrice",
      });
    }
  });

export type RebalancePlan = {
  schema: "relic.lp-range-rebalance-plan.v1";
  decision: "REBALANCE" | "HOLD";
  reason: string;
  positionTokenId: string;
  pair: "BNB/USDT";
  capitalCap: string;
  currentRange: { lowerPrice: string; upperPrice: string };
  proposedRange: { lowerPrice: string; upperPrice: string } | null;
  cooldownSeconds: 3_600;
  allowedContracts: readonly [string, string];
  executionSteps: readonly string[];
  stopConditions: readonly string[];
  expiresAt: string;
};

function toScaled(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(8, "0").slice(0, 8)}`);
}

function fromScaled(value: bigint): string {
  const digits = value.toString().padStart(9, "0");
  const fraction = digits.slice(-8).replace(/0+$/u, "");
  return `${digits.slice(0, -8)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Create a deterministic execution decision. This deliberately produces a
 * plan only: the later PancakeSwap adapter must independently enforce the
 * buyer's verified mandate before any transaction is submitted.
 */
export function createRebalancePlan(raw: unknown, now = new Date()): RebalancePlan {
  const input = rebalanceRequestSchema.parse(raw);
  const current = toScaled(input.currentPrice);
  const lower = toScaled(input.currentLowerPrice);
  const upper = toScaled(input.currentUpperPrice);
  const last = input.lastRebalanceAt === null ? null : new Date(input.lastRebalanceAt);
  const cooldownActive =
    last !== null && now.getTime() - last.getTime() < COOLDOWN_SECONDS * 1_000;
  const outsideRange = current < lower || current > upper;
  const base = {
    schema: "relic.lp-range-rebalance-plan.v1" as const,
    positionTokenId: input.positionTokenId,
    pair: "BNB/USDT" as const,
    capitalCap: input.capitalCap,
    currentRange: {
      lowerPrice: input.currentLowerPrice,
      upperPrice: input.currentUpperPrice,
    },
    cooldownSeconds: 3_600 as const,
    allowedContracts: [
      PANCAKESWAP_V3_TESTNET_POSITION_MANAGER,
      PANCAKESWAP_V3_TESTNET_SWAP_ROUTER,
    ] as const,
    executionSteps: [
      "Decrease liquidity on the approved PancakeSwap V3 position NFT",
      "Collect principal and fees to the buyer-authorized account",
      "Adjust the BNB/USDT ratio through the approved V3 router only when required",
      "Mint the replacement range through the approved position manager",
      "Verify receipts and publish transaction hashes with the old and new ranges",
    ] as const,
    stopConditions: [
      "The buyer-approved capital cap would be exceeded",
      "The requested run time ends",
      "The buyer pauses or revokes the mandate",
      "A rebalance completed less than one hour ago",
      "A target asset or contract falls outside the approved BNB/USDT scope",
    ] as const,
    expiresAt: new Date(now.getTime() + input.durationHours * 3_600_000).toISOString(),
  };

  if (!outsideRange) {
    return { ...base, decision: "HOLD", reason: "Current price is inside the active range.", proposedRange: null };
  }
  if (cooldownActive) {
    return { ...base, decision: "HOLD", reason: "The one-hour rebalance cooldown is active.", proposedRange: null };
  }

  const delta = (current * BigInt(input.rangeWidthBps)) / 10_000n;
  const proposedLower = current - delta;
  const proposedUpper = current + delta;
  if (proposedLower <= 0n || proposedUpper <= proposedLower) {
    throw new Error("range width produces an invalid price range");
  }
  return {
    ...base,
    decision: "REBALANCE",
    reason: "Current price is outside the active range.",
    proposedRange: { lowerPrice: fromScaled(proposedLower), upperPrice: fromScaled(proposedUpper) },
  };
}

/** Extract the buyer's structured rebalance input from the paid job context. */
export function rebalanceRequestFromPrompt(prompt: string): unknown {
  const marker = "JOB CONTEXT:\n";
  const context = prompt.includes(marker) ? prompt.slice(prompt.indexOf(marker) + marker.length) : prompt;
  const parsed: unknown = JSON.parse(context);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("paid job must contain a structured rebalance request");
  }
  const record = parsed as Record<string, unknown>;
  const terms = record.terms;
  if (terms !== null && typeof terms === "object" && !Array.isArray(terms)) {
    const termRecord = terms as Record<string, unknown>;
    return termRecord.rebalance ?? termRecord;
  }
  return record.rebalance ?? record;
}
