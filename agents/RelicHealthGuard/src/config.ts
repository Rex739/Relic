export const BSC_MAINNET_CHAIN_ID = 56;
export type Address = `0x${string}`;

export type HealthGuardConfig = Readonly<{
  chainId: typeof BSC_MAINNET_CHAIN_ID;
  rpcUrl: string;
  usdt: Address;
  venusUsdtVToken: Address;
  venusComptroller: Address;
  usdtDecimals: number;
  maxRepayBaseUnits: bigint;
  minimumBnbGasReserveWei: bigint;
  executionEnabled: boolean;
}>;

const address = /^0x[0-9a-fA-F]{40}$/u;
const positive = /^[1-9]\d*$/u;
const required = (env: NodeJS.ProcessEnv, key: string) => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Health Guard configuration is missing ${key}`);
  return value;
};
const requiredAddress = (env: NodeJS.ProcessEnv, key: string): Address => {
  const value = required(env, key);
  if (!address.test(value)) throw new Error(`Health Guard configuration has invalid ${key}`);
  return value as Address;
};
const requiredPositive = (env: NodeJS.ProcessEnv, key: string) => {
  const value = required(env, key);
  if (!positive.test(value)) throw new Error(`Health Guard configuration has invalid ${key}`);
  return BigInt(value);
};

/** Mainnet configuration is fail-closed and deliberately has no address defaults. */
export function loadHealthGuardConfig(env: NodeJS.ProcessEnv = process.env): HealthGuardConfig {
  if (Number(required(env, "CHAIN_ID")) !== BSC_MAINNET_CHAIN_ID)
    throw new Error("Health Guard only permits BSC Mainnet (chain ID 56)");
  const rpcUrl = required(env, "BSC_MAINNET_RPC_URL");
  if (!/^https:\/\//u.test(rpcUrl)) throw new Error("Health Guard requires HTTPS BSC_MAINNET_RPC_URL");
  const decimals = Number(required(env, "USDT_DECIMALS"));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error("Health Guard configuration has invalid USDT_DECIMALS");
  const enabled = env.EXECUTION_ENABLED?.trim() === "true";
  return Object.freeze({
    chainId: BSC_MAINNET_CHAIN_ID,
    rpcUrl,
    usdt: requiredAddress(env, "VENUS_USDT"),
    venusUsdtVToken: requiredAddress(env, "VENUS_USDT_VTOKEN"),
    venusComptroller: requiredAddress(env, "VENUS_COMPTROLLER"),
    usdtDecimals: decimals,
    maxRepayBaseUnits: requiredPositive(env, "MAX_REPAY_BASE_UNITS"),
    minimumBnbGasReserveWei: requiredPositive(env, "MINIMUM_BNB_GAS_RESERVE_WEI"),
    executionEnabled: enabled,
  });
}
