import { and, eq } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import { kernelSessionAuthorizations } from "./schema.js";

export type KernelSessionAuthorizationRecord = {
  id: string;
  mandateId: string;
  principalId: string;
  chainId: number;
  ownerAddress: string | null;
  smartAccountAddress: string | null;
  sessionAddress: string;
  sessionPublicKey: string;
  encryptedSessionPrivateKey: string;
  encryptedPermissionAccount: string | null;
  permissions: Record<string, unknown>;
  expiresAt: Date;
  status: "PENDING" | "OWNER_CONFIRMED" | "ACTIVE" | "REVOKED" | "EXPIRED";
  ownerConfirmedAt: Date | null;
  revokedAt: Date | null;
};

const asRecord = (value: unknown) => (value ?? {}) as Record<string, unknown>;
const record = (row: typeof kernelSessionAuthorizations.$inferSelect): KernelSessionAuthorizationRecord => ({
  id: row.id,
  mandateId: row.mandateId,
  principalId: row.principalId,
  chainId: row.chainId,
  ownerAddress: row.ownerAddress,
  smartAccountAddress: row.smartAccountAddress,
  sessionAddress: row.sessionAddress,
  sessionPublicKey: row.sessionPublicKey,
  encryptedSessionPrivateKey: row.encryptedSessionPrivateKey,
  encryptedPermissionAccount: row.encryptedPermissionAccount,
  permissions: asRecord(row.permissions),
  expiresAt: row.expiresAt,
  status: row.status as KernelSessionAuthorizationRecord["status"],
  ownerConfirmedAt: row.ownerConfirmedAt,
  revokedAt: row.revokedAt,
});

export class DrizzleKernelSessionAuthorizationStore {
  public constructor(private readonly database: RelicDatabase) {}

  public async find(mandateId: string, principalId: string) {
    const [row] = await this.database.select().from(kernelSessionAuthorizations).where(
      and(eq(kernelSessionAuthorizations.mandateId, mandateId), eq(kernelSessionAuthorizations.principalId, principalId)),
    ).limit(1);
    return row === undefined ? null : record(row);
  }

  public async create(input: Omit<KernelSessionAuthorizationRecord, "id" | "encryptedPermissionAccount" | "ownerConfirmedAt" | "revokedAt">) {
    const [row] = await this.database.insert(kernelSessionAuthorizations).values({
      mandateId: input.mandateId,
      principalId: input.principalId,
      chainId: input.chainId,
      ownerAddress: input.ownerAddress,
      smartAccountAddress: input.smartAccountAddress,
      sessionAddress: input.sessionAddress,
      sessionPublicKey: input.sessionPublicKey,
      encryptedSessionPrivateKey: input.encryptedSessionPrivateKey,
      permissions: input.permissions,
      expiresAt: input.expiresAt,
      status: input.status,
    }).returning();
    if (row === undefined) throw new Error("Kernel session authorization insert failed");
    return record(row);
  }

  public async markOwnerConfirmed(input: { mandateId: string; principalId: string; ownerAddress: string; smartAccountAddress: string; encryptedPermissionAccount: string }) {
    const [row] = await this.database.update(kernelSessionAuthorizations).set({
      ownerAddress: input.ownerAddress,
      smartAccountAddress: input.smartAccountAddress,
      encryptedPermissionAccount: input.encryptedPermissionAccount,
      status: "OWNER_CONFIRMED",
      ownerConfirmedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(kernelSessionAuthorizations.mandateId, input.mandateId),
      eq(kernelSessionAuthorizations.principalId, input.principalId),
      eq(kernelSessionAuthorizations.status, "PENDING"),
    )).returning();
    return row === undefined ? null : record(row);
  }

  public async revoke(mandateId: string, principalId: string) {
    const [row] = await this.database.update(kernelSessionAuthorizations).set({
      status: "REVOKED", revokedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(kernelSessionAuthorizations.mandateId, mandateId), eq(kernelSessionAuthorizations.principalId, principalId))).returning();
    return row === undefined ? null : record(row);
  }
}
