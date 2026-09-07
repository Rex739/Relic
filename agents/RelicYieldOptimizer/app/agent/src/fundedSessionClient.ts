import { openFundedSession } from "./fundedSessionEnvelope.js";
import type { Address } from "./networkConfig.js";

type FetchLike = typeof fetch;

export type FundedSessionRelease = Readonly<{
  commerceJobId: string;
  mandateId: string;
  walletAddress: Address;
  sessionAddress: Address;
  sessionPublicKey: `0x${string}`;
  permissions: Record<string, unknown>;
  expiresAt: Date;
  /** This plaintext is deliberately returned only to the caller that creates the in-memory signer. */
  sessionPrivateKey: `0x${string}`;
}>;

const address = /^0x[0-9a-fA-F]{40}$/u;
const hex = /^0x[0-9a-fA-F]+$/u;

/**
 * Internal, bearer-authenticated client for a single funded job's encrypted
 * session. Browser input cannot reach this endpoint and the key is never
 * written to disk, emitted in errors, or retained by this client.
 */
export class FundedSessionClient {
  public constructor(
    private readonly config: Readonly<{ apiUrl: string; bearerToken: string; executorPrivateKeyPem: string }>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!/^https?:\/\//u.test(config.apiUrl)) throw new Error("RELIC_API_URL must be an HTTP(S) URL");
    if (!config.bearerToken.trim()) throw new Error("RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN is required");
    if (!config.executorPrivateKeyPem.trim()) throw new Error("RELIC_YIELD_SESSION_TRANSFER_PRIVATE_KEY is required");
  }

  async release(commerceJobId: string): Promise<FundedSessionRelease> {
    if (!commerceJobId.trim()) throw new Error("Funded job id is required");
    const response = await this.fetchImpl(
      new URL(`/internal/yield-optimizer/funded-jobs/${encodeURIComponent(commerceJobId)}/session`, this.config.apiUrl).toString(),
      { method: "POST", headers: { authorization: `Bearer ${this.config.bearerToken}` } },
    );
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text) as unknown; } catch { throw new Error("Relic funded-session release returned non-JSON"); }
    if (!response.ok) {
      const detail = body && typeof body === "object" && !Array.isArray(body)
        ? String((body as { error?: unknown }).error ?? "request failed") : "request failed";
      throw new Error(`Relic funded-session release failed (${String(response.status)}): ${detail}`);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Relic funded-session release returned an invalid response");
    const value = body as Record<string, unknown>;
    const expiresAt = typeof value.expiresAt === "string" ? new Date(value.expiresAt) : null;
    if (
      typeof value.commerceJobId !== "string" || value.commerceJobId !== commerceJobId ||
      typeof value.mandateId !== "string" || typeof value.walletAddress !== "string" || !address.test(value.walletAddress) ||
      typeof value.sessionAddress !== "string" || !address.test(value.sessionAddress) ||
      typeof value.sessionPublicKey !== "string" || !hex.test(value.sessionPublicKey) ||
      !value.permissions || typeof value.permissions !== "object" || Array.isArray(value.permissions) ||
      expiresAt === null || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date() ||
      typeof value.envelope !== "string"
    ) throw new Error("Relic funded-session release returned malformed session metadata");
    const decrypted = openFundedSession(value.envelope, this.config.executorPrivateKeyPem);
    if (!hex.test(decrypted)) throw new Error("Relic funded-session release contained an invalid session key");
    return Object.freeze({
      commerceJobId: value.commerceJobId,
      mandateId: value.mandateId,
      walletAddress: value.walletAddress as Address,
      sessionAddress: value.sessionAddress as Address,
      sessionPublicKey: value.sessionPublicKey as `0x${string}`,
      permissions: value.permissions as Record<string, unknown>,
      expiresAt,
      sessionPrivateKey: decrypted as `0x${string}`,
    });
  }
}
