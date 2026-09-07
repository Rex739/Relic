import {
  type YieldIntent,
  type YieldMandate,
  validateYieldIntent,
} from "./executionPolicy.js";
import type { Address, VenusTestnetConfig } from "./networkConfig.js";
import type { Abi } from "viem";

export type PreparedContractCall = Readonly<{
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}>;

export type PreparedTransaction = Readonly<{
  to: Address;
  data: `0x${string}`;
  value: bigint;
  /** Conservative maximum native-token fee supplied by the protocol adapter. */
  maximumFeeWei: bigint;
  /**
   * The ABI representation consumed by the bounded Studio wallet adapter.
   * Test doubles may omit it, but the production adapter refuses raw calldata.
   */
  call?: PreparedContractCall;
}>;

export interface SessionTransactionSigner {
  getAddress(): Promise<Address>;
  getChainId(): Promise<number>;
  getNativeBalance(address: Address): Promise<bigint>;
  simulate(transaction: PreparedTransaction): Promise<{ ok: boolean; reason?: string }>;
  send(transaction: PreparedTransaction): Promise<`0x${string}`>;
}

const transactionHash = /^0x[0-9a-fA-F]{64}$/u;
const sameAddress = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/**
 * The final code-only gate before the runtime session broadcasts a transaction.
 * It deliberately takes a structured policy intent and prepared transaction as
 * separate inputs: the adapter may construct ABI calldata, but it cannot
 * change the authorized target, amount, account, or chain.
 */
export async function sendBoundedYieldTransaction(input: {
  config: VenusTestnetConfig;
  mandate: YieldMandate;
  intent: YieldIntent;
  transaction: PreparedTransaction;
  signer: SessionTransactionSigner;
  now?: Date;
}): Promise<`0x${string}`> {
  const now = input.now ?? new Date();
  validateYieldIntent(input.config, input.mandate, input.intent, now);
  if (!sameAddress(input.transaction.to, input.intent.target)) {
    throw new Error("Yield signing denied: calldata target differs from approved intent");
  }
  if (input.transaction.value !== 0n) {
    throw new Error("Yield signing denied: native-value transfers are not permitted");
  }
  if (input.transaction.maximumFeeWei < 0n) {
    throw new Error("Yield signing denied: transaction fee estimate is invalid");
  }

  const [signerAddress, chainId] = await Promise.all([
    input.signer.getAddress(),
    input.signer.getChainId(),
  ]);
  if (chainId !== input.intent.chainId) {
    throw new Error("Yield signing denied: session signer is on the wrong network");
  }
  if (!sameAddress(signerAddress, input.mandate.account)) {
    throw new Error("Yield signing denied: session signer differs from buyer mandate account");
  }
  const balance = await input.signer.getNativeBalance(signerAddress);
  if (balance < input.config.minimumBnbGasReserveWei + input.transaction.maximumFeeWei) {
    throw new Error("Yield signing denied: insufficient BNB remains after transaction fee");
  }
  const simulation = await input.signer.simulate(input.transaction);
  if (!simulation.ok) {
    throw new Error(`Yield signing denied: simulation failed${simulation.reason ? ` (${simulation.reason})` : ""}`);
  }
  const hash = await input.signer.send(input.transaction);
  if (!transactionHash.test(hash)) throw new Error("Yield signing denied: signer returned an invalid transaction hash");
  return hash;
}
