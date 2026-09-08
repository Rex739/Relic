import { encodeFunctionData, type Abi } from "viem";
import type { Address, HealthGuardPoolConfig } from "./config.js";

export type PreparedTransaction = Readonly<{
  to: Address;
  data: `0x${string}`;
  value: bigint;
  maximumFeeWei: bigint;
  /** Production session signers re-encode this instead of accepting raw calldata. */
  call: Readonly<{ address: Address; abi: Abi; functionName: string; args: readonly unknown[] }>;
}>;

const erc20Abi = [{
  type: "function", name: "approve", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const satisfies Abi;

const vTokenAbi = [{
  type: "function", name: "repayBorrowBehalf", stateMutability: "nonpayable",
  inputs: [{ name: "borrower", type: "address" }, { name: "repayAmount", type: "uint256" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const satisfies Abi;

const positive = (value: bigint) => {
  if (value <= 0n) throw new Error("Health Guard transaction amount must be positive");
  return value;
};

/** Only exact USDT approvals and Venus repayment calldata can be constructed. */
export class VenusHealthTransactionAdapter {
  public constructor(private readonly pool: HealthGuardPoolConfig) {}

  approveExact(amountBaseUnits: bigint, maximumFeeWei: bigint): PreparedTransaction {
    const args = [this.pool.venusUsdtVToken, positive(amountBaseUnits)] as const;
    return {
      to: this.pool.usdt,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args }),
      value: 0n,
      maximumFeeWei,
      call: { address: this.pool.usdt, abi: erc20Abi, functionName: "approve", args },
    };
  }

  repayBorrowBehalf(borrower: Address, amountBaseUnits: bigint, maximumFeeWei: bigint): PreparedTransaction {
    const args = [borrower, positive(amountBaseUnits)] as const;
    return {
      to: this.pool.venusUsdtVToken,
      data: encodeFunctionData({ abi: vTokenAbi, functionName: "repayBorrowBehalf", args }),
      value: 0n,
      maximumFeeWei,
      call: { address: this.pool.venusUsdtVToken, abi: vTokenAbi, functionName: "repayBorrowBehalf", args },
    };
  }
}
