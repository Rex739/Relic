import "server-only";

import { cookies } from "next/headers";

import type {
  AgentOffer,
  CreateOfferRequest,
  SellerAgentReadiness,
} from "@relic/domain";

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

async function request<T>(path: string, options: RequestInit = {}) {
  const token = (await cookies()).get("relic_session")?.value;
  if (token === undefined) throw new Error("Connect a wallet to continue");
  const response = await fetch(`${apiUrl()}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...options.headers,
    },
  });
  const payload = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.data === undefined)
    throw new Error(
      payload.error?.message ?? `Commerce API returned ${response.status}`,
    );
  return payload.data;
}

export async function activeOffers(agentId: string): Promise<AgentOffer[]> {
  const response = await fetch(
    `${apiUrl()}/v1/marketplace/agents/${encodeURIComponent(agentId)}/offers`,
    { cache: "no-store", headers: { accept: "application/json" } },
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as { data: AgentOffer[] };
  return payload.data;
}

export const hireOffer = (offerId: string, mandateId: string) =>
  request<Record<string, unknown>>(
    `/v1/offers/${encodeURIComponent(offerId)}/hire`,
    {
      method: "POST",
      body: JSON.stringify({ mandateId }),
    },
  );

export type CommerceAgreementView = Record<string, unknown> & {
  id: string;
  mandateId: string | null;
  status: string;
  authorizationArtifactId: string | null;
  expiresAt: string | null;
  pricingSnapshot: {
    amountBaseUnits: string;
    decimals: number;
    symbol: string;
    tokenAddress: string;
  };
  operations: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  authorizations: Array<{
    id: string;
    executionRequestId: string | null;
    verificationStatus: string;
    signerAddress: string | null;
    actionHash: string | null;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
  }>;
  movements: Array<Record<string, unknown>>;
  settlements: Array<Record<string, unknown>>;
};

export const agreement = (id: string) =>
  request<CommerceAgreementView>(
    `/v1/commerce-agreements/${encodeURIComponent(id)}`,
  );

export const agreements = () =>
  request<Array<CommerceAgreementView | null>>("/v1/commerce-agreements");

export const acceptTerms = (id: string, termsHash: string) =>
  request<Record<string, unknown>>(
    `/v1/commerce-agreements/${encodeURIComponent(id)}/accept-terms`,
    { method: "POST", body: JSON.stringify({ termsHash }) },
  );

export const cancelAgreement = (id: string) =>
  request<CommerceAgreementView>(
    `/v1/commerce-agreements/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  );

export const revokeAgreementAuthorization = (id: string) =>
  request<CommerceAgreementView>(
    `/v1/commerce-agreements/${encodeURIComponent(id)}/revoke-authorization`,
    { method: "POST" },
  );

export const createCommerceActivation = (
  id: string,
  executionRequestId: string,
  authorizationId: string,
) =>
  request<Record<string, unknown>>(
    `/v1/commerce-agreements/${encodeURIComponent(id)}/activations`,
    {
      method: "POST",
      body: JSON.stringify({ executionRequestId, authorizationId }),
    },
  );

export const operatorOffers = () =>
  request<Array<AgentOffer | null>>("/v1/operator/offers");

export const operatorAgreements = () =>
  request<Array<Record<string, unknown>>>("/v1/operator/commerce-agreements");

export const operatorReadiness = () =>
  request<SellerAgentReadiness[]>("/v1/operator/readiness");

export const createOperatorOffer = (body: CreateOfferRequest) =>
  request<AgentOffer>("/v1/operator/offers", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const reviseOperatorOffer = (id: string, body: CreateOfferRequest) =>
  request<AgentOffer>(`/v1/operator/offers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const transitionOperatorOffer = (
  id: string,
  action: "activate" | "pause" | "deactivate",
) =>
  request<AgentOffer>(
    `/v1/operator/offers/${encodeURIComponent(id)}/${action}`,
    { method: "POST" },
  );
