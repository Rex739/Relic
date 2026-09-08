import { describe, expect, it } from "vitest";
import { AltanaSessionAuthorizationService } from "./altana-session-authorization.js";

describe("AltanaSessionAuthorizationService Health Guard", () => {
  it("rechecks position eligibility immediately before creating a buyer session", async () => {
    const service = new AltanaSessionAuthorizationService(
      {
        get: async () => ({
          chainId: 56,
          status: "REVIEWED",
          version: {
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            riskConstraints: {
              executionKind: "VENUS_USDT_HEALTH_GUARD_V1",
              healthGuardPoolId: "venus-core-pool",
              monitoredAccount: "0x0000000000000000000000000000000000000001",
              triggerHealthFactorWad: "1200000000000000000",
              targetHealthFactorWad: "1500000000000000000",
              maximumRepayBaseUnits: "1000000",
              aggregateRepayLimitBaseUnits: "2000000",
              maximumFeeWei: "100000000000000",
              sessionDurationHours: 24,
            },
          },
        }),
      } as never,
      {} as never,
      {} as never,
      "https://testnet.example",
      undefined,
      undefined,
      "https://mainnet.example",
      { usdt: "0x0000000000000000000000000000000000000002", venusUsdtVToken: "0x0000000000000000000000000000000000000003" },
      { inspect: async () => ({ eligible: false, reason: "no_usdt_debt" }) },
    );

    await expect(service.prepare("principal", "mandate")).rejects.toThrow("no_usdt_debt");
  });
});
