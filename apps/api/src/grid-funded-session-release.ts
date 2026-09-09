import type { DrizzleCommerceStore } from "@relic/database";
import { randomUUID } from "node:crypto";
import { AltanaSessionEncryption } from "./altana-session-encryption.js";
import { sealFundedSession } from "./funded-session-envelope.js";

type AltanaGridRow = NonNullable<Awaited<ReturnType<DrizzleCommerceStore["findFundedGridSession"]>>>;
type KernelGridRow = NonNullable<Awaited<ReturnType<DrizzleCommerceStore["findFundedGridKernelSession"]>>>;
type AuthorizedGridRow =
  | Readonly<{ kind: "ALTANA"; row: AltanaGridRow }>
  | Readonly<{ kind: "KERNEL"; row: KernelGridRow }>;

/** Releases a buyer session to the Grid Trader only after its own funded,
 * active commerce job has been resolved by Relic. */
export class GridFundedSessionRelease {
  constructor(
    private readonly commerce: DrizzleCommerceStore,
    private readonly encryption: AltanaSessionEncryption,
    private readonly agentId: string,
    private readonly executorPublicKey: string,
  ) {}

  async release(jobId: string) {
    const authorized = await this.#row(jobId);
    if (authorized.kind === "ALTANA") {
      const row = authorized.row;
      if (row.session.walletAddress === null) throw new Error("The funded Grid Trader session has no authorized buyer wallet");
      return {
        kind: "ALTANA" as const,
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
    const row = authorized.row;
    if (row.session.ownerAddress === null || row.session.smartAccountAddress === null || row.session.encryptedPermissionAccount === null)
      throw new Error("The funded Grid Trader Kernel session is incomplete");
    return {
      kind: "KERNEL" as const,
      commerceJobId: jobId,
      mandateId: row.mandate.id,
      ownerAddress: row.session.ownerAddress,
      smartAccountAddress: row.session.smartAccountAddress,
      sessionAddress: row.session.sessionAddress,
      sessionPublicKey: row.session.sessionPublicKey,
      permissions: row.session.permissions,
      expiresAt: row.session.expiresAt.toISOString(),
      // Both values are encrypted at rest and this combined payload is sealed
      // again for the Grid Trader's X25519 executor key. It is never emitted
      // to a browser or included in an execution receipt.
      envelope: sealFundedSession(JSON.stringify({
        sessionPrivateKey: this.encryption.decrypt(row.session.encryptedSessionPrivateKey),
        serializedPermissionAccount: this.encryption.decrypt(row.session.encryptedPermissionAccount),
      }), this.executorPublicKey),
    };
  }

  async canonicalExecution(jobId: string) {
    const authorized = await this.#row(jobId);
    const row = authorized.row;
    const account = authorized.kind === "ALTANA" ? authorized.row.session.walletAddress : authorized.row.session.smartAccountAddress;
    if (account === null) throw new Error("The funded Grid Trader session has no authorized execution account");
    const constraints = record(row.version.riskConstraints, "risk constraints");
    const maximumCapitalBaseUnits = positive(constraints.maximumCapitalBaseUnits, "riskConstraints.maximumCapitalBaseUnits");
    const maximumFeeWei = positive(constraints.maximumFeeWei, "riskConstraints.maximumFeeWei");
    const lowerPrice = decimal(constraints.lowerPrice, "riskConstraints.lowerPrice");
    const upperPrice = decimal(constraints.upperPrice, "riskConstraints.upperPrice");
    const gridLevels = integer(constraints.gridLevels, "riskConstraints.gridLevels", 5, 8);
    const frequency = record(row.version.executionFrequency, "execution frequency");
    const durationSeconds = integer(frequency.windowSeconds, "executionFrequency.windowSeconds", 1, 168 * 3_600);
    const expiresAt = new Date(Math.min(row.version.expiresAt.getTime(), row.session.expiresAt.getTime()));
    if (expiresAt <= new Date()) throw new Error("The funded Grid Trader mandate has expired");
    return {
      kind: "relic.funded_grid_job.v1" as const,
      id: randomUUID(),
      commerceJobId: jobId,
      idempotencyKey: `grid:${row.activation.id}:${jobId}`,
      mandate: {
        jobId,
        account,
        expiresAt: expiresAt.toISOString(),
        maximumCapitalBaseUnits,
        lowerPrice,
        upperPrice,
        gridLevels,
        minimumSecondsBetweenExecutions: String(Math.max(60, Math.floor(durationSeconds / Math.max(1, gridLevels * 2)))),
      },
      maximumFeeWei,
    };
  }

  async #row(jobId: string): Promise<AuthorizedGridRow> {
    const altana = await this.commerce.findFundedGridSession(jobId);
    if (altana !== undefined) {
      if (altana.mandate.agentId !== this.agentId)
        throw new Error("No funded active Grid Trader session is bound to this job");
      return { kind: "ALTANA" as const, row: altana };
    }
    const kernel = await this.commerce.findFundedGridKernelSession(jobId);
    if (kernel === undefined || kernel.mandate.agentId !== this.agentId)
      throw new Error("No funded active Grid Trader session is bound to this job");
    return { kind: "KERNEL" as const, row: kernel };
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Grid Trader mandate has invalid ${label}`);
  return value as Record<string, unknown>;
}

function positive(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) throw new Error(`Grid Trader mandate requires ${label} as a positive base-unit integer`);
  return value;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value) || Number(value) <= 0) throw new Error(`Grid Trader mandate requires ${label} as a positive decimal`);
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Grid Trader mandate requires ${label} within its approved bounds`);
  return value;
}
