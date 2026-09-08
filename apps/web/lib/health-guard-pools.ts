/** Public metadata derived from the server-only Health Guard pool registry. */
export type HealthGuardPoolOption = Readonly<{
  id: string;
  name: string;
  protocol: string;
  network: string;
  debtAsset: string;
  description: string;
}>;

type PrivatePool = HealthGuardPoolOption & Readonly<{
  debtAssetDecimals: number;
  debtAssetAddress: `0x${string}`;
  debtVTokenAddress: `0x${string}`;
  comptrollerAddress: `0x${string}`;
}>;
const address = /^0x[a-fA-F0-9]{40}$/u;
const id = /^[a-z0-9][a-z0-9-]{1,79}$/u;
const text = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Health Guard pool registry has invalid ${field}`);
  return value.trim();
};

/** Server-only: validates every value needed to create a Mainnet mandate. */
export function parseHealthGuardPoolRegistry(raw: string | undefined): readonly PrivatePool[] {
  raw = raw?.trim();
  if (!raw) return [];
  let entries: unknown;
  try { entries = JSON.parse(raw); } catch { throw new Error("Health Guard pool registry is invalid"); }
  if (!Array.isArray(entries)) throw new Error("Health Guard pool registry must be an array");
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Health Guard pool registry entries must be objects");
    const input = entry as Record<string, unknown>;
    const poolId = text(input.id, "id");
    if (!id.test(poolId) || seen.has(poolId)) throw new Error("Health Guard pool registry has an invalid or duplicate id");
    seen.add(poolId);
    const assetAddress = text(input.debtAssetAddress, "debtAssetAddress");
    const vTokenAddress = text(input.debtVTokenAddress, "debtVTokenAddress");
    const comptrollerAddress = text(input.comptrollerAddress, "comptrollerAddress");
    if (![assetAddress, vTokenAddress, comptrollerAddress].every((value) => address.test(value))) throw new Error("Health Guard pool registry has an invalid address");
    const decimals = input.debtAssetDecimals;
    if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36)
      throw new Error("Health Guard pool registry has invalid debtAssetDecimals");
    const debtAsset = text(input.debtAsset, "debtAsset");
    return Object.freeze({
      id: poolId, name: text(input.name, "name"), protocol: text(input.protocol, "protocol"), network: text(input.network, "network"), debtAsset,
      description: `Protects a ${debtAsset} borrow in the selected ${text(input.name, "name")}.`,
      debtAssetDecimals: decimals,
      debtAssetAddress: assetAddress as `0x${string}`, debtVTokenAddress: vTokenAddress as `0x${string}`, comptrollerAddress: comptrollerAddress as `0x${string}`,
    });
  });
}

export function publicHealthGuardPoolOptionsFromRegistry(raw: string | undefined): readonly HealthGuardPoolOption[] {
  return parseHealthGuardPoolRegistry(raw).map(({
    debtAssetAddress: _asset,
    debtVTokenAddress: _vToken,
    comptrollerAddress: _comptroller,
    debtAssetDecimals: _decimals,
    ...pool
  }) => pool);
}

export function configuredHealthGuardPools(): readonly PrivatePool[] {
  return parseHealthGuardPoolRegistry(process.env.HEALTH_GUARD_POOLS_JSON);
}

export function publicHealthGuardPoolOptions(): readonly HealthGuardPoolOption[] {
  return publicHealthGuardPoolOptionsFromRegistry(process.env.HEALTH_GUARD_POOLS_JSON);
}

export function configuredHealthGuardPool(poolId: string): PrivatePool {
  const pool = configuredHealthGuardPools().find((item) => item.id === poolId);
  if (!pool) throw new Error("Choose a verified Venus pool");
  return pool;
}
