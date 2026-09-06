import { and, eq } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import { altanaSessionAuthorizations } from "./schema.js";

export type AltanaSessionAuthorizationRecord = {
  id: string;
  mandateId: string;
  principalId: string;
  chainId: number;
  walletAddress: string | null;
  sessionAddress: string;
  sessionPublicKey: string;
  encryptedSessionPrivateKey: string;
  permissions: Record<string, unknown>;
  expiresAt: Date;
  grantTransactionHash: string | null;
  status: "PENDING" | "GRANTED" | "REVOKED" | "EXPIRED";
  grantedAt: Date | null;
  revokedAt: Date | null;
};

const asRecord = (value: unknown) => (value ?? {}) as Record<string, unknown>;

const record = (
  row: typeof altanaSessionAuthorizations.$inferSelect,
): AltanaSessionAuthorizationRecord => ({
  id: row.id,
  mandateId: row.mandateId,
  principalId: row.principalId,
  chainId: row.chainId,
  walletAddress: row.walletAddress,
  sessionAddress: row.sessionAddress,
  sessionPublicKey: row.sessionPublicKey,
  encryptedSessionPrivateKey: row.encryptedSessionPrivateKey,
  permissions: asRecord(row.permissions),
  expiresAt: row.expiresAt,
  grantTransactionHash: row.grantTransactionHash,
  status: row.status as AltanaSessionAuthorizationRecord["status"],
  grantedAt: row.grantedAt,
  revokedAt: row.revokedAt,
});

export class DrizzleAltanaSessionAuthorizationStore {
  public constructor(private readonly database: RelicDatabase) {}

  public async find(mandateId: string, principalId: string) {
    const [row] = await this.database
      .select()
      .from(altanaSessionAuthorizations)
      .where(
        and(
          eq(altanaSessionAuthorizations.mandateId, mandateId),
          eq(altanaSessionAuthorizations.principalId, principalId),
        ),
      )
      .limit(1);
    return row === undefined ? null : record(row);
  }

  public async create(input: Omit<AltanaSessionAuthorizationRecord, "id" | "walletAddress" | "grantTransactionHash" | "grantedAt" | "revokedAt">) {
    const [row] = await this.database
      .insert(altanaSessionAuthorizations)
      .values({
        mandateId: input.mandateId,
        principalId: input.principalId,
        chainId: input.chainId,
        sessionAddress: input.sessionAddress,
        sessionPublicKey: input.sessionPublicKey,
        encryptedSessionPrivateKey: input.encryptedSessionPrivateKey,
        permissions: input.permissions,
        expiresAt: input.expiresAt,
        status: input.status,
      })
      .returning();
    if (row === undefined) throw new Error("Altana session authorization insert failed");
    return record(row);
  }

  public async markGranted(input: {
    mandateId: string;
    principalId: string;
    walletAddress: string;
    transactionHash: string;
  }) {
    const [row] = await this.database
      .update(altanaSessionAuthorizations)
      .set({
        status: "GRANTED",
        walletAddress: input.walletAddress,
        grantTransactionHash: input.transactionHash,
        grantedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(altanaSessionAuthorizations.mandateId, input.mandateId),
          eq(altanaSessionAuthorizations.principalId, input.principalId),
          eq(altanaSessionAuthorizations.status, "PENDING"),
        ),
      )
      .returning();
    return row === undefined ? null : record(row);
  }
}
