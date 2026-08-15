import { describe, expect, it } from "vitest";

import { analyzePosition, type PositionReader } from "../src/analysis.js";

const fixtureReader: PositionReader = {
  read: (input) =>
    Promise.resolve({
      source: "fixture",
      chainId: input.chainId,
      protocol: "venus-core",
      blockNumber: "12345",
      comptroller: "0x1111111111111111111111111111111111111111",
      errorCode: "0",
      liquidityRaw: "50",
      shortfallRaw: "0",
      markets: [
        {
          market: "0x2222222222222222222222222222222222222222",
          symbol: "vTEST",
          vTokenBalanceRaw: "100",
          borrowBalanceRaw: "25",
          exchangeRateRaw: "200000000000000000000000000",
        },
      ],
    }),
};

describe("health-factor reference seller", () => {
  it("labels deterministic evidence as fixture and never as live", async () => {
    const result = await analyzePosition(
      {
        account: "0x3333333333333333333333333333333333333333",
        protocol: "venus-core",
        chainId: 97,
        warningThresholdRaw: "100",
      },
      fixtureReader,
    );
    expect(result.source).toBe("fixture");
    expect(result.riskLevel).toBe("watch");
    expect(result.metric.healthFactor).toBeNull();
    expect(result.readOnly).toBe(true);
  });

  it("rejects unsupported schemas instead of inventing protocol data", async () => {
    await expect(
      analyzePosition(
        {
          account: "0x3333333333333333333333333333333333333333",
          protocol: "unknown",
          chainId: 97,
        },
        fixtureReader,
      ),
    ).rejects.toThrow();
  });

  it("surfaces a failed seller invocation without producing a deliverable", async () => {
    await expect(
      analyzePosition(
        {
          account: "0x3333333333333333333333333333333333333333",
          protocol: "venus-core",
          chainId: 97,
        },
        { read: () => Promise.reject(new Error("fixture RPC unavailable")) },
      ),
    ).rejects.toThrow(/RPC unavailable/);
  });
});
