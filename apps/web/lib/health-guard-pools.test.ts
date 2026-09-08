import { describe, expect, it } from "vitest";

import { parseHealthGuardPoolRegistry, publicHealthGuardPoolOptionsFromRegistry } from "./health-guard-pools";

const registry = JSON.stringify([
  {
    id: "venus-core-usdt",
    name: "Venus Core Pool",
    protocol: "Venus",
    network: "BNB Chain",
    debtAsset: "USDT",
    debtAssetAddress: "0x55d398326f99059fF775485246999027B3197955",
    debtVTokenAddress: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
    comptrollerAddress: "0xfD36E2c2a6789Db23113685031d7F16329158384",
    debtAssetDecimals: 18,
  },
]);

describe("Health Guard pool registry", () => {
  it("keeps contract addresses and decimal precision in the server-only record", () => {
    const pool = parseHealthGuardPoolRegistry(registry)[0]!;
    const { debtAssetAddress, debtVTokenAddress, comptrollerAddress, debtAssetDecimals } = pool;

    expect(debtAssetAddress).toMatch(/^0x/u);
    expect(debtVTokenAddress).toMatch(/^0x/u);
    expect(comptrollerAddress).toMatch(/^0x/u);
    expect(debtAssetDecimals).toBe(18);
    expect(publicHealthGuardPoolOptionsFromRegistry(registry)).toEqual([{
      id: "venus-core-usdt",
      name: "Venus Core Pool",
      protocol: "Venus",
      network: "BNB Chain",
      debtAsset: "USDT",
      description: "Protects a USDT borrow in the selected Venus Core Pool.",
    }]);
  });

  it("rejects a registry record without a verified contract address", () => {
    expect(() => parseHealthGuardPoolRegistry(JSON.stringify([{ id: "venus-core-usdt" }]))).toThrow("invalid debtAssetAddress");
  });
});
