import type { PreparedTransaction } from "./signerBoundary.js";
import type { Address, VenusTestnetConfig } from "./networkConfig.js";

const selector = {
  approve: "095ea7b3",
  mint: "a0712d68",
  redeemUnderlying: "852a12e3",
} as const;

const word = (value: bigint): string => {
  if (value < 0n || value >= 1n << 256n) throw new Error("Venus transaction amount is invalid");
  return value.toString(16).padStart(64, "0");
};

const addressWord = (value: Address): string => value.slice(2).toLowerCase().padStart(64, "0");

function amount(amountBaseUnits: bigint): bigint {
  if (amountBaseUnits <= 0n) throw new Error("Venus transaction amount must be positive");
  return amountBaseUnits;
}

/**
 * Encodes only the three methods allowed by V1. Fee estimation is injected by
 * the runtime after an RPC estimate; no function here can target a caller-
 * supplied contract or attach BNB value.
 */
export class VenusTransactionAdapter {
  public constructor(private readonly config: VenusTestnetConfig) {}

  approveExact(amountBaseUnits: bigint, maximumFeeWei: bigint): PreparedTransaction {
    return {
      to: this.config.usdt,
      data: `0x${selector.approve}${addressWord(this.config.venusUsdtVToken)}${word(amount(amountBaseUnits))}`,
      value: 0n,
      maximumFeeWei,
    };
  }

  supply(amountBaseUnits: bigint, maximumFeeWei: bigint): PreparedTransaction {
    return {
      to: this.config.venusUsdtVToken,
      data: `0x${selector.mint}${word(amount(amountBaseUnits))}`,
      value: 0n,
      maximumFeeWei,
    };
  }

  withdraw(amountBaseUnits: bigint, maximumFeeWei: bigint): PreparedTransaction {
    return {
      to: this.config.venusUsdtVToken,
      data: `0x${selector.redeemUnderlying}${word(amount(amountBaseUnits))}`,
      value: 0n,
      maximumFeeWei,
    };
  }
}
