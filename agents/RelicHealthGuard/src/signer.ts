import { configuredHealthGuardPool, type Address, type HealthGuardConfig } from "./config.js";
import type { HealthGuardMandate } from "./policy.js";
import type { PreparedTransaction } from "./transaction.js";

export interface BoundedSessionSigner {
  getAddress(): Promise<Address>;
  getChainId(): Promise<number>;
  getNativeBalance(address: Address): Promise<bigint>;
  simulate(transaction: PreparedTransaction): Promise<{ ok: boolean; reason?: string }>;
  send(transaction: PreparedTransaction): Promise<`0x${string}`>;
}

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const transactionHash = /^0x[0-9a-fA-F]{64}$/u;

/** Last code boundary before a buyer-isolated session can broadcast. */
export async function sendHealthGuardTransaction(input: {
  config: HealthGuardConfig;
  mandate: HealthGuardMandate;
  transaction: PreparedTransaction;
  signer: BoundedSessionSigner;
}): Promise<`0x${string}`> {
  if (!input.config.executionEnabled) throw new Error("Health Guard signing denied: execution is disabled");
  if (input.transaction.value !== 0n) throw new Error("Health Guard signing denied: native transfers are forbidden");
  if (input.transaction.maximumFeeWei < 0n) throw new Error("Health Guard signing denied: invalid fee cap");
  const pool = configuredHealthGuardPool(input.config, input.mandate.poolId);
  if (![pool.usdt.toLowerCase(), pool.venusUsdtVToken.toLowerCase()].includes(input.transaction.to.toLowerCase()))
    throw new Error("Health Guard signing denied: target is not an approved USDT or Venus market contract");
  const [address, chainId] = await Promise.all([input.signer.getAddress(), input.signer.getChainId()]);
  if (chainId !== input.config.chainId) throw new Error("Health Guard signing denied: wrong chain");
  if (!sameAddress(address, input.mandate.rescueWallet)) throw new Error("Health Guard signing denied: session differs from buyer rescue wallet");
  if (await input.signer.getNativeBalance(address) < input.config.minimumBnbGasReserveWei + input.transaction.maximumFeeWei)
    throw new Error("Health Guard signing denied: insufficient BNB reserve");
  const simulation = await input.signer.simulate(input.transaction);
  if (!simulation.ok) throw new Error(`Health Guard signing denied: simulation failed${simulation.reason ? ` (${simulation.reason})` : ""}`);
  const hash = await input.signer.send(input.transaction);
  if (!transactionHash.test(hash)) throw new Error("Health Guard signing denied: invalid transaction hash");
  return hash;
}
