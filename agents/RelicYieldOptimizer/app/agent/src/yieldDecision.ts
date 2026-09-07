/** Deterministic migration decision. Values are basis points, not floats. */
export type YieldSnapshot = Readonly<{
  observedAt: Date;
  supplyApyBps: bigint;
  availableLiquidityBaseUnits: bigint;
}>;

export type MigrationDecision =
  | Readonly<{ action: "hold"; reason: string; netAdvantageBps: bigint }>
  | Readonly<{ action: "migrate"; reason: string; netAdvantageBps: bigint }>;

export function decideMigration(input: {
  source: YieldSnapshot;
  target: YieldSnapshot;
  amountBaseUnits: bigint;
  estimatedCostBps: bigint;
  minimumAdvantageBps: bigint;
  maxObservationAgeSeconds: number;
  now?: Date;
}): MigrationDecision {
  const now = input.now ?? new Date();
  if (input.amountBaseUnits <= 0n) throw new Error("migration amount must be positive");
  if (input.target.availableLiquidityBaseUnits < input.amountBaseUnits)
    return { action: "hold", reason: "target liquidity is insufficient", netAdvantageBps: 0n };
  const oldest = Math.min(input.source.observedAt.getTime(), input.target.observedAt.getTime());
  if (now.getTime() - oldest > input.maxObservationAgeSeconds * 1_000)
    return { action: "hold", reason: "yield evidence is stale", netAdvantageBps: 0n };
  const netAdvantageBps = input.target.supplyApyBps - input.source.supplyApyBps - input.estimatedCostBps;
  return netAdvantageBps >= input.minimumAdvantageBps
    ? { action: "migrate", reason: "net yield threshold met", netAdvantageBps }
    : { action: "hold", reason: "net yield threshold not met", netAdvantageBps };
}
