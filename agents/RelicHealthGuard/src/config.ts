export const BSC_MAINNET_CHAIN_ID = 56;
export type Address = `0x${string}`;

/** One independently verified debt market a Health Guard job may operate in. */
export type HealthGuardPoolConfig = Readonly<{
  id: string;
  name: string;
  protocol: string;
  network: string;
  debtAsset: string;
  usdt: Address;
  venusUsdtVToken: Address;
  venusComptroller: Address;
  usdtDecimals: number;
}>;

export type HealthGuardConfig = Readonly<{
  chainId: typeof BSC_MAINNET_CHAIN_ID;
  rpcUrl: string;
  pools: ReadonlyMap<string, HealthGuardPoolConfig>;
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
const requiredPositive = (env: NodeJS.ProcessEnv, key: string) => {
  const value = required(env, key);
  if (!positive.test(value)) throw new Error(`Health Guard configuration has invalid ${key}`);
  return BigInt(value);
};

const requiredText = (value: unknown, name: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Health Guard pool configuration has invalid ${name}`);
  return value.trim();
};
const poolAddress = (value: unknown, name: string): Address => {
  const output = requiredText(value, name);
  if (!address.test(output)) throw new Error(`Health Guard pool configuration has invalid ${name}`);
  return output as Address;
};
const poolDecimals = (value: unknown) => {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value > 36)
    throw new Error("Health Guard pool configuration has invalid debtAssetDecimals");
  return value;
};

/**
 * Parses the deployment-owned pool registry. Address values never have source
 * defaults: a pool is usable only after this config and its on-chain audit pass.
 */
export function loadHealthGuardPools(env: NodeJS.ProcessEnv = process.env): ReadonlyMap<string, HealthGuardPoolConfig> {
  const raw = required(env, "HEALTH_GUARD_POOLS_JSON");
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error("Health Guard configuration has invalid HEALTH_GUARD_POOLS_JSON"); }
  if (!Array.isArray(values) || values.length === 0) throw new Error("Health Guard configuration requires at least one pool");
  const pools = new Map<string, HealthGuardPoolConfig>();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Health Guard pool configuration must contain objects");
    const input = value as Record<string, unknown>;
    const id = requiredText(input.id, "id");
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/u.test(id)) throw new Error("Health Guard pool configuration has invalid id");
    if (pools.has(id)) throw new Error(`Health Guard pool configuration has duplicate id ${id}`);
    pools.set(id, Object.freeze({
      id,
      name: requiredText(input.name, "name"),
      protocol: requiredText(input.protocol, "protocol"),
      network: requiredText(input.network, "network"),
      debtAsset: requiredText(input.debtAsset, "debtAsset"),
      usdt: poolAddress(input.debtAssetAddress, "debtAssetAddress"),
      venusUsdtVToken: poolAddress(input.debtVTokenAddress, "debtVTokenAddress"),
      venusComptroller: poolAddress(input.comptrollerAddress, "comptrollerAddress"),
      usdtDecimals: poolDecimals(input.debtAssetDecimals),
    }));
  }
  return pools;
}

export function configuredHealthGuardPool(config: HealthGuardConfig, poolId: string): HealthGuardPoolConfig {
  const pool = config.pools.get(poolId);
  if (!pool) throw new Error(`Health Guard pool is not configured: ${poolId}`);
  return pool;
}

/** Mainnet configuration is fail-closed and deliberately has no address defaults. */
export function loadHealthGuardConfig(env: NodeJS.ProcessEnv = process.env): HealthGuardConfig {
  if (Number(required(env, "CHAIN_ID")) !== BSC_MAINNET_CHAIN_ID)
    throw new Error("Health Guard only permits BSC Mainnet (chain ID 56)");
  const rpcUrl = required(env, "BSC_MAINNET_RPC_URL");
  if (!/^https:\/\//u.test(rpcUrl)) throw new Error("Health Guard requires HTTPS BSC_MAINNET_RPC_URL");
  const enabled = env.EXECUTION_ENABLED?.trim() === "true";
  return Object.freeze({
    chainId: BSC_MAINNET_CHAIN_ID,
    rpcUrl,
    pools: loadHealthGuardPools(env),
    maxRepayBaseUnits: requiredPositive(env, "MAX_REPAY_BASE_UNITS"),
    minimumBnbGasReserveWei: requiredPositive(env, "MINIMUM_BNB_GAS_RESERVE_WEI"),
    executionEnabled: enabled,
  });
}
