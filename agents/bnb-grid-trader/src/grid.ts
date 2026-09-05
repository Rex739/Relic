import { z } from "zod";

const decimal = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/, "Use a non-negative decimal value");

export const gridTradingRequestSchema = z
  .object({
    chainId: z.literal(97),
    pair: z.literal("BNB/USDT"),
    capitalCap: decimal,
    lowerPrice: decimal,
    upperPrice: decimal,
    gridLevels: z.coerce.number().int().min(5).max(8),
    durationHours: z.coerce.number().int().min(1).max(168),
  })
  .strict();

export type GridTradingRequest = z.infer<typeof gridTradingRequestSchema>;

export type GridPlan = {
  schema: "relic.grid-plan.v1";
  chainId: 97;
  pair: "BNB/USDT";
  capitalCap: string;
  lowerPrice: string;
  upperPrice: string;
  gridLevels: number;
  priceStep: string;
  levels: string[];
  maximumExecutions: number;
  minimumSecondsBetweenExecutions: number;
  expiresAt: string;
  stopConditions: string[];
};

const toScaled = (value: string, decimals = 8) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`);
};

const fromScaled = (value: bigint, decimals = 8) => {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/u, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
};

export function createGridPlan(raw: unknown, now = new Date()): GridPlan {
  const input = gridTradingRequestSchema.parse(raw);
  const lower = toScaled(input.lowerPrice);
  const upper = toScaled(input.upperPrice);
  const capital = toScaled(input.capitalCap);
  if (capital <= 0n) throw new Error("Capital cap must be greater than zero");
  if (lower <= 0n) throw new Error("Lower price must be greater than zero");
  if (upper <= lower) throw new Error("Upper price must be greater than lower price");

  const intervals = BigInt(input.gridLevels - 1);
  const step = (upper - lower) / intervals;
  if (step <= 0n) throw new Error("Price range is too narrow for the selected grid");
  const levels = Array.from({ length: input.gridLevels }, (_, index) =>
    fromScaled(index === input.gridLevels - 1 ? upper : lower + step * BigInt(index)),
  );

  return {
    schema: "relic.grid-plan.v1",
    chainId: input.chainId,
    pair: input.pair,
    capitalCap: input.capitalCap,
    lowerPrice: input.lowerPrice,
    upperPrice: input.upperPrice,
    gridLevels: input.gridLevels,
    priceStep: fromScaled(step),
    levels,
    maximumExecutions: input.gridLevels * 2,
    minimumSecondsBetweenExecutions: 900,
    expiresAt: new Date(now.getTime() + input.durationHours * 3_600_000).toISOString(),
    stopConditions: [
      "The approved capital cap is reached",
      "The requested run time ends",
      "The buyer pauses or cancels the order",
      "The market price remains outside the configured range",
    ],
  };
}
