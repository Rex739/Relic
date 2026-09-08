import type { DrizzleCommerceStore } from "@relic/database";
import { randomUUID } from "node:crypto";
import { AltanaSessionEncryption } from "./altana-session-encryption.js";
import { sealFundedSession } from "./funded-session-envelope.js";
import { healthGuardPool, type HealthGuardPoolRegistry } from "./health-guard-pool-registry.js";

const record = (value: unknown, label: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Health Guard mandate has invalid ${label}`);
  return value as Record<string, unknown>;
};
const positive = (value: unknown, label: string) => {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) throw new Error(`Health Guard mandate requires ${label} as a positive base-unit integer`);
  return value;
};
const wad = (value: unknown, label: string) => {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) throw new Error(`Health Guard mandate requires ${label} as a positive WAD integer`);
  return value;
};

/** Releases a Mainnet buyer session only for the configured Health Guard agent. */
export class HealthGuardFundedSessionRelease {
  constructor(private readonly commerce: DrizzleCommerceStore, private readonly encryption: AltanaSessionEncryption, private readonly agentId: string, private readonly executorPublicKey: string, private readonly pools: HealthGuardPoolRegistry) {}

  async release(jobId: string) {
    const row = await this.commerce.findFundedHealthGuardSession(jobId);
    if (!row || row.mandate.agentId !== this.agentId) throw new Error("No funded active Health Guard session is bound to this job");
    if (row.session.walletAddress === null) throw new Error("The funded Health Guard session has no authorized buyer rescue wallet");
    return {
      commerceJobId: jobId, mandateId: row.mandate.id, walletAddress: row.session.walletAddress,
      sessionAddress: row.session.sessionAddress, sessionPublicKey: row.session.sessionPublicKey,
      permissions: row.session.permissions, expiresAt: row.session.expiresAt.toISOString(),
      envelope: sealFundedSession(this.encryption.decrypt(row.session.encryptedSessionPrivateKey), this.executorPublicKey),
    };
  }

  async activeFundedJobIds(limit?: number) {
    return this.commerce.listFundedHealthGuardJobIds(this.agentId, limit);
  }

  async canonicalExecution(jobId: string) {
    const row = await this.commerce.findFundedHealthGuardSession(jobId);
    if (!row || row.mandate.agentId !== this.agentId) throw new Error("No funded active Health Guard session is bound to this job");
    if (row.session.walletAddress === null) throw new Error("The funded Health Guard session has no authorized buyer rescue wallet");
    const constraints = record(row.version.riskConstraints, "risk constraints");
    const frequency = record(row.version.executionFrequency, "execution frequency");
    const triggerHealthFactorWad = wad(constraints.triggerHealthFactorWad, "riskConstraints.triggerHealthFactorWad");
    const pool = constraints.healthGuardPoolId;
    healthGuardPool(this.pools, pool);
    const targetHealthFactorWad = wad(constraints.targetHealthFactorWad, "riskConstraints.targetHealthFactorWad");
    const maximumRepayBaseUnits = positive(constraints.maximumRepayBaseUnits, "riskConstraints.maximumRepayBaseUnits");
    const aggregateRepayLimitBaseUnits = positive(constraints.aggregateRepayLimitBaseUnits, "riskConstraints.aggregateRepayLimitBaseUnits");
    const maximumFeeWei = positive(constraints.maximumFeeWei, "riskConstraints.maximumFeeWei");
    if (BigInt(targetHealthFactorWad) <= BigInt(triggerHealthFactorWad) || BigInt(aggregateRepayLimitBaseUnits) < BigInt(maximumRepayBaseUnits))
      throw new Error("Health Guard buyer limits are inconsistent");
    const cooldown = frequency.windowSeconds;
    if (!Number.isSafeInteger(cooldown) || (cooldown as number) < 60) throw new Error("Health Guard requires a cooldown of at least sixty seconds");
    const expiresAt = new Date(Math.min(row.version.expiresAt.getTime(), row.session.expiresAt.getTime()));
    if (expiresAt <= new Date()) throw new Error("The funded Health Guard mandate has expired");
    return {
      kind: "relic.funded_health_guard_job.v1" as const, id: randomUUID(), commerceJobId: jobId,
      idempotencyKey: `health-guard:${row.activation.id}:${jobId}`,
      maximumFeeWei,
      mandate: {
        jobId, borrower: row.session.walletAddress, rescueWallet: row.session.walletAddress,
        poolId: pool,
        triggerHealthFactorWad, targetHealthFactorWad, maximumRepayBaseUnits, aggregateRepayLimitBaseUnits,
        minimumSecondsBetweenRepays: String(cooldown), expiresAt: expiresAt.toISOString(),
      },
    };
  }
}
