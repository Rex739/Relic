import { openFundedSession } from "./funded-session-envelope.js";
import type { Address } from "./config.js";

type FetchLike = typeof fetch;
export type FundedHealthGuardSession = Readonly<{
  commerceJobId: string;
  mandateId: string;
  walletAddress: Address;
  sessionAddress: Address;
  sessionPublicKey: `0x${string}`;
  permissions: Record<string, unknown>;
  expiresAt: Date;
  sessionPrivateKey: `0x${string}`;
}>;

const address = /^0x[0-9a-fA-F]{40}$/u;
const hex = /^0x[0-9a-fA-F]+$/u;

/** Internal client for a one-job encrypted session release and canonical mandate. */
export class FundedHealthGuardSessionClient {
  public constructor(
    private readonly config: Readonly<{ apiUrl: string; bearerToken: string; executorPrivateKeyPem: string }>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!/^https?:\/\//u.test(config.apiUrl)) throw new Error("RELIC_API_URL must be an HTTP(S) URL");
    if (!config.bearerToken.trim()) throw new Error("RELIC_HEALTH_GUARD_INTERNAL_TOKEN is required");
    if (!config.executorPrivateKeyPem.trim()) throw new Error("RELIC_HEALTH_GUARD_SESSION_TRANSFER_PRIVATE_KEY is required");
  }

  async release(commerceJobId: string): Promise<FundedHealthGuardSession> {
    const value = this.record(await this.request("/session", commerceJobId), "session release");
    const expiresAt = typeof value.expiresAt === "string" ? new Date(value.expiresAt) : null;
    if (
      value.commerceJobId !== commerceJobId || typeof value.mandateId !== "string" ||
      typeof value.walletAddress !== "string" || !address.test(value.walletAddress) ||
      typeof value.sessionAddress !== "string" || !address.test(value.sessionAddress) ||
      typeof value.sessionPublicKey !== "string" || !hex.test(value.sessionPublicKey) ||
      !value.permissions || typeof value.permissions !== "object" || Array.isArray(value.permissions) ||
      expiresAt === null || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date() ||
      typeof value.envelope !== "string"
    ) throw new Error("Health Guard funded session release returned malformed metadata");
    return Object.freeze({
      commerceJobId,
      mandateId: value.mandateId,
      walletAddress: value.walletAddress as Address,
      sessionAddress: value.sessionAddress as Address,
      sessionPublicKey: value.sessionPublicKey as `0x${string}`,
      permissions: value.permissions as Record<string, unknown>,
      expiresAt,
      sessionPrivateKey: openFundedSession(value.envelope, this.config.executorPrivateKeyPem),
    });
  }

  async canonicalExecution(commerceJobId: string): Promise<unknown> {
    return this.request("/execution-request", commerceJobId);
  }

  private async request(suffix: "/session" | "/execution-request", commerceJobId: string): Promise<unknown> {
    if (!/^\d+$/u.test(commerceJobId)) throw new Error("Health Guard funded job id is invalid");
    const response = await this.fetchImpl(
      new URL(`/internal/health-guard/funded-jobs/${encodeURIComponent(commerceJobId)}${suffix}`, this.config.apiUrl).toString(),
      { method: "POST", headers: { authorization: `Bearer ${this.config.bearerToken}` } },
    );
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text) as unknown; } catch { throw new Error("Health Guard funded-session API returned non-JSON"); }
    if (!response.ok) {
      const value = body && typeof body === "object" && !Array.isArray(body) ? body as { error?: unknown } : {};
      throw new Error(`Health Guard funded-session API failed (${String(response.status)}): ${String(value.error ?? "request failed")}`);
    }
    return body;
  }

  private record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Health Guard ${label} returned an invalid response`);
    return value as Record<string, unknown>;
  }
}
