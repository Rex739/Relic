import { describe, expect, it } from "vitest";
import { HealthGuardPreflight } from "./health-guard-preflight.js";

const borrower = "0x0000000000000000000000000000000000000001" as const;
const preflight = () => new HealthGuardPreflight(
  { rpcUrl: "https://rpc.example", usdtVToken: "0x0000000000000000000000000000000000000002", comptroller: "0x0000000000000000000000000000000000000003" },
  {
    getBlock: async () => ({ number: 1n, timestamp: 1_700_000_000n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "getAssetsIn") return [];
      if (functionName === "oracle") return "0x0000000000000000000000000000000000000004";
      if (functionName === "getAccountSnapshot") return [0n, 0n, 0n, 0n];
      throw new Error(`Unexpected ${functionName}`);
    },
  } as never,
);

describe("HealthGuardPreflight", () => {
  it("fails closed when the selected verified pool has no USDT debt", async () => {
    await expect(preflight().inspect({ poolId: "venus-core-pool", borrower })).resolves.toMatchObject({
      eligible: false, reason: "no_usdt_debt", usdtDebtBaseUnits: "0",
    });
  });

  it("does not read arbitrary pool identifiers", async () => {
    await expect(preflight().inspect({ poolId: "unverified-pool", borrower })).rejects.toThrow("verified Venus pool");
  });
});
