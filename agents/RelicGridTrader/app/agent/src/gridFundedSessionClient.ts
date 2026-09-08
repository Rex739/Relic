import { openGridFundedSession } from "./gridSessionEnvelope.js";
import type { Address } from "viem";

export type GridFundedSession = Readonly<{
  commerceJobId: string;
  mandateId: string;
  walletAddress: Address;
  sessionPublicKey: `0x${string}`;
  permissions: Record<string, unknown>;
  expiresAt: Date;
  sessionPrivateKey: `0x${string}`;
}>;

const address = /^0x[0-9a-fA-F]{40}$/u;
const hex = /^0x[0-9a-fA-F]+$/u;

export class GridFundedSessionClient {
  constructor(private readonly config: Readonly<{ apiUrl: string; bearerToken: string; executorPrivateKeyPem: string }>) {
    if (!/^https?:\/\//u.test(config.apiUrl)) throw new Error("RELIC_API_URL must be an HTTP(S) URL");
    if (!config.bearerToken.trim()) throw new Error("RELIC_GRID_TRADER_INTERNAL_TOKEN is required");
    if (!config.executorPrivateKeyPem.trim()) throw new Error("RELIC_GRID_SESSION_TRANSFER_PRIVATE_KEY is required");
  }

  async release(jobId: string): Promise<GridFundedSession> {
    const response = await fetch(new URL(`/internal/grid-trader/funded-jobs/${encodeURIComponent(jobId)}/session`, this.config.apiUrl), {
      method: "POST", headers: { authorization: `Bearer ${this.config.bearerToken}` },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Grid funded-session release failed (${String(response.status)}): ${detail(body)}`);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Grid funded-session release returned invalid data");
    const value = body as Record<string, unknown>;
    const expiresAt = typeof value.expiresAt === "string" ? new Date(value.expiresAt) : null;
    if (value.commerceJobId !== jobId || typeof value.mandateId !== "string" || typeof value.walletAddress !== "string" || !address.test(value.walletAddress) || typeof value.sessionPublicKey !== "string" || !hex.test(value.sessionPublicKey) || !value.permissions || typeof value.permissions !== "object" || Array.isArray(value.permissions) || !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date() || typeof value.envelope !== "string")
      throw new Error("Grid funded-session release returned malformed data");
    const sessionPrivateKey = openGridFundedSession(value.envelope, this.config.executorPrivateKeyPem);
    if (!hex.test(sessionPrivateKey)) throw new Error("Grid funded-session release returned an invalid session key");
    return Object.freeze({ commerceJobId: jobId, mandateId: value.mandateId, walletAddress: value.walletAddress as Address, sessionPublicKey: value.sessionPublicKey as `0x${string}`, permissions: value.permissions as Record<string, unknown>, expiresAt, sessionPrivateKey: sessionPrivateKey as `0x${string}` });
  }

  async request(jobId: string): Promise<GridExecutionRequest> {
    const response = await fetch(new URL(`/internal/grid-trader/funded-jobs/${encodeURIComponent(jobId)}/execution-request`, this.config.apiUrl), {
      method: "POST", headers: { authorization: `Bearer ${this.config.bearerToken}` },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Grid execution request failed (${String(response.status)}): ${detail(body)}`);
    return parseRequest(body, jobId);
  }
}

export type GridExecutionRequest = Readonly<{ commerceJobId: string; idempotencyKey: string; mandate: { account: Address; expiresAt: Date; maximumCapitalBaseUnits: bigint; lowerPrice: string; upperPrice: string; gridLevels: number; minimumSecondsBetweenExecutions: number }; maximumFeeWei: bigint }>;
export type GridExecutionJob = Readonly<{ id: string; state: string; revision: number; approvalTxHash: string | null; swapTxHash: string | null; recoveryReason: string | null }>;

function detail(body: unknown) { return body && typeof body === "object" && !Array.isArray(body) ? String((body as { error?: unknown }).error ?? "request failed") : "request failed"; }
function parsePositive(value: unknown, label: string) { if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) throw new Error(`Grid execution request rejected: ${label}`); return BigInt(value); }
function parseRequest(body: unknown, jobId: string): GridExecutionRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Grid execution request returned invalid data");
  const input = body as Record<string, unknown>;
  const mandate = input.mandate;
  if (input.kind !== "relic.funded_grid_job.v1" || input.commerceJobId !== jobId || typeof input.idempotencyKey !== "string" || !mandate || typeof mandate !== "object" || Array.isArray(mandate)) throw new Error("Grid execution request is not canonical");
  const value = mandate as Record<string, unknown>;
  const expiresAt = typeof value.expiresAt === "string" ? new Date(value.expiresAt) : null;
  if (typeof value.account !== "string" || !address.test(value.account) || !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date() || typeof value.lowerPrice !== "string" || typeof value.upperPrice !== "string" || !/^\d+(?:\.\d+)?$/u.test(value.lowerPrice) || !/^\d+(?:\.\d+)?$/u.test(value.upperPrice) || typeof value.gridLevels !== "number" || !Number.isInteger(value.gridLevels) || value.gridLevels < 5 || value.gridLevels > 8 || typeof value.minimumSecondsBetweenExecutions !== "string" || !/^\d+$/u.test(value.minimumSecondsBetweenExecutions)) throw new Error("Grid execution request has invalid mandate fields");
  return Object.freeze({ commerceJobId: jobId, idempotencyKey: input.idempotencyKey, mandate: Object.freeze({ account: value.account as Address, expiresAt, maximumCapitalBaseUnits: parsePositive(value.maximumCapitalBaseUnits, "maximumCapitalBaseUnits"), lowerPrice: value.lowerPrice, upperPrice: value.upperPrice, gridLevels: value.gridLevels, minimumSecondsBetweenExecutions: Number(value.minimumSecondsBetweenExecutions) }), maximumFeeWei: parsePositive(input.maximumFeeWei, "maximumFeeWei") });
}

declare module "./gridFundedSessionClient.js" {
  interface GridFundedSessionClient {
    createOrFindExecution(input: { id: string; commerceJobId: string; idempotencyKey: string }): Promise<{ created: boolean; job: GridExecutionJob }>;
    transitionExecution(input: { id: string; expectedRevision: number; to: string; transactionHash?: string; recoveryReason?: string }): Promise<GridExecutionJob | null>;
  }
}

GridFundedSessionClient.prototype.createOrFindExecution = async function(input) {
  const body = await internalRequest(this, "POST", "/internal/grid-trader/execution-jobs", input);
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { created?: unknown }).created !== "boolean") throw new Error("Grid execution store returned an invalid create response");
  return { created: (body as { created: boolean }).created, job: parseJob((body as { job?: unknown }).job) };
};
GridFundedSessionClient.prototype.transitionExecution = async function(input) {
  const { id, ...payload } = input;
  const body = await internalRequest(this, "POST", `/internal/grid-trader/execution-jobs/${encodeURIComponent(id)}/transitions`, payload);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Grid execution store returned an invalid transition response");
  const job = (body as { job?: unknown }).job;
  return job === null ? null : parseJob(job);
};

function parseJob(value: unknown): GridExecutionJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Grid execution store returned an invalid job");
  const job = value as Partial<GridExecutionJob>;
  if (typeof job.id !== "string" || typeof job.state !== "string" || !Number.isInteger(job.revision) || (typeof job.approvalTxHash !== "string" && job.approvalTxHash !== null) || (typeof job.swapTxHash !== "string" && job.swapTxHash !== null) || (typeof job.recoveryReason !== "string" && job.recoveryReason !== null)) throw new Error("Grid execution store returned malformed job fields");
  return job as GridExecutionJob;
}
async function internalRequest(client: GridFundedSessionClient, method: "POST", path: string, payload: unknown): Promise<unknown> {
  const config = (client as unknown as { config: { apiUrl: string; bearerToken: string } }).config;
  const response = await fetch(new URL(path, config.apiUrl), { method, headers: { authorization: `Bearer ${config.bearerToken}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Grid execution store ${method} ${path} failed (${String(response.status)}): ${detail(body)}`);
  return body;
}
