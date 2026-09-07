import type { YieldMandate } from "./executionPolicy.js";
import type { Address } from "./networkConfig.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const positiveInteger = /^[1-9]\d*$/u;
const nonNegativeInteger = /^\d+$/u;
const address = /^0x[0-9a-f]{40}$/iu;

export type VerifiedFundedYieldRequest = Readonly<{
  kind: "relic.funded_yield_job.v1";
  id: string;
  commerceJobId: string;
  idempotencyKey: string;
  mandate: YieldMandate;
  amountBaseUnits: bigint;
  maximumFeeWei: bigint;
}>;

const invalid = (detail: string): never => {
  throw new Error(`Yield execution request rejected: ${detail}`);
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Yield execution request rejected: ${label} must be a non-empty string`);
  }
  return value.trim();
}

function parsePositive(value: unknown, label: string): bigint {
  const parsed = string(value, label);
  if (!positiveInteger.test(parsed)) invalid(`${label} must be a positive base-10 integer`);
  return BigInt(parsed);
}

/**
 * Parses the canonical body produced by Relic's trusted commerce bridge.
 * This parser intentionally does not accept a browser A2A request, quote, or
 * arbitrary calldata as proof that a job is funded.
 */
export function parseVerifiedFundedYieldRequest(
  body: unknown,
  now = new Date(),
): VerifiedFundedYieldRequest {
  const input = record(body, "request");
  if (input.kind !== "relic.funded_yield_job.v1") invalid("unsupported request kind");
  const id = string(input.id, "id");
  if (!uuid.test(id)) invalid("id must be a UUID");
  const commerceJobId = string(input.commerceJobId, "commerceJobId");
  if (!positiveInteger.test(commerceJobId)) invalid("commerceJobId must be a positive integer");
  const idempotencyKey = string(input.idempotencyKey, "idempotencyKey");
  if (idempotencyKey.length > 200) invalid("idempotencyKey is too long");

  const mandateInput = record(input.mandate, "mandate");
  const jobId = string(mandateInput.jobId, "mandate.jobId");
  if (jobId !== commerceJobId) invalid("mandate.jobId must match commerceJobId");
  const account = string(mandateInput.account, "mandate.account");
  if (!address.test(account)) invalid("mandate.account must be an EVM address");
  const expiresAtRaw = string(mandateInput.expiresAt, "mandate.expiresAt");
  const expiresAt = new Date(expiresAtRaw);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) invalid("mandate has expired");
  const maximumAmountBaseUnits = parsePositive(mandateInput.maximumAmountBaseUnits, "mandate.maximumAmountBaseUnits");
  const cooldown = string(mandateInput.minimumSecondsBetweenExecutions, "mandate.minimumSecondsBetweenExecutions");
  if (!nonNegativeInteger.test(cooldown) || !Number.isSafeInteger(Number(cooldown))) {
    invalid("mandate.minimumSecondsBetweenExecutions must be a safe non-negative integer");
  }

  const amountBaseUnits = parsePositive(input.amountBaseUnits, "amountBaseUnits");
  if (amountBaseUnits > maximumAmountBaseUnits) invalid("amountBaseUnits exceeds mandate maximum");
  const maximumFeeWei = parsePositive(input.maximumFeeWei, "maximumFeeWei");
  return Object.freeze({
    kind: "relic.funded_yield_job.v1",
    id,
    commerceJobId,
    idempotencyKey,
    mandate: Object.freeze({
      jobId: commerceJobId,
      account: account as Address,
      expiresAt,
      maximumAmountBaseUnits,
      minimumSecondsBetweenExecutions: Number(cooldown),
    }),
    amountBaseUnits,
    maximumFeeWei,
  });
}
