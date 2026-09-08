import type { Address } from "viem";

export type HealthGuardPool = Readonly<{
  id: string;
  name: string;
  protocol: string;
  network: string;
  debtAsset: string;
  debtAssetAddress: Address;
  debtVTokenAddress: Address;
  comptrollerAddress: Address;
  debtAssetDecimals: number;
}>;

export type HealthGuardPoolRegistry = ReadonlyMap<string, HealthGuardPool>;
const address = /^0x[a-fA-F0-9]{40}$/u;
const id = /^[a-z0-9][a-z0-9-]{1,79}$/u;
const text = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Health Guard pool registry has invalid ${field}`);
  return value.trim();
};
const asAddress = (value: unknown, field: string): Address => {
  const result = text(value, field);
  if (!address.test(result)) throw new Error(`Health Guard pool registry has invalid ${field}`);
  return result as Address;
};

/** Server-only registry; contract addresses are never sent to marketplace clients. */
export function parseHealthGuardPoolRegistry(raw: string | undefined): HealthGuardPoolRegistry | undefined {
  if (raw === undefined || !raw.trim()) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("HEALTH_GUARD_POOLS_JSON is invalid JSON"); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("HEALTH_GUARD_POOLS_JSON must contain at least one pool");
  const pools = new Map<string, HealthGuardPool>();
  for (const value of parsed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Health Guard pool registry entries must be objects");
    const input = value as Record<string, unknown>;
    const poolId = text(input.id, "id");
    if (!id.test(poolId) || pools.has(poolId)) throw new Error("Health Guard pool registry has an invalid or duplicate id");
    pools.set(poolId, Object.freeze({
      id: poolId,
      name: text(input.name, "name"),
      protocol: text(input.protocol, "protocol"),
      network: text(input.network, "network"),
      debtAsset: text(input.debtAsset, "debtAsset"),
      debtAssetAddress: asAddress(input.debtAssetAddress, "debtAssetAddress"),
      debtVTokenAddress: asAddress(input.debtVTokenAddress, "debtVTokenAddress"),
      comptrollerAddress: asAddress(input.comptrollerAddress, "comptrollerAddress"),
      debtAssetDecimals: typeof input.debtAssetDecimals === "number" && Number.isInteger(input.debtAssetDecimals) && input.debtAssetDecimals >= 0 && input.debtAssetDecimals <= 36
        ? input.debtAssetDecimals : (() => { throw new Error("Health Guard pool registry has invalid debtAssetDecimals"); })(),
    }));
  }
  return pools;
}

export function healthGuardPool(registry: HealthGuardPoolRegistry, poolId: unknown): HealthGuardPool {
  if (typeof poolId !== "string") throw new Error("Choose a verified Venus pool");
  const pool = registry.get(poolId);
  if (!pool) throw new Error("Choose a verified Venus pool");
  return pool;
}
