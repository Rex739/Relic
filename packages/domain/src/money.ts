import { z } from "zod";

const unsignedDecimalPattern = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export interface TokenAmount {
  chainId: number;
  tokenAddress: `0x${string}`;
  decimals: number;
  amountBaseUnits: string;
  symbol: string;
}

export const tokenAmountSchema = z
  .object({
    chainId: z.number().int().positive(),
    tokenAddress: z.string().regex(addressPattern),
    decimals: z.number().int().min(0).max(77),
    amountBaseUnits: z.string().regex(/^\d+$/),
    symbol: z.string().trim().min(1).max(32),
  })
  .strict();

const decimalParts = (value: string) => {
  const normalized = value.trim();
  const match = unsignedDecimalPattern.exec(normalized);
  if (match === null) throw new Error("Amount must be a non-negative decimal");
  const [whole, fraction = ""] = normalized.split(".");
  return { whole: whole!, fraction };
};

export function parseBaseUnits(value: string, decimals: number): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 77)
    throw new Error("Token decimals must be an integer between 0 and 77");
  const { whole, fraction } = decimalParts(value);
  if (fraction.length > decimals)
    throw new Error("Amount exceeds the token's decimal precision");
  const digits = `${whole}${fraction.padEnd(decimals, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  return BigInt(digits);
}

export function formatBaseUnits(value: bigint | string, decimals: number) {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 77)
    throw new Error("Token decimals must be an integer between 0 and 77");
  const amount = typeof value === "bigint" ? value : BigInt(value);
  if (amount < 0n) throw new Error("Amount cannot be negative");
  if (decimals === 0) return amount.toString();
  const padded = amount.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

export function compareDecimalAmounts(left: string, right: string) {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const leftUnits = parseBaseUnits(left, scale);
  const rightUnits = parseBaseUnits(right, scale);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

export function addDecimalAmounts(left: string, right: string) {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  return formatBaseUnits(
    parseBaseUnits(left, scale) + parseBaseUnits(right, scale),
    scale,
  );
}

export function exactTokenAmount(
  input: z.input<typeof tokenAmountSchema>,
): TokenAmount {
  const parsed = tokenAmountSchema.parse(input);
  const baseUnits = BigInt(parsed.amountBaseUnits);
  if (baseUnits < 0n) throw new Error("Amount cannot be negative");
  return {
    ...parsed,
    tokenAddress: parsed.tokenAddress as `0x${string}`,
    amountBaseUnits: baseUnits.toString(),
  };
}
