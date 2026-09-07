import type { CreateYieldJob, JobTransition, YieldJob, YieldJobStore } from "./jobState.js";

type FetchLike = typeof fetch;

type WireJob = {
  id: string;
  commerceJobId: string;
  idempotencyKey: string;
  state: YieldJob["state"];
  revision: number;
  approvalTxHash: string | null;
  supplyTxHash: string | null;
  withdrawTxHash: string | null;
  recoveryReason: string | null;
  createdAt: string;
  updatedAt: string;
};

const parseJob = (value: unknown): YieldJob => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Relic execution store returned an invalid job");
  const job = value as Partial<WireJob>;
  if (
    typeof job.id !== "string" || typeof job.commerceJobId !== "string" || typeof job.idempotencyKey !== "string" ||
    typeof job.state !== "string" || !Number.isInteger(job.revision) ||
    typeof job.approvalTxHash !== "string" && job.approvalTxHash !== null ||
    typeof job.supplyTxHash !== "string" && job.supplyTxHash !== null ||
    typeof job.withdrawTxHash !== "string" && job.withdrawTxHash !== null ||
    typeof job.recoveryReason !== "string" && job.recoveryReason !== null ||
    typeof job.createdAt !== "string" || typeof job.updatedAt !== "string"
  ) throw new Error("Relic execution store returned malformed job fields");
  const createdAt = new Date(job.createdAt);
  const updatedAt = new Date(job.updatedAt);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) throw new Error("Relic execution store returned invalid job timestamps");
  return Object.freeze({ ...job, state: job.state as YieldJob["state"], createdAt, updatedAt }) as YieldJob;
};

/**
 * Durable Layer A state lives in Relic's database, not in a container. The
 * private executor reaches this internal API over Northflank private network
 * with a dedicated service credential. No browser can use this adapter.
 */
export class RelicExecutionJobStore implements YieldJobStore {
  public constructor(
    private readonly config: Readonly<{ apiUrl: string; bearerToken: string }>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!/^https?:\/\//u.test(config.apiUrl)) throw new Error("RELIC_API_URL must be an HTTP(S) URL");
    if (!config.bearerToken.trim()) throw new Error("RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN is required");
  }

  async createOrFind(input: CreateYieldJob): Promise<{ created: boolean; job: YieldJob }> {
    const body = await this.request("POST", "/internal/yield-optimizer/execution-jobs", {
      id: input.id, commerceJobId: input.commerceJobId, idempotencyKey: input.idempotencyKey,
    });
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Relic execution store returned an invalid create response");
    const response = body as { created?: unknown; job?: unknown };
    if (typeof response.created !== "boolean") throw new Error("Relic execution store returned an invalid create response");
    return { created: response.created, job: parseJob(response.job) };
  }

  async transition(input: JobTransition): Promise<YieldJob | null> {
    const body = await this.request("POST", `/internal/yield-optimizer/execution-jobs/${encodeURIComponent(input.id)}/transitions`, {
      expectedRevision: input.expectedRevision,
      to: input.to,
      ...(input.transactionHash === undefined ? {} : { transactionHash: input.transactionHash }),
      ...(input.recoveryReason === undefined ? {} : { recoveryReason: input.recoveryReason }),
    });
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Relic execution store returned an invalid transition response");
    const response = body as { job?: unknown };
    return response.job === null ? null : parseJob(response.job);
  }

  async get(id: string): Promise<YieldJob | null> {
    const body = await this.request("GET", `/internal/yield-optimizer/execution-jobs/${encodeURIComponent(id)}`);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Relic execution store returned an invalid get response");
    const response = body as { job?: unknown };
    return response.job === null ? null : parseJob(response.job);
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
    try { body = JSON.parse(text) as unknown; } catch { throw new Error("Relic execution store returned non-JSON response"); }
    if (!response.ok) {
      const detail = body && typeof body === "object" && !Array.isArray(body) ? String((body as { error?: unknown }).error ?? "request failed") : "request failed";
      throw new Error(`Relic execution store ${method} ${path} failed (${String(response.status)}): ${detail}`);
    }
    return body;
  }
}
