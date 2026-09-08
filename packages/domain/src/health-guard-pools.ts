/** Product-facing identifiers only; contract addresses stay in server config. */
export const healthGuardPools = [
  {
    id: "venus-core-pool",
    name: "Venus Core Pool",
    protocol: "Venus",
    network: "BNB Chain",
    debtAsset: "USDT",
    description: "Protects a USDT borrow in the Venus Core Pool. Your collateral markets are discovered from your borrower account.",
  },
] as const;

export type HealthGuardPoolId = (typeof healthGuardPools)[number]["id"];

export function isHealthGuardPoolId(poolId: unknown): poolId is HealthGuardPoolId {
  return typeof poolId === "string" && healthGuardPools.some((pool) => pool.id === poolId);
}

export function healthGuardPoolById(poolId: string) {
  return healthGuardPools.find((pool) => pool.id === poolId) ?? null;
}
