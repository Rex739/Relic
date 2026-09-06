import { z } from "zod";

const decimal = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,18})?$/u, `${label} must be a positive number with at most 18 decimal places`)
    .refine((value) => {
      const [whole, fraction = ""] = value.split(".");
      return BigInt(`${whole}${fraction.padEnd(18, "0")}`) > 0n;
    }, `${label} must be greater than 0`);

const wholeNumber = (label: string, minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/u, `${label} must be a whole number`)
    .transform(Number)
    .pipe(z.number().int().min(minimum, `${label} must be at least ${minimum}`).max(maximum, `${label} must be at most ${maximum}`));

export const gridTradingCheckoutSchema = z
  .object({
    capitalCap: decimal("Maximum trading capital"),
    lowerPrice: decimal("Lower price"),
    upperPrice: decimal("Upper price"),
    gridLevels: wholeNumber("Grid levels", 5, 8),
    durationHours: wholeNumber("Run time", 1, 168),
  })
  .superRefine((value, context) => {
    const toUnits = (amount: string) => {
      const [whole, fraction = ""] = amount.split(".");
      return BigInt(`${whole}${fraction.padEnd(18, "0")}`);
    };
    if (toUnits(value.upperPrice) <= toUnits(value.lowerPrice)) {
      context.addIssue({
        code: "custom",
        path: ["upperPrice"],
        message: "Upper price must be greater than lower price",
      });
    }
  });

export const healthMonitoringCheckoutSchema = z.object({
  threshold: decimal("Alert threshold"),
  durationDays: wholeNumber("Monitoring period", 1, 365),
});

export const lpRangeRebalancingCheckoutSchema = z.object({
  positionTokenId: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/u, "Position ID must be a positive whole number")
    .refine((value) => BigInt(value) <= 2n ** 256n - 1n, "Position ID is too large"),
  capitalCap: decimal("Maximum capital"),
  rangeWidthBps: wholeNumber("Range width", 100, 5_000),
  durationHours: wholeNumber("Run time", 1, 168),
});

export const checkoutInputSchemaFor = (category: string) => {
  if (category === "grid-trading") return gridTradingCheckoutSchema;
  if (category === "rebalancing") return lpRangeRebalancingCheckoutSchema;
  if (category === "health-factor-monitoring") return healthMonitoringCheckoutSchema;
  return null;
};
