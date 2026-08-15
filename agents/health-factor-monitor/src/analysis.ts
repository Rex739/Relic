import { z } from "zod";

export const healthFactorInputSchema = z.object({
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  protocol: z.literal("venus-core"),
  chainId: z.union([z.literal(56), z.literal(97)]),
  warningThresholdRaw: z.string().regex(/^\d+$/).optional(),
});
export type HealthFactorInput = z.infer<typeof healthFactorInputSchema>;

export interface MarketSnapshot {
  market: `0x${string}`;
  symbol: string;
  vTokenBalanceRaw: string;
  borrowBalanceRaw: string;
  exchangeRateRaw: string;
}

export interface PositionSnapshot {
  source: "onchain" | "fixture";
  chainId: 56 | 97;
  protocol: "venus-core";
  blockNumber: string;
  comptroller: `0x${string}`;
  errorCode: string;
  liquidityRaw: string;
  shortfallRaw: string;
  markets: MarketSnapshot[];
}

export interface PositionReader {
  read(input: HealthFactorInput): Promise<PositionSnapshot>;
}

export interface HealthFactorAnalysis {
  schemaVersion: "1.0";
  source: "onchain" | "fixture";
  readOnly: true;
  account: string;
  protocol: "venus-core";
  chainId: 56 | 97;
  observedBlock: string;
  metric: {
    kind: "venus-account-liquidity";
    healthFactor: null;
    liquidityRaw: string;
    shortfallRaw: string;
    unit: "protocol-oracle-mantissa";
  };
  riskLevel: "none" | "watch" | "critical";
  liquidationBufferRaw: string;
  collateral: Array<{
    market: string;
    symbol: string;
    suppliedVTokensRaw: string;
    exchangeRateRaw: string;
  }>;
  borrowing: Array<{ market: string; symbol: string; borrowedRaw: string }>;
  riskFactors: string[];
  recommendedMitigation: string[];
  evidence: { comptroller: string; errorCode: string };
}

export async function analyzePosition(
  rawInput: unknown,
  reader: PositionReader,
): Promise<HealthFactorAnalysis> {
  const input = healthFactorInputSchema.parse(rawInput);
  const snapshot = await reader.read(input);
  if (
    snapshot.chainId !== input.chainId ||
    snapshot.protocol !== input.protocol
  )
    throw new Error("Position reader returned evidence for a different target");
  if (snapshot.errorCode !== "0")
    throw new Error(
      `Venus account-liquidity call returned error ${snapshot.errorCode}`,
    );

  const liquidity = BigInt(snapshot.liquidityRaw);
  const shortfall = BigInt(snapshot.shortfallRaw);
  const threshold = BigInt(input.warningThresholdRaw ?? "0");
  const hasBorrow = snapshot.markets.some(
    (market) => BigInt(market.borrowBalanceRaw) > 0n,
  );
  const riskLevel =
    shortfall > 0n
      ? "critical"
      : hasBorrow && liquidity <= threshold
        ? "watch"
        : "none";
  const riskFactors: string[] = [];
  const recommendedMitigation: string[] = [];
  if (shortfall > 0n) {
    riskFactors.push(
      "Venus reports an account shortfall at the observed block.",
    );
    recommendedMitigation.push(
      "Review the position and consider adding collateral or repaying debt manually.",
    );
  } else if (riskLevel === "watch") {
    riskFactors.push(
      "Liquidation liquidity buffer is at or below the requested threshold.",
    );
    recommendedMitigation.push(
      "Monitor market prices and evaluate a manual collateral or debt adjustment.",
    );
  }
  if (!hasBorrow)
    riskFactors.push(
      "No borrow balance was observed in entered Venus markets.",
    );

  return {
    schemaVersion: "1.0",
    source: snapshot.source,
    readOnly: true,
    account: input.account.toLowerCase(),
    protocol: input.protocol,
    chainId: input.chainId,
    observedBlock: snapshot.blockNumber,
    metric: {
      kind: "venus-account-liquidity",
      healthFactor: null,
      liquidityRaw: snapshot.liquidityRaw,
      shortfallRaw: snapshot.shortfallRaw,
      unit: "protocol-oracle-mantissa",
    },
    riskLevel,
    liquidationBufferRaw: snapshot.liquidityRaw,
    collateral: snapshot.markets
      .filter((market) => BigInt(market.vTokenBalanceRaw) > 0n)
      .map((market) => ({
        market: market.market,
        symbol: market.symbol,
        suppliedVTokensRaw: market.vTokenBalanceRaw,
        exchangeRateRaw: market.exchangeRateRaw,
      })),
    borrowing: snapshot.markets
      .filter((market) => BigInt(market.borrowBalanceRaw) > 0n)
      .map((market) => ({
        market: market.market,
        symbol: market.symbol,
        borrowedRaw: market.borrowBalanceRaw,
      })),
    riskFactors,
    recommendedMitigation,
    evidence: {
      comptroller: snapshot.comptroller,
      errorCode: snapshot.errorCode,
    },
  };
}
