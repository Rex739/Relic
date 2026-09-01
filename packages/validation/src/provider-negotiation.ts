import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  safeHttpRequest,
  type SafeHttpOptions,
  type SafeHttpResult,
} from "./safe-http.js";

const cardSchema = z.object({
  url: z.url(),
  skills: z.array(z.object({ id: z.string() })),
});
const signedQuoteSchema = z
  .object({
    request_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    response_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    negotiation_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    provider_sig: z.string().regex(/^0x[0-9a-fA-F]+$/),
    chain_id: z.number().int().positive(),
    verifying_contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    request: z.record(z.string(), z.unknown()).optional(),
    response: z
      .object({
        accepted: z.literal(true),
        terms: z
          .object({
            price: z.string().regex(/^\d+$/),
            currency: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
          })
          .passthrough(),
        negotiated_at: z.number().int().positive(),
        quote_expires_at: z.number().int().positive(),
      })
      .passthrough(),
  })
  .passthrough();
const responseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    parts: z.array(
      z.object({ kind: z.string(), data: z.unknown().optional() }),
    ),
  }),
});
const fundedResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    parts: z.array(
      z.object({ kind: z.string(), data: z.unknown().optional() }),
    ),
  }),
});

export type ProviderRequester = (
  endpoint: string,
  options?: SafeHttpOptions,
) => Promise<SafeHttpResult>;

export interface OfferNegotiationInput {
  endpoint: string;
  interfaceProtocol: string;
  agreementId: string;
  offerId: string;
  offerVersionId: string;
  capability: string;
  terms: string;
  termsHash: string;
  limitations: string[];
  chainId: number;
  amountBaseUnits: string;
  paymentTokenAddress: string;
}

export interface FundedJobNotificationInput {
  endpoint: string;
  interfaceProtocol: string;
  agreementId: string;
  jobId: string;
}

export async function negotiateOfferBoundService(
  input: OfferNegotiationInput,
  options: { requester?: ProviderRequester; messageId?: string } = {},
) {
  if (input.interfaceProtocol.toLowerCase() !== "a2a")
    throw new Error(
      `Service interface ${input.interfaceProtocol} is not supported for commerce validation`,
    );
  const requester = options.requester ?? safeHttpRequest;
  const cardResponse = await requester(input.endpoint, {
    method: "GET",
    timeoutMs: 5_000,
    maxRedirects: 2,
    maxResponseBytes: 64 * 1024,
  });
  if (!cardResponse.ok || cardResponse.status !== 200)
    throw new Error(
      `Provider card request failed (${cardResponse.errorCode ?? cardResponse.status})`,
    );
  const card = cardSchema.parse(JSON.parse(cardResponse.body));
  if (!card.skills.some(({ id }) => id === "negotiate"))
    throw new Error("Provider does not advertise offer negotiation");
  const reference = new URL(input.endpoint);
  const invocation = new URL(card.url);
  if (
    invocation.protocol !== "https:" ||
    invocation.hostname !== reference.hostname
  )
    throw new Error("Provider invocation URL must be same-host HTTPS");

  const messageId = options.messageId ?? randomUUID();
  const task = {
    task_description: `Execute capability ${input.capability} under the exact Relic marketplace offer bound to agreement ${input.agreementId}.`,
    terms: {
      deliverables: input.terms,
      quality_standards:
        input.limitations.length === 0
          ? "Return the advertised deliverable with reproducible evidence."
          : `Respect these advertised limitations: ${input.limitations.join("; ")}`,
      price: input.amountBaseUnits,
      currency: input.paymentTokenAddress,
      relic_offer: {
        offer_id: input.offerId,
        offer_version_id: input.offerVersionId,
        agreement_id: input.agreementId,
        terms_hash: input.termsHash,
        chain_id: input.chainId,
      },
    },
  };
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: `relic-commerce-${input.agreementId}`,
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ kind: "data", data: { skill: "negotiate", ...task } }],
        messageId,
      },
    },
  });
  const response = await requester(invocation.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    timeoutMs: 10_000,
    maxRedirects: 0,
    maxResponseBytes: 64 * 1024,
  });
  if (!response.ok || response.status !== 200)
    throw new Error(
      `Provider negotiation failed (${response.errorCode ?? response.status})`,
    );
  const parsed = responseSchema.parse(JSON.parse(response.body));
  const data = parsed.result.parts.find((part) => part.kind === "data")?.data;
  const quote = signedQuoteSchema.parse(data);
  if (quote.chain_id !== input.chainId)
    throw new Error("Provider quote chain does not match the offer");
  if (quote.response.terms.price !== input.amountBaseUnits)
    throw new Error("Provider quote price does not match the offer");
  if (
    quote.response.terms.currency.toLowerCase() !==
    input.paymentTokenAddress.toLowerCase()
  )
    throw new Error("Provider quote currency does not match the offer");
  if (quote.response.quote_expires_at <= quote.response.negotiated_at)
    throw new Error("Provider quote expiry is invalid");
  return {
    quote,
    task,
    taskId: parsed.result.taskId,
    contextId: parsed.result.contextId,
    messageId,
    responseSha256: createHash("sha256").update(response.body).digest("hex"),
  };
}

/**
 * Sends the standard BNB Studio delivery hand-off after the buyer's funded
 * ERC-8183 job has reached finality. The provider remains responsible for
 * independently checking the job before accepting or delivering it.
 */
export async function notifyFundedService(
  input: FundedJobNotificationInput,
  options: { requester?: ProviderRequester; messageId?: string } = {},
) {
  if (input.interfaceProtocol.toLowerCase() !== "a2a")
    throw new Error(
      `Service interface ${input.interfaceProtocol} is not supported for funded-job notification`,
    );
  if (!/^\d+$/.test(input.jobId))
    throw new Error("Funded job ID must be a non-negative integer");
  const requester = options.requester ?? safeHttpRequest;
  const cardResponse = await requester(input.endpoint, {
    method: "GET",
    timeoutMs: 5_000,
    maxRedirects: 2,
    maxResponseBytes: 64 * 1024,
  });
  if (!cardResponse.ok || cardResponse.status !== 200)
    throw new Error(
      `Provider card request failed (${cardResponse.errorCode ?? cardResponse.status})`,
    );
  const card = cardSchema.parse(JSON.parse(cardResponse.body));
  if (!card.skills.some(({ id }) => id === "notify_funded"))
    throw new Error("Provider does not advertise funded-job notification");
  const reference = new URL(input.endpoint);
  const invocation = new URL(card.url);
  if (
    invocation.protocol !== "https:" ||
    invocation.hostname !== reference.hostname
  )
    throw new Error("Provider invocation URL must be same-host HTTPS");

  const messageId = options.messageId ?? randomUUID();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: `relic-funded-${input.agreementId}`,
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [
          {
            kind: "data",
            data: { skill: "notify_funded", job_id: input.jobId },
          },
        ],
        messageId,
      },
    },
  });
  const response = await requester(invocation.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    timeoutMs: 10_000,
    maxRedirects: 0,
    maxResponseBytes: 64 * 1024,
  });
  if (!response.ok || response.status !== 200)
    throw new Error(
      `Provider funded-job notification failed (${response.errorCode ?? response.status})`,
    );
  const parsed = fundedResponseSchema.parse(JSON.parse(response.body));
  const data = parsed.result.parts.find((part) => part.kind === "data")?.data;
  const result = z
    .object({
      status: z.enum(["accepted", "rejected", "retry"]).optional(),
      job_id: z.union([z.string(), z.number()]).optional(),
      error: z.string().optional(),
    })
    .passthrough()
    .parse(data);
  if (String(result.job_id ?? "") !== input.jobId)
    throw new Error("Provider funded-job response does not match the job");
  if (result.status === "rejected")
    throw new Error(result.error ?? "Provider rejected the funded job");
  return { status: result.status ?? "accepted", messageId };
}
