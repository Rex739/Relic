import {
  BSC_TESTNET_CHAIN_ID,
  type Address,
  type VenusTestnetConfig,
} from "./networkConfig.js";

/** Minimal RPC surface. The live adapter is deliberately separate from policy. */
export interface VenusReadClient {
  getChainId(): Promise<number>;
  getCode(address: Address): Promise<`0x${string}`>;
  getTokenMetadata(address: Address): Promise<{ symbol: string; decimals: number }>;
  getVTokenUnderlying(vToken: Address): Promise<Address>;
  getVTokenComptroller(vToken: Address): Promise<Address>;
  getVTokenCash(vToken: Address): Promise<bigint>;
}

export type VerifiedVenusDeployment = Readonly<{
  verifiedAt: Date;
  chainId: typeof BSC_TESTNET_CHAIN_ID;
  usdtSymbol: string;
  usdtDecimals: number;
  withdrawableCashBaseUnits: bigint;
}>;

const sameAddress = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

const fail = (reason: string): never => {
  throw new Error(`Venus deployment verification failed: ${reason}`);
};

/**
 * Performs the checks that must succeed before Layer A advertises readiness.
 * It checks actual contract relationships, not merely that configured strings
 * look like addresses.
 */
export async function verifyVenusDeployment(
  client: VenusReadClient,
  config: VenusTestnetConfig,
  now = new Date(),
): Promise<VerifiedVenusDeployment> {
  if ((await client.getChainId()) !== BSC_TESTNET_CHAIN_ID) fail("RPC is not BSC Testnet");

  for (const [label, address] of [
    ["USDT", config.usdt],
    ["Venus Comptroller", config.venusComptroller],
    ["Venus USDT market", config.venusUsdtVToken],
  ] as const) {
    if ((await client.getCode(address)) === "0x") fail(`${label} has no deployed code`);
  }

  const [metadata, underlying, comptroller, cash] = await Promise.all([
    client.getTokenMetadata(config.usdt),
    client.getVTokenUnderlying(config.venusUsdtVToken),
    client.getVTokenComptroller(config.venusUsdtVToken),
    client.getVTokenCash(config.venusUsdtVToken),
  ]);
  if (metadata.decimals !== config.usdtDecimals)
    fail("configured USDT decimals do not match the contract");
  if (!metadata.symbol.trim()) fail("USDT contract returned an empty symbol");
  if (!sameAddress(underlying, config.usdt)) fail("Venus market underlying is not configured USDT");
  if (!sameAddress(comptroller, config.venusComptroller)) fail("Venus market Comptroller mismatch");
  if (cash < 0n) fail("Venus market returned invalid cash");

  return Object.freeze({
    verifiedAt: now,
    chainId: BSC_TESTNET_CHAIN_ID,
    usdtSymbol: metadata.symbol,
    usdtDecimals: metadata.decimals,
    withdrawableCashBaseUnits: cash,
  });
}
