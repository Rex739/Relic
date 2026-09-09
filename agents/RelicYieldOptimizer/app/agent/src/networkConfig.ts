/**
 * Fail-closed configuration for the executable Yield Optimizer.
 *
 * Contract addresses deliberately have no source-code defaults: deployment
 * must inject addresses which were independently verified from the protocol's
 * official deployment record and against the selected RPC.
 */
export const BSC_MAINNET_CHAIN_ID = 56;
export const BSC_TESTNET_CHAIN_ID = 97;

export type SupportedBscChainId = typeof BSC_MAINNET_CHAIN_ID | typeof BSC_TESTNET_CHAIN_ID;
export type YieldNetwork = "bsc-mainnet" | "bsc-testnet";
export type Address = `0x${string}`;

export type VenusConfig = Readonly<{
  chainId: SupportedBscChainId;
  /** Present on deployment-loaded configuration; optional for legacy test fixtures. */
  network?: YieldNetwork;
  rpcUrl: string;
  usdt: Address;
  venusComptroller: Address;
  venusUsdtVToken: Address;
  usdtDecimals: number;
  maxJobAmountBaseUnits: bigint;
  minimumBnbGasReserveWei: bigint;
}>;

/** @deprecated Use VenusConfig. Retained for testnet integration compatibility. */
export type VenusTestnetConfig = VenusConfig;

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

export function networkLabel(chainId: SupportedBscChainId): string {
  return chainId === BSC_MAINNET_CHAIN_ID ? "BSC Mainnet" : "BSC Testnet";
}

/**
 * Selects one namespace only. Mainnet never falls back to testnet values and
 * requires a deliberate opt-in, so a copied testnet deployment cannot spend
 * mainnet funds by accident.
 */
export function loadVenusConfig(env: NodeJS.ProcessEnv = process.env): VenusConfig {
  const requestedNetwork = env.RELIC_YIELD_NETWORK?.trim() || "bsc-testnet";
  if (requestedNetwork !== "bsc-testnet" && requestedNetwork !== "bsc-mainnet")
    throw new Error("RELIC_YIELD_NETWORK must be bsc-testnet or bsc-mainnet");

  const mainnet = requestedNetwork === "bsc-mainnet";
  if (mainnet && env.RELIC_YIELD_MAINNET_ENABLED !== "true")
    throw new Error("BSC Mainnet is disabled; set RELIC_YIELD_MAINNET_ENABLED=true explicitly");

  const expectedChainId = mainnet ? BSC_MAINNET_CHAIN_ID : BSC_TESTNET_CHAIN_ID;
  const chainId = Number(requireEnv(env, "CHAIN_ID"));
  if (chainId !== expectedChainId)
    throw new Error(`Yield Optimizer ${requestedNetwork} requires CHAIN_ID=${String(expectedChainId)}`);

  const prefix = mainnet ? "MAINNET" : "TESTNET";
  const rpcName = `BSC_${prefix}_RPC_URL`;
  const rpcUrl = requireEnv(env, rpcName);
  if (!/^https:\/\//u.test(rpcUrl)) {
    throw new Error(`Yield Optimizer requires an HTTPS ${rpcName}`);
  }

  return Object.freeze({
    chainId: expectedChainId,
    network: requestedNetwork,
    rpcUrl,
    usdt: requireAddress(env, `VENUS_${prefix}_USDT`),
    venusComptroller: requireAddress(env, `VENUS_${prefix}_COMPTROLLER`),
    venusUsdtVToken: requireAddress(env, `VENUS_${prefix}_USDT_VTOKEN`),
    usdtDecimals: requireDecimals(env, `VENUS_${prefix}_USDT_DECIMALS`),
    maxJobAmountBaseUnits: requirePositiveInteger(env, "MAX_JOB_AMOUNT_BASE_UNITS"),
    minimumBnbGasReserveWei: requirePositiveInteger(env, "MINIMUM_BNB_GAS_RESERVE_WEI"),
  });
}

/** @deprecated Use loadVenusConfig. Testnet-only name retained for callers. */
export function loadVenusTestnetConfig(env: NodeJS.ProcessEnv = process.env): VenusConfig {
  return loadVenusConfig(env);
}
