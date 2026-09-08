import type { Address, HealthGuardConfig } from "./config.js";

export const WAD = 10n ** 18n;

export type HealthGuardMandate = Readonly<{
  jobId: string;
  borrower: Address;
  rescueWallet: Address;
  triggerHealthFactorWad: bigint;
  targetHealthFactorWad: bigint;
  maximumRepayBaseUnits: bigint;
  aggregateRepayLimitBaseUnits: bigint;
  minimumSecondsBetweenRepays: number;
  expiresAt: Date;
}>;

export type HealthObservation = Readonly<{
  healthFactorWad: bigint;
  outstandingDebtBaseUnits: bigint;
  rescueWalletUsdtBaseUnits: bigint;
  observedAt: Date;
}>;

export type RepayHistory = Readonly<{
  aggregateRepaidBaseUnits: bigint;
  lastRepayAt?: Date;
}>;

export type RepayDecision =
  | Readonly<{ kind: "wait"; reason: string }>
  | Readonly<{ kind: "repay"; amountBaseUnits: bigint; reason: "health_factor_below_trigger" }>;

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const reject = (detail: string): never => { throw new Error(`Health Guard policy rejected: ${detail}`); };

export function validateHealthGuardMandate(config: HealthGuardConfig, mandate: HealthGuardMandate, now = new Date()): void {
  if (!mandate.jobId.trim()) reject("job id is required");
  if (!/^0x[0-9a-fA-F]{40}$/u.test(mandate.borrower)) reject("borrower is invalid");
  if (!/^0x[0-9a-fA-F]{40}$/u.test(mandate.rescueWallet)) reject("rescue wallet is invalid");
  if (mandate.expiresAt <= now) reject("mandate has expired");
  if (mandate.triggerHealthFactorWad <= 0n || mandate.targetHealthFactorWad <= mandate.triggerHealthFactorWad)
    reject("target health factor must exceed trigger");
  if (mandate.maximumRepayBaseUnits <= 0n || mandate.aggregateRepayLimitBaseUnits < mandate.maximumRepayBaseUnits)
    reject("repay caps are invalid");
  if (mandate.maximumRepayBaseUnits > config.maxRepayBaseUnits) reject("per-action cap exceeds service cap");
  if (!Number.isSafeInteger(mandate.minimumSecondsBetweenRepays) || mandate.minimumSecondsBetweenRepays < 60)
    reject("cooldown must be at least sixty seconds");
}

/**
 * Choose a conservative rescue amount from evidence already observed. V1 does
 * not estimate a target amount from a price model: it repays the smallest
 * bounded amount available and reevaluates after confirmation.
 */
export function decideRepayment(input: {
  config: HealthGuardConfig;
  mandate: HealthGuardMandate;
  observation: HealthObservation;
  history: RepayHistory;
  now?: Date;
}): RepayDecision {
  const now = input.now ?? new Date();
  validateHealthGuardMandate(input.config, input.mandate, now);
  const { mandate, observation, history } = input;
  if (observation.observedAt.getTime() < now.getTime() - 120_000) return { kind: "wait", reason: "stale_observation" };
  if (observation.healthFactorWad >= mandate.triggerHealthFactorWad) return { kind: "wait", reason: "health_factor_above_trigger" };
  if (history.lastRepayAt && now.getTime() - history.lastRepayAt.getTime() < mandate.minimumSecondsBetweenRepays * 1_000)
    return { kind: "wait", reason: "cooldown_active" };
  const aggregateRemaining = mandate.aggregateRepayLimitBaseUnits - history.aggregateRepaidBaseUnits;
  if (aggregateRemaining <= 0n) return { kind: "wait", reason: "aggregate_cap_reached" };
  const amount = [observation.outstandingDebtBaseUnits, observation.rescueWalletUsdtBaseUnits, mandate.maximumRepayBaseUnits, aggregateRemaining]
    .reduce((lowest, value) => value < lowest ? value : lowest);
  if (amount <= 0n) return { kind: "wait", reason: "no_authorized_usdt_available" };
  return { kind: "repay", amountBaseUnits: amount, reason: "health_factor_below_trigger" };
}
