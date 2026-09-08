import { describe, expect, it } from "vitest";
import { healthGuardPool, parseHealthGuardPoolRegistry } from "./health-guard-pool-registry.js";

const pool = {
  id: "venus-core-usdt", name: "Venus Core Pool", protocol: "Venus", network: "BNB Chain", debtAsset: "USDT",
  debtAssetAddress: "0x0000000000000000000000000000000000000001",
  debtVTokenAddress: "0x0000000000000000000000000000000000000002",
  comptrollerAddress: "0x0000000000000000000000000000000000000003", debtAssetDecimals: 18,
};

describe("Health Guard pool registry", () => {
  it("keeps contract configuration server-side and resolves selected pools", () => {
    const registry = parseHealthGuardPoolRegistry(JSON.stringify([pool]))!;
    expect(healthGuardPool(registry, "venus-core-usdt").debtVTokenAddress).toBe(pool.debtVTokenAddress);
  });

  it("rejects malformed and duplicate inventory before authorization", () => {
    expect(() => parseHealthGuardPoolRegistry("not-json")).toThrow("invalid JSON");
    expect(() => parseHealthGuardPoolRegistry(JSON.stringify([pool, pool]))).toThrow("duplicate");
  });
});
