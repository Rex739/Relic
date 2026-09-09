import { type Address, type VenusConfig, networkLabel } from "./networkConfig.js";

/** Minimal RPC surface. The live adapter is deliberately separate from policy. */
export interface VenusReadClient {
  getChainId(): Promise<number>;
  getCode(address: Address): Promise<`0x${string}`>;
  getTokenMetadata(address: Address): Promise<{ symbol: string; decimals: number }>;
  getTokenBalance(token: Address, account: Address): Promise<bigint>;
  getVTokenUnderlying(vToken: Address): Promise<Address>;
  getVTokenComptroller(vToken: Address): Promise<Address>;
}

export type VerifiedVenusDeployment = Readonly<{
  verifiedAt: Date;
  chainId: VenusConfig["chainId"];
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
  config: VenusConfig,
  now = new Date(),
): Promise<VerifiedVenusDeployment> {
  if ((await client.getChainId()) !== config.chainId)
    fail(`RPC is not ${networkLabel(config.chainId)}`);

  for (const [label, address] of [
    ["USDT", config.usdt],
    ["Venus Comptroller", config.venusComptroller],
    ["Venus USDT market", config.venusUsdtVToken],
  ] as const) {
    if ((await client.getCode(address)) === "0x") fail(`${label} has no deployed code`);
  }

  const [metadata, cash, underlying, comptroller] = await Promise.all([
    client.getTokenMetadata(config.usdt),
    client.getTokenBalance(config.usdt, config.venusUsdtVToken),
    client.getVTokenUnderlying(config.venusUsdtVToken),
    client.getVTokenComptroller(config.venusUsdtVToken),
  ]);
  if (metadata.decimals !== config.usdtDecimals)
    fail("configured USDT decimals do not match the contract");
  if (!metadata.symbol.trim()) fail("USDT contract returned an empty symbol");
  if (!sameAddress(underlying, config.usdt)) fail("Venus market underlying is not configured USDT");
  if (!sameAddress(comptroller, config.venusComptroller)) fail("Venus market Comptroller mismatch");
  if (cash < 0n) fail("USDT market balance is invalid");

  return Object.freeze({
    verifiedAt: now,
    chainId: config.chainId,
    usdtSymbol: metadata.symbol,
    usdtDecimals: metadata.decimals,
    withdrawableCashBaseUnits: cash,
  });
}
