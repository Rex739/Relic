import { z } from "zod";
import { isHealthGuardPoolId } from "@relic/domain/health-guard-pools";

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

export const healthGuardCheckoutSchema = z
  .object({
    healthGuardPoolId: z.string().refine(isHealthGuardPoolId, "Choose a verified Venus pool"),
    threshold: decimal("Repay trigger"),
    target: decimal("Post-repayment target"),
    maximumRepay: decimal("Maximum repayment per action"),
    aggregateRepayLimit: decimal("Maximum total repayment"),
    maxFeeBnb: decimal("Maximum BNB network fee"),
    durationHours: wholeNumber("Guard duration", 1, 720),
  })
  .superRefine((value, context) => {
    const units = (amount: string) => {
      const [whole, fraction = ""] = amount.split(".");
      return BigInt(`${whole}${fraction.padEnd(18, "0")}`);
    };
    if (units(value.target) <= units(value.threshold))
      context.addIssue({ code: "custom", path: ["target"], message: "Target health factor must exceed the trigger" });
    if (units(value.aggregateRepayLimit) < units(value.maximumRepay))
      context.addIssue({ code: "custom", path: ["aggregateRepayLimit"], message: "Total repayment cap cannot be below the per-action cap" });
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

export const yieldOptimizerCheckoutSchema = z
  .object({
    capitalCap: decimal("Maximum supplied USDT"),
    executionAmount: decimal("Test execution amount"),
    maxFeeBnb: decimal("Maximum BNB network fee"),
    durationHours: wholeNumber("Session duration", 1, 168),
  })
  .superRefine((value, context) => {
    const units = (amount: string) => {
      const [whole, fraction = ""] = amount.split(".");
      return BigInt(`${whole}${fraction.padEnd(18, "0")}`);
    };
    if (units(value.executionAmount) > units(value.capitalCap))
      context.addIssue({
        code: "custom",
        path: ["executionAmount"],
        message: "Test execution amount cannot exceed the supplied USDT cap",
      });
  });

export const checkoutInputSchemaFor = (category: string, healthGuard = false) => {
  if (category === "grid-trading") return gridTradingCheckoutSchema;
  if (category === "rebalancing") return lpRangeRebalancingCheckoutSchema;
  if (category === "yield-optimisation") return yieldOptimizerCheckoutSchema;
  if (category === "health-factor-monitoring") return healthGuard ? healthGuardCheckoutSchema : healthMonitoringCheckoutSchema;
  return null;
};
