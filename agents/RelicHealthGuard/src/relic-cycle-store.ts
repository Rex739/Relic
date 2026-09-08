import type { HealthGuardCycleIdentity, HealthGuardCycleStore } from "./executor.js";
import type { HealthObservation, RepayHistory } from "./policy.js";

type FetchLike = typeof fetch;
type CycleState = "OBSERVED" | "NO_ACTION" | "POLICY_ACCEPTED" | "APPROVAL_SUBMITTED" | "APPROVED" | "REPAY_SUBMITTED" | "COMPLETED" | "RECOVERY_REQUIRED";

type WireCycle = Readonly<{
  id: string;
  commerceJobId: string;
  state: CycleState;
  revision: number;
}>;

const asRecord = (value: unknown, detail: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(detail);
  return value as Record<string, unknown>;
};
const decimal = (value: unknown, detail: string): bigint => {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) throw new Error(detail);
  return BigInt(value);
};
const parseCycle = (value: unknown): WireCycle => {
  const cycle = asRecord(value, "Relic Health Guard cycle store returned an invalid cycle");
  if (
    typeof cycle.id !== "string" || typeof cycle.commerceJobId !== "string" ||
    typeof cycle.state !== "string" || !Number.isInteger(cycle.revision)
  ) throw new Error("Relic Health Guard cycle store returned malformed cycle fields");
  return cycle as WireCycle;
};

/**
 * The private agent's only persistence transport. It uses a service bearer
 * token and exposes no buyer session material to the public gateway.
 */
export class RelicHealthGuardCycleStore implements HealthGuardCycleStore {
  public constructor(
    private readonly config: Readonly<{ apiUrl: string; bearerToken: string }>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!/^https?:\/\//u.test(config.apiUrl)) throw new Error("RELIC_API_URL must be an HTTP(S) URL");
    if (!config.bearerToken.trim()) throw new Error("RELIC_HEALTH_GUARD_INTERNAL_TOKEN is required");
  }

  async createOrFind(input: HealthGuardCycleIdentity & {
    commerceJobId: string;
    observation: HealthObservation;
  }): Promise<{ created: boolean; state: string }> {
    const body = asRecord(await this.request("POST", "/internal/health-guard/cycles", {
      id: input.id,
      commerceJobId: input.commerceJobId,
      idempotencyKey: input.idempotencyKey,
      observedAt: input.observation.observedAt.toISOString(),
      healthFactorWad: input.observation.healthFactorWad.toString(),
      outstandingDebtBaseUnits: input.observation.outstandingDebtBaseUnits.toString(),
      rescueWalletBalanceBaseUnits: input.observation.rescueWalletUsdtBaseUnits.toString(),
    }), "Relic Health Guard cycle store returned an invalid create response");
    if (typeof body.created !== "boolean") throw new Error("Relic Health Guard cycle store returned malformed create state");
    return { created: body.created, state: parseCycle(body.cycle).state };
  }

  async history(commerceJobId: string): Promise<RepayHistory> {
    const body = asRecord(
      await this.request("GET", `/internal/health-guard/funded-jobs/${encodeURIComponent(commerceJobId)}/repay-history`),
      "Relic Health Guard cycle store returned an invalid history response",
    );
    const lastRepayAt = body.lastRepayAt === null ? undefined : new Date(String(body.lastRepayAt));
    if (lastRepayAt && Number.isNaN(lastRepayAt.getTime())) throw new Error("Relic Health Guard cycle store returned an invalid repayment timestamp");
    return {
      aggregateRepaidBaseUnits: decimal(body.aggregateRepaidBaseUnits, "Relic Health Guard cycle store returned malformed aggregate repayment"),
      ...(lastRepayAt === undefined ? {} : { lastRepayAt }),
    };
  }

  async transition(input: HealthGuardCycleIdentity & {
    to: "NO_ACTION" | "POLICY_ACCEPTED" | "APPROVAL_SUBMITTED" | "APPROVED" | "REPAY_SUBMITTED" | "COMPLETED" | "RECOVERY_REQUIRED";
    expectedRevision: number;
    decisionReason?: string;
    repayAmountBaseUnits?: bigint;
    transactionHash?: `0x${string}`;
    recoveryReason?: string;
  }): Promise<{ state: string; revision: number } | null> {
    const body = asRecord(await this.request("POST", `/internal/health-guard/cycles/${encodeURIComponent(input.id)}/transitions`, {
      expectedRevision: input.expectedRevision,
      to: input.to,
      ...(input.decisionReason === undefined ? {} : { decisionReason: input.decisionReason }),
      ...(input.repayAmountBaseUnits === undefined ? {} : { repayAmountBaseUnits: input.repayAmountBaseUnits.toString() }),
      ...(input.transactionHash === undefined ? {} : { transactionHash: input.transactionHash }),
      ...(input.recoveryReason === undefined ? {} : { recoveryReason: input.recoveryReason }),
    }), "Relic Health Guard cycle store returned an invalid transition response");
    if (body.cycle === null) return null;
    const cycle = parseCycle(body.cycle);
    return { state: cycle.state, revision: cycle.revision };
  }

  private async request(method: "GET" | "POST", path: string, payload?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(new URL(path, this.config.apiUrl).toString(), {
      method,
      headers: {
        authorization: `Bearer ${this.config.bearerToken}`,
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text) as unknown; } catch { throw new Error("Relic Health Guard cycle store returned non-JSON response"); }
    if (!response.ok) {
      const value = body && typeof body === "object" && !Array.isArray(body) ? body as { error?: unknown } : {};
      throw new Error(`Relic Health Guard cycle store ${method} ${path} failed (${String(response.status)}): ${String(value.error ?? "request failed")}`);
    }
    return body;
  }
}
