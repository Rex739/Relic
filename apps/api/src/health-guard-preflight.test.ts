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

  it("rejects enrolled markets that provide no usable collateral", async () => {
    const client = {
      getBlock: async () => ({ number: 1n, timestamp: 1_700_000_000n }),
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "getAssetsIn") return ["0x0000000000000000000000000000000000000005"];
        if (functionName === "oracle") return "0x0000000000000000000000000000000000000004";
        if (functionName === "getAccountSnapshot") return [0n, 0n, 1n, 1n];
        if (functionName === "getUnderlyingPrice") return 10n ** 18n;
        if (functionName === "markets") return [true, 8n * 10n ** 17n, false];
        throw new Error(`Unexpected ${functionName}`);
      },
    } as never;
    const guard = new HealthGuardPreflight(
      { rpcUrl: "https://rpc.example", usdtVToken: "0x0000000000000000000000000000000000000002", comptroller: "0x0000000000000000000000000000000000000003" },
      client,
    );
    await expect(guard.inspect({ poolId: "venus-core-pool", borrower })).resolves.toMatchObject({ eligible: false, reason: "no_collateral" });
  });
});
