import type { Address } from "viem";

export type GridRuntimeConfig = Readonly<{
  chainId: 97;
  rpcUrl: string;
  usdt: Address;
  wrappedBnb: Address;
  router: Address;
  pool: Address;
  fee: number;
  usdtDecimals: number;
  maximumJobAmountBaseUnits: bigint;
  minimumBnbGasReserveWei: bigint;
}>;

const address = /^0x[0-9a-fA-F]{40}$/u;
const integer = /^\d+$/u;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Grid Trader configuration is missing ${name}`);
  return value;
}
function asAddress(env: NodeJS.ProcessEnv, name: string): Address {
  const value = required(env, name);
  if (!address.test(value)) throw new Error(`Grid Trader configuration has invalid ${name}`);
  return value as Address;
}
function positive(env: NodeJS.ProcessEnv, name: string): bigint {
  const value = required(env, name);
  if (!integer.test(value) || BigInt(value) <= 0n) throw new Error(`Grid Trader configuration has invalid ${name}`);
  return BigInt(value);
}

/** No contract address has a code default. Mainnet will use a different,
 * explicitly reviewed deployment and never inherits this Testnet config. */
export function loadGridRuntimeConfig(env: NodeJS.ProcessEnv = process.env): GridRuntimeConfig {
  if (Number(required(env, "CHAIN_ID")) !== 97) throw new Error("Grid Trader only permits BSC Testnet (chain ID 97)");
  const rpcUrl = required(env, "BSC_TESTNET_RPC_URL");
  if (!/^https:\/\//u.test(rpcUrl)) throw new Error("Grid Trader requires an HTTPS BSC_TESTNET_RPC_URL");
  const fee = Number(required(env, "GRID_TESTNET_POOL_FEE"));
  const decimals = Number(required(env, "GRID_TESTNET_USDT_DECIMALS"));
  if (!Number.isInteger(fee) || fee < 1 || fee >= 1_000_000) throw new Error("Grid Trader configuration has invalid GRID_TESTNET_POOL_FEE");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Grid Trader configuration has invalid GRID_TESTNET_USDT_DECIMALS");
  return Object.freeze({
    chainId: 97,
    rpcUrl,
    usdt: asAddress(env, "GRID_TESTNET_USDT"),
    wrappedBnb: asAddress(env, "GRID_TESTNET_WBNB"),
    router: asAddress(env, "GRID_TESTNET_SWAP_ROUTER"),
    pool: asAddress(env, "GRID_TESTNET_POOL"),
    fee,
    usdtDecimals: decimals,
    maximumJobAmountBaseUnits: positive(env, "MAX_GRID_JOB_AMOUNT_BASE_UNITS"),
    minimumBnbGasReserveWei: positive(env, "MINIMUM_BNB_GAS_RESERVE_WEI"),
  });
}
