/**
 * Fail-closed BSC Testnet configuration for the executable Yield Optimizer.
 *
 * Contract addresses deliberately have no source-code defaults: deployment
 * must inject addresses which were independently verified from the protocol's
 * official deployment record and against the selected RPC.
 */
export const BSC_TESTNET_CHAIN_ID = 97;

export type Address = `0x${string}`;

export type VenusTestnetConfig = Readonly<{
  chainId: typeof BSC_TESTNET_CHAIN_ID;
  rpcUrl: string;
  usdt: Address;
  venusComptroller: Address;
  venusUsdtVToken: Address;
  usdtDecimals: number;
  maxJobAmountBaseUnits: bigint;
  minimumBnbGasReserveWei: bigint;
}>;

const address = /^0x[0-9a-fA-F]{40}$/u;
const integer = /^\d+$/u;

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Yield Optimizer configuration is missing ${name}`);
  return value;
}

function requireAddress(env: NodeJS.ProcessEnv, name: string): Address {
  const value = requireEnv(env, name);
  if (!address.test(value)) throw new Error(`Yield Optimizer configuration has invalid ${name}`);
  return value as Address;
}

function requirePositiveInteger(env: NodeJS.ProcessEnv, name: string): bigint {
  const value = requireEnv(env, name);
  if (!integer.test(value) || BigInt(value) <= 0n)
    throw new Error(`Yield Optimizer configuration has invalid ${name}`);
  return BigInt(value);
}

function requireDecimals(env: NodeJS.ProcessEnv, name: string): number {
  const value = requireEnv(env, name);
  if (!/^(?:0|[1-9]\d?)$/u.test(value) || Number(value) > 36)
    throw new Error(`Yield Optimizer configuration has invalid ${name}`);
  return Number(value);
}

export function loadVenusTestnetConfig(
  env: NodeJS.ProcessEnv = process.env,
): VenusTestnetConfig {
  const chainId = Number(requireEnv(env, "CHAIN_ID"));
  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error("Yield Optimizer only permits BSC Testnet (chain ID 97)");
  }

  const rpcUrl = requireEnv(env, "BSC_TESTNET_RPC_URL");
  if (!/^https:\/\//u.test(rpcUrl)) {
    throw new Error("Yield Optimizer requires an HTTPS BSC_TESTNET_RPC_URL");
  }

  return Object.freeze({
    chainId: BSC_TESTNET_CHAIN_ID,
    rpcUrl,
    usdt: requireAddress(env, "VENUS_TESTNET_USDT"),
    venusComptroller: requireAddress(env, "VENUS_TESTNET_COMPTROLLER"),
    venusUsdtVToken: requireAddress(env, "VENUS_TESTNET_USDT_VTOKEN"),
    usdtDecimals: requireDecimals(env, "VENUS_TESTNET_USDT_DECIMALS"),
    maxJobAmountBaseUnits: requirePositiveInteger(env, "MAX_JOB_AMOUNT_BASE_UNITS"),
    minimumBnbGasReserveWei: requirePositiveInteger(env, "MINIMUM_BNB_GAS_RESERVE_WEI"),
  });
}
