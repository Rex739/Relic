import { createPublicClient, http, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";

export const relicChains = { 56: bsc, 97: bscTestnet } as const;
export type RelicChainId = keyof typeof relicChains;

export function isRelicChainId(chainId: number): chainId is RelicChainId {
  return chainId === 56 || chainId === 97;
}

export function createBscPublicClient(
  chainId: RelicChainId,
  rpcUrl: string,
): PublicClient {
  return createPublicClient({
    chain: relicChains[chainId],
    transport: http(rpcUrl, { retryCount: 3, timeout: 15_000 }),
    batch: { multicall: true },
  });
}
