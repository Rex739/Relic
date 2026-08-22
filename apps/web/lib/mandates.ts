import "server-only";

import { createHmac } from "node:crypto";
import { cookies } from "next/headers";

import type {
  CreateMandateRequest,
  ExecutionActionRequest,
  ExecutionRecord,
  Mandate,
  MandateListItem,
  VerifiedMandateProfile,
} from "@relic/domain";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");
export const developmentPrincipalId = () =>
  process.env.RELIC_DEVELOPMENT_PRINCIPAL_ID ??
  "01945b1e-7e80-7000-8000-000000000900";
const mandateSecret = () =>
  process.env.MANDATE_API_SECRET ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "relic-local-development-mandate-secret-not-production");

const mandateHeaders = async (method: string, path: string) => {
  const sessionToken = (await cookies()).get("relic_session")?.value;
  if (sessionToken !== undefined)
    return { authorization: `Bearer ${sessionToken}` };
  if (process.env.NODE_ENV === "production")
    throw new Error("Connect a wallet to access your Relic relationships");
  const secret = mandateSecret();
  if (secret === undefined)
    throw new Error("Mandate authorization is not configured");
  const principalId = developmentPrincipalId();
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}:${method.toUpperCase()}:${path}:${principalId}`)
    .digest("hex");
  return {
    "x-relic-principal-id": principalId,
    "x-relic-mandate-timestamp": timestamp,
    "x-relic-mandate-signature": signature,
  };
};

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    authenticated?: boolean;
    headers?: Record<string, string>;
  } = {},
) {
  const method = options.method ?? "GET";
  const response = await fetch(`${apiUrl()}${path}`, {
    method,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.authenticated === false
        ? {}
        : await mandateHeaders(method, path)),
      ...options.headers,
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const payload = (await response.json()) as {
    data?: T;
    error?: { code: string; message: string };
  };
  if (!response.ok || payload.data === undefined)
    throw new Error(
      payload.error?.message ?? `Mandate API returned ${response.status}`,
    );
  return payload.data;
}

export type ActivationProfile = {
  profile: VerifiedMandateProfile;
  template: CreateMandateRequest | null;
};

export const activationProfile = (agentId: string) =>
  request<ActivationProfile>(
    `/v1/marketplace/agents/${encodeURIComponent(agentId)}/activation-profile`,
    { authenticated: false },
  );

export const createMandate = (configuration: CreateMandateRequest) =>
  request<Mandate>("/v1/mandates", { method: "POST", body: configuration });

export const getMandate = (id: string) =>
  request<Mandate>(`/v1/mandates/${encodeURIComponent(id)}`);

export const listMyAgents = () => request<MandateListItem[]>("/v1/my-agents");

export const editMandate = (id: string, configuration: CreateMandateRequest) =>
  request<Mandate>(`/v1/mandates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: configuration,
  });

export const transitionMandate = (
  id: string,
  action: "review" | "activate" | "pause" | "resume" | "revoke",
) =>
  request<Mandate>(`/v1/mandates/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    ...(action === "activate" ? { body: { explicitlyApproved: true } } : {}),
  });

export const listExecutions = (mandateId: string) =>
  request<ExecutionRecord[]>(
    `/v1/mandates/${encodeURIComponent(mandateId)}/executions`,
  );

export const requestExecution = (
  mandateId: string,
  idempotencyKey: string,
  action: ExecutionActionRequest,
) =>
  request<ExecutionRecord>(
    `/v1/mandates/${encodeURIComponent(mandateId)}/executions`,
    {
      method: "POST",
      body: action,
      headers: { "idempotency-key": idempotencyKey },
    },
  );

export const approveExecution = (
  mandateId: string,
  executionId: string,
  normalizedHash: string,
  approved: boolean,
) =>
  request<ExecutionRecord>(
    `/v1/mandates/${encodeURIComponent(mandateId)}/executions/${encodeURIComponent(executionId)}/approval`,
    { method: "POST", body: { normalizedHash, approved } },
  );
