import { describe, expect, it } from "vitest";
import type { AgentReadRepository } from "@relic/domain";
import { createApp } from "../src/app.js";

const repository: AgentReadRepository = {
  list: async () => ({ items: [], nextCursor: null }),
  findById: async () => null,
};

describe("Health Guard preflight route", () => {
  it("exposes only verified-pool position evidence before authorization", async () => {
    const app = createApp(repository, undefined, undefined, {
      healthGuardPreflight: {
        inspect: async () => ({
          poolId: "venus-core-pool", eligible: true, reason: "position_ready",
          healthFactorWad: "1500000000000000000", usdtDebtBaseUnits: "1000000",
          collateralMarkets: ["0x0000000000000000000000000000000000000002" as const],
          observedAt: "2026-09-08T00:00:00.000Z",
        }),
      } as never,
    });
    const response = await app.request("/v1/health-guard/preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ poolId: "venus-core-pool", borrower: "0x0000000000000000000000000000000000000001" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { eligible: true, reason: "position_ready", usdtDebtBaseUnits: "1000000" } });
  });
});
