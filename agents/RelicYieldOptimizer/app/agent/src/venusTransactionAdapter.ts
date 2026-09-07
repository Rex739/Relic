import type { PreparedTransaction } from "./signerBoundary.js";
import type { VenusTestnetConfig } from "./networkConfig.js";
import { encodeFunctionData, type Abi } from "viem";

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

const vTokenAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "mintAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeemUnderlying",
    stateMutability: "nonpayable",
    inputs: [{ name: "redeemAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

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
    const args = [this.config.venusUsdtVToken, amount(amountBaseUnits)] as const;
    return {
      to: this.config.usdt,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args }),
      value: 0n,
      maximumFeeWei,
      call: { address: this.config.usdt, abi: erc20Abi, functionName: "approve", args },
    };
  }

  supply(amountBaseUnits: bigint, maximumFeeWei: bigint): PreparedTransaction {
    const args = [amount(amountBaseUnits)] as const;
    return {
      to: this.config.venusUsdtVToken,
      data: encodeFunctionData({ abi: vTokenAbi, functionName: "mint", args }),
      value: 0n,
      maximumFeeWei,
      call: { address: this.config.venusUsdtVToken, abi: vTokenAbi, functionName: "mint", args },
    };
  }

  withdraw(amountBaseUnits: bigint, maximumFeeWei: bigint): PreparedTransaction {
    const args = [amount(amountBaseUnits)] as const;
    return {
      to: this.config.venusUsdtVToken,
      data: encodeFunctionData({ abi: vTokenAbi, functionName: "redeemUnderlying", args }),
      value: 0n,
      maximumFeeWei,
      call: { address: this.config.venusUsdtVToken, abi: vTokenAbi, functionName: "redeemUnderlying", args },
    };
  }
}
