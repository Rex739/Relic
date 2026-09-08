import type { Address } from "./config.js";
import type { FundedHealthGuardJob } from "./executor.js";

const address = /^0x[0-9a-fA-F]{40}$/u;
const positive = /^[1-9]\d*$/u;
const integer = /^\d+$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const invalid = (detail: string): never => { throw new Error(`Health Guard funded request rejected: ${detail}`); };
const record = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object`);
  return value as Record<string, unknown>;
};
const string = (value: unknown, name: string): string => {
  if (typeof value !== "string") return invalid(`${name} is required`);
  const output = value.trim();
  if (!output) invalid(`${name} is required`);
  return output;
};
const amount = (value: unknown, name: string): bigint => {
  const raw = string(value, name);
  if (!positive.test(raw)) invalid(`${name} must be a positive base-10 amount`);
  return BigInt(raw);
};
const evmAddress = (value: unknown, name: string): Address => {
  const raw = string(value, name);
  if (!address.test(raw)) invalid(`${name} must be an EVM address`);
  return raw as Address;
};

/** Accepts only Relic's trusted canonical funded-job envelope, never browser input. */
export function parseFundedHealthGuardJob(value: unknown, now = new Date()): FundedHealthGuardJob {
  const input = record(value, "request");
  if (input.kind !== "relic.funded_health_guard_job.v1") invalid("unsupported request kind");
  const id = string(input.id, "id");
  if (!uuid.test(id)) invalid("id must be a UUID");
  const idempotencyKey = string(input.idempotencyKey, "idempotencyKey");
  if (idempotencyKey.length > 200) invalid("idempotencyKey is too long");
  const mandate = record(input.mandate, "mandate");
  const expiresAt = new Date(string(mandate.expiresAt, "mandate.expiresAt"));
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) invalid("mandate has expired");
  const cooldown = string(mandate.minimumSecondsBetweenRepays, "mandate.minimumSecondsBetweenRepays");
  if (!integer.test(cooldown) || !Number.isSafeInteger(Number(cooldown))) invalid("mandate.minimumSecondsBetweenRepays is invalid");
  return Object.freeze({
    id,
    idempotencyKey,
    maximumFeeWei: amount(input.maximumFeeWei, "maximumFeeWei"),
    mandate: Object.freeze({
      jobId: string(mandate.jobId, "mandate.jobId"),
      borrower: evmAddress(mandate.borrower, "mandate.borrower"),
      rescueWallet: evmAddress(mandate.rescueWallet, "mandate.rescueWallet"),
      triggerHealthFactorWad: amount(mandate.triggerHealthFactorWad, "mandate.triggerHealthFactorWad"),
      targetHealthFactorWad: amount(mandate.targetHealthFactorWad, "mandate.targetHealthFactorWad"),
      maximumRepayBaseUnits: amount(mandate.maximumRepayBaseUnits, "mandate.maximumRepayBaseUnits"),
      aggregateRepayLimitBaseUnits: amount(mandate.aggregateRepayLimitBaseUnits, "mandate.aggregateRepayLimitBaseUnits"),
      minimumSecondsBetweenRepays: Number(cooldown),
      expiresAt,
    }),
  });
}
