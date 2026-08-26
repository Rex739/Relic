import { formatBaseUnits } from "@relic/domain";

type DisplayPrice = {
  amountBaseUnits: string;
  decimals: number;
  symbol: string;
};

export const isFreePrice = (price: Pick<DisplayPrice, "amountBaseUnits">) =>
  BigInt(price.amountBaseUnits) === 0n;

export const commercePriceLabel = (price: DisplayPrice) =>
  isFreePrice(price)
    ? "Free"
    : `${formatBaseUnits(price.amountBaseUnits, price.decimals)} ${price.symbol}`;

export const paymentRequirementLabel = (price: DisplayPrice) =>
  isFreePrice(price) ? "No payment required" : price.symbol;
