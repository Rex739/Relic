import { describe, expect, it } from "vitest";
import { HealthGuardFundedSessionRelease } from "./health-guard-funded-session-release.js";

const now = new Date(Date.now() + 3_600_000);
const row = {
  activation: { id: "activation-1" },
  mandate: { id: "mandate-1", agentId: "health-agent" },
  version: {
    expiresAt: now,
    executionFrequency: { windowSeconds: 300 },
    riskConstraints: {
      executionKind: "VENUS_USDT_HEALTH_GUARD_V1",
      healthGuardPoolId: "venus-core-pool",
      triggerHealthFactorWad: "1200000000000000000",
      targetHealthFactorWad: "1500000000000000000",
      maximumRepayBaseUnits: "1000000",
      aggregateRepayLimitBaseUnits: "5000000",
      maximumFeeWei: "1000000000000000",
    },
  },
  session: {
    walletAddress: "0x0000000000000000000000000000000000000001",
    sessionAddress: "0x0000000000000000000000000000000000000002",
    sessionPublicKey: "0x1234",
    permissions: { calls: [], spend: [] },
    expiresAt: now,
    encryptedSessionPrivateKey: "encrypted",
  },
};

describe("HealthGuardFundedSessionRelease", () => {
  it("creates a canonical bounded Mainnet-only execution envelope", async () => {
    const release = new HealthGuardFundedSessionRelease(
      { findFundedHealthGuardSession: async () => row } as never,
      { decrypt: () => "0x1234" } as never,
      "health-agent",
      "test-public-key",
    );
    const result = await release.canonicalExecution("8183");
    expect(result.kind).toBe("relic.funded_health_guard_job.v1");
    expect(result.mandate).toMatchObject({ jobId: "8183", poolId: "venus-core-pool", borrower: row.session.walletAddress, maximumRepayBaseUnits: "1000000" });
    expect(result.idempotencyKey).toBe("health-guard:activation-1:8183");
  });

  it("rejects inconsistent buyer limits before a key is released", async () => {
    const invalid = { ...row, version: { ...row.version, riskConstraints: { ...row.version.riskConstraints, aggregateRepayLimitBaseUnits: "1" } } };
    const release = new HealthGuardFundedSessionRelease(
      { findFundedHealthGuardSession: async () => invalid } as never,
      { decrypt: () => "0x1234" } as never,
      "health-agent",
      "test-public-key",
    );
    await expect(release.canonicalExecution("8183")).rejects.toThrow("limits are inconsistent");
  });
});
