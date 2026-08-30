import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { bscTestnet } from "viem/chains";

export const CHAIN_ID = 97;
export const PROTOCOL = "venus-core";
export const DEFAULT_COMPTROLLER = getAddress(
  "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D",
);
const RATE_SCALE = 1e18;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const BLOCK_SAMPLE_SIZE = 120n;

const comptrollerAbi = [
  {
    type: "function",
    name: "getAllMarkets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const;

const vTokenAbi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "supplyRatePerBlock",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getCash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalBorrows",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface MarketResult {
  address: Address;
  symbol: string;
  supplyRatePerBlockRaw: string;
  estimatedSupplyApyPercent: string;
  cashRaw: string;
  totalBorrowsRaw: string;
  totalReservesRaw: string;
  utilizationPercent: string | null;
}

export interface YieldObservation {
  source: "onchain";
  readOnly: true;
  protocol: typeof PROTOCOL;
  chainId: typeof CHAIN_ID;
  blockNumber: string;
  blockTimestamp: string;
  comptroller: Address;
  recentAverageBlockSeconds: string;
  rankingMethod: string;
  markets: MarketResult[];
  marketReadFailures: Array<{ address: Address; error: string }>;
  limitations: string[];
}

function fixed(value: number, places = 6): string {
  return value.toFixed(places);
}

export function supplyApyPercent(
  rateRaw: bigint,
  secondsPerBlock: number,
): number {
  if (rateRaw < 0n) throw new Error("supply rate cannot be negative");
  if (!Number.isFinite(secondsPerBlock) || secondsPerBlock <= 0) {
    throw new Error("secondsPerBlock must be positive");
  }
  const rate = Number(rateRaw) / RATE_SCALE;
  const exponent = Math.log1p(rate) * (SECONDS_PER_YEAR / secondsPerBlock);
  if (exponent > 50) throw new Error("derived APY is outside the supported range");
  return Math.expm1(exponent) * 100;
}

export function utilizationPercent(
  cashRaw: bigint,
  borrowsRaw: bigint,
  reservesRaw: bigint,
): number | null {
  const denominator = cashRaw + borrowsRaw - reservesRaw;
  if (denominator <= 0n) return null;
  return (Number(borrowsRaw) / Number(denominator)) * 100;
}

export function buildMarketResult(input: {
  address: Address;
  symbol: string;
  supplyRateRaw: bigint;
  cashRaw: bigint;
  borrowsRaw: bigint;
  reservesRaw: bigint;
  secondsPerBlock: number;
}): MarketResult {
  const utilization = utilizationPercent(
    input.cashRaw,
    input.borrowsRaw,
    input.reservesRaw,
  );
  return {
    address: getAddress(input.address),
    symbol: input.symbol,
    supplyRatePerBlockRaw: input.supplyRateRaw.toString(),
    estimatedSupplyApyPercent: fixed(
      supplyApyPercent(input.supplyRateRaw, input.secondsPerBlock),
    ),
    cashRaw: input.cashRaw.toString(),
    totalBorrowsRaw: input.borrowsRaw.toString(),
    totalReservesRaw: input.reservesRaw.toString(),
    utilizationPercent: utilization === null ? null : fixed(utilization),
  };
}

async function marketAtBlock(
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
  secondsPerBlock: number,
): Promise<MarketResult> {
  const read = <TName extends "symbol" | "supplyRatePerBlock" | "getCash" | "totalBorrows" | "totalReserves">(
    functionName: TName,
  ) =>
    client.readContract({
      address,
      abi: vTokenAbi,
      functionName,
      blockNumber,
    });
  const [symbol, supplyRateRaw, cashRaw, borrowsRaw, reservesRaw] =
    await Promise.all([
      read("symbol"),
      read("supplyRatePerBlock"),
      read("getCash"),
      read("totalBorrows"),
      read("totalReserves"),
    ]);
  return buildMarketResult({
    address,
    symbol: String(symbol),
    supplyRateRaw: supplyRateRaw as bigint,
    cashRaw: cashRaw as bigint,
    borrowsRaw: borrowsRaw as bigint,
    reservesRaw: reservesRaw as bigint,
    secondsPerBlock,
  });
}

export async function scanVenusYields(
  topN = 8,
  abortSignal?: AbortSignal,
): Promise<YieldObservation> {
  const rpcUrl =
    process.env.RPC_URL_BSC_TESTNET?.trim() ||
    process.env.BSC_TESTNET_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error("RPC_URL_BSC_TESTNET or BSC_TESTNET_RPC_URL is required");
  }
  if (abortSignal?.aborted) throw new Error("yield observation aborted");
  const limit = Math.max(1, Math.min(Math.trunc(topN), 20));
  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl, { timeout: 20_000 }),
  });
  const observedChainId = await client.getChainId();
  if (observedChainId !== CHAIN_ID) {
    throw new Error(
      `RPC chain mismatch: expected ${CHAIN_ID}, observed ${observedChainId}`,
    );
  }

  const blockNumber = await client.getBlockNumber();
  const sampleNumber =
    blockNumber > BLOCK_SAMPLE_SIZE ? blockNumber - BLOCK_SAMPLE_SIZE : 0n;
  const [block, sample] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.getBlock({ blockNumber: sampleNumber }),
  ]);
  const elapsed = Number(block.timestamp - sample.timestamp);
  const blockDelta = Number(blockNumber - sampleNumber);
  if (elapsed <= 0 || blockDelta <= 0) {
    throw new Error("could not derive the recent BSC block interval");
  }
  const secondsPerBlock = elapsed / blockDelta;
  const comptroller = getAddress(
    process.env.VENUS_BSC_TESTNET_COMPTROLLER?.trim() || DEFAULT_COMPTROLLER,
  );
  const marketAddresses = await client.readContract({
    address: comptroller,
    abi: comptrollerAbi,
    functionName: "getAllMarkets",
    blockNumber,
  });

  const markets: MarketResult[] = [];
  const marketReadFailures: YieldObservation["marketReadFailures"] = [];
  for (let index = 0; index < marketAddresses.length; index += 6) {
    if (abortSignal?.aborted) throw new Error("yield observation aborted");
    const batch = marketAddresses.slice(index, index + 6);
    const results = await Promise.allSettled(
      batch.map((address) =>
        marketAtBlock(client, getAddress(address), blockNumber, secondsPerBlock),
      ),
    );
    results.forEach((result, resultIndex) => {
      const address = getAddress(batch[resultIndex] as Address);
      if (result.status === "fulfilled") markets.push(result.value);
      else {
        const message =
          result.reason instanceof Error
            ? `${result.reason.name}: ${result.reason.message}`
            : String(result.reason);
        marketReadFailures.push({ address, error: message });
      }
    });
  }

  markets.sort(
    (left, right) =>
      Number(right.estimatedSupplyApyPercent) -
      Number(left.estimatedSupplyApyPercent),
  );
  marketReadFailures.sort((left, right) =>
    left.address.toLowerCase().localeCompare(right.address.toLowerCase()),
  );
  return {
    source: "onchain",
    readOnly: true,
    protocol: PROTOCOL,
    chainId: CHAIN_ID,
    blockNumber: blockNumber.toString(),
    blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    comptroller,
    recentAverageBlockSeconds: fixed(secondsPerBlock, 4),
    rankingMethod: "estimated supply APY, descending",
    markets: markets.slice(0, limit),
    marketReadFailures,
    limitations: [
      "APY is estimated from each market's on-chain per-block supply rate and the recent observed block interval.",
      "Raw liquidity values are not converted to fiat prices and are not directly comparable across token decimals.",
      "This observation is informational and does not move funds or submit DeFi transactions.",
    ],
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function renderYieldReport(observation: YieldObservation): string {
  return JSON.stringify(canonical(observation));
}
