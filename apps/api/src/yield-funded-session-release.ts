import type { DrizzleCommerceStore } from "@relic/database";
import { randomUUID } from "node:crypto";
import { AltanaSessionEncryption } from "./altana-session-encryption.js";
import { sealFundedSession } from "./funded-session-envelope.js";

/** Releases one bounded session only after Relic resolves its funded activation. */
export class YieldFundedSessionRelease {
  constructor(private readonly commerce: DrizzleCommerceStore, private readonly encryption: AltanaSessionEncryption, private readonly agentId: string, private readonly executorPublicKey: string) {}
  async release(jobId: string) {
    const row = await this.commerce.findFundedYieldSession(jobId);
    if (!row || row.mandate.agentId !== this.agentId) throw new Error("No funded active Yield Optimizer session is bound to this job");
    if (row.session.walletAddress === null)
      throw new Error("The funded Yield Optimizer session has no authorized buyer wallet");
    return {
      commerceJobId: jobId,
      mandateId: row.mandate.id,
      walletAddress: row.session.walletAddress,
      sessionAddress: row.session.sessionAddress,
      sessionPublicKey: row.session.sessionPublicKey,
      permissions: row.session.permissions,
      expiresAt: row.session.expiresAt.toISOString(),
      envelope: sealFundedSession(this.encryption.decrypt(row.session.encryptedSessionPrivateKey), this.executorPublicKey),
    };
  }

  /**
   * The only canonical execution payload Layer B may send to Layer A. All
   * limits come from the already funded Relic activation; A2A input supplies
   * only the ERC-8183 job identifier.
   */
  async canonicalExecution(jobId: string) {
    const row = await this.commerce.findFundedYieldSession(jobId);
    if (!row || row.mandate.agentId !== this.agentId) throw new Error("No funded active Yield Optimizer session is bound to this job");
    if (row.session.walletAddress === null) throw new Error("The funded Yield Optimizer session has no authorized buyer wallet");
    const constraints = asRecord(row.version.riskConstraints, "risk constraints");
    const maximumAmountBaseUnits = positive(constraints.maximumAmountBaseUnits, "riskConstraints.maximumAmountBaseUnits");
    const amountBaseUnits = positive(constraints.executionAmountBaseUnits, "riskConstraints.executionAmountBaseUnits");
    const maximumFeeWei = positive(constraints.maximumFeeWei, "riskConstraints.maximumFeeWei");
    if (BigInt(amountBaseUnits) > BigInt(maximumAmountBaseUnits))
      throw new Error("Yield Optimizer execution amount exceeds the buyer-approved maximum");
    const frequency = asRecord(row.version.executionFrequency, "execution frequency");
    const cooldown = frequency.windowSeconds;
    if (!Number.isSafeInteger(cooldown) || (cooldown as number) < 0)
      throw new Error("Yield Optimizer mandate requires a non-negative execution frequency window");
    const expiresAt = new Date(Math.min(row.version.expiresAt.getTime(), row.session.expiresAt.getTime()));
    if (expiresAt <= new Date()) throw new Error("The funded Yield Optimizer mandate has expired");
    return {
      kind: "relic.funded_yield_job.v1" as const,
      id: randomUUID(),
      commerceJobId: jobId,
      idempotencyKey: `yield:${row.activation.id}:${jobId}`,
      mandate: {
        jobId,
        account: row.session.walletAddress,
        expiresAt: expiresAt.toISOString(),
        maximumAmountBaseUnits,
        minimumSecondsBetweenExecutions: String(cooldown),
      },
      amountBaseUnits,
      maximumFeeWei,
    };
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Yield Optimizer mandate has invalid ${label}`);
  return value as Record<string, unknown>;
}

function positive(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) throw new Error(`Yield Optimizer mandate requires ${label} as a positive base-unit integer`);
  return value;
}
