type DisplayPrice = {
  amountBaseUnits: string;
  decimals: number;
  symbol: string;
};

export function formatDisplayBaseUnits(
  value: bigint | string,
  decimals: number,
) {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  if (decimals === 0) return amount.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fractional = (amount % divisor)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fractional.length === 0 ? whole.toString() : `${whole}.${fractional}`;
}

export const isFreePrice = (price: Pick<DisplayPrice, "amountBaseUnits">) =>
  BigInt(price.amountBaseUnits) === 0n;

export const commercePriceLabel = (price: DisplayPrice) =>
  isFreePrice(price)
    ? "Free"
    : `${formatDisplayBaseUnits(price.amountBaseUnits, price.decimals)} ${price.symbol}`;

export const paymentRequirementLabel = (price: DisplayPrice) =>
  isFreePrice(price) ? "No payment required" : price.symbol;
