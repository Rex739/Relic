import { createHash, randomUUID } from "node:crypto";

import { createDatabase, DrizzleSupplyStore } from "@relic/database";
import { z } from "zod";

import { safeHttpRequest } from "./endpoint-observer.js";

const arg = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const quoteSchema = z.object({
  request_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  response_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  negotiation_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  provider_sig: z.string().regex(/^0x[0-9a-fA-F]+$/),
  chain_id: z.number().int().positive(),
  verifying_contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  response: z.object({
    accepted: z.literal(true),
    terms: z.object({
      price: z.string().regex(/^\d+$/),
      currency: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    }),
    negotiated_at: z.number().int().positive(),
    quote_expires_at: z.number().int().positive(),
  }),
});

const a2aResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    parts: z.array(
      z.object({
        kind: z.string(),
        data: z.unknown().optional(),
      }),
    ),
  }),
});

const cardSchema = z.object({
  name: z.string().min(1),
  url: z.url(),
  protocolVersion: z.string().min(1),
  skills: z.array(z.object({ id: z.string() })),
});

export const invocationTasks: Record<
  string,
  { task_description: string; terms: Record<string, unknown> }
> = {
  rebalancing: {
    task_description:
      "Produce a read-only PancakeSwap V3 BNB/USDT LP range rebalance analysis; do not move capital.",
    terms: {
      deliverables:
        "JSON current-range assessment and deterministic recommended range",
      quality_standards:
        "Use observed BSC data, include block/timestamp provenance, and do not execute transactions",
    },
  },
  "grid-trading": {
    task_description:
      "Produce a read-only BNB/USDT grid strategy; do not place orders or move capital.",
    terms: {
      deliverables:
        "JSON grid levels, allocation per level, fee assumptions, and risk constraints",
      quality_standards:
        "Use current observed BSC market data, include timestamp provenance, and do not execute transactions",
    },
  },
  "yield-optimisation": {
    task_description:
      "Produce a read-only Venus Core supply-yield opportunity analysis on BSC Testnet; do not move funds or execute transactions.",
    terms: {
      deliverables:
        "JSON ranked supply markets with APY, liquidity, pinned block number, and raw evidence",
      quality_standards:
        "Use observed Venus Core BSC Testnet data, preserve block provenance, explain unavailable fields, and do not move funds",
    },
  },
};

export function parseSignedA2aQuote(value: unknown) {
  const parsed = a2aResponseSchema.parse(value);
  const part = parsed.result.parts.find(
    (candidate) => candidate.kind === "data" && candidate.data !== undefined,
  );
  if (!part) throw new Error("A2A response has no data part");
  return {
    taskId: parsed.result.taskId,
    contextId: parsed.result.contextId,
    quote: quoteSchema.parse(part.data),
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const serviceId = arg("service-id");
  if (!serviceId) throw new Error("--service-id=<uuid> is required");

  const connection = createDatabase(databaseUrl, { max: 2 });
  try {
    const store = new DrizzleSupplyStore(connection.db);
    const selected = await store.findServiceCandidate(serviceId);
    if (!selected) throw new Error(`Service ${serviceId} was not found`);
    if (selected.service.interfaceProtocol !== "a2a")
      throw new Error("External invocation currently supports A2A only");
    if (
      selected.service.availability !== "available" ||
      selected.service.endpoint === null
    )
      throw new Error("Service must have a currently available endpoint");
    const endpoint = selected.service.endpoint;
    if (selected.candidate.status !== "SERVICE_OBSERVED")
      throw new Error("Candidate must be in SERVICE_OBSERVED state");
    const task = invocationTasks[selected.candidate.categorySlug];
    if (!task)
      throw new Error(
        "No bounded invocation template exists for this category",
      );

    const cardResponse = await safeHttpRequest(endpoint, {
      method: "GET",
      timeoutMs: 5_000,
      maxRedirects: 2,
      maxResponseBytes: 64 * 1024,
    });
    if (!cardResponse.ok || cardResponse.status !== 200)
      throw new Error("A2A card is no longer available");
    const card = cardSchema.parse(JSON.parse(cardResponse.body));
    if (!card.skills.some(({ id }) => id === "negotiate"))
      throw new Error("A2A card does not declare a negotiate skill");
    const cardUrl = new URL(endpoint);
    const invocationUrl = new URL(card.url);
    if (
      invocationUrl.protocol !== "https:" ||
      invocationUrl.hostname !== cardUrl.hostname
    )
      throw new Error("A2A invocation URL must be same-host HTTPS");

    const messageId = randomUUID();
    const request = {
      jsonrpc: "2.0",
      id: `relic-phase06-${selected.candidate.categorySlug}`,
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "data", data: { skill: "negotiate", ...task } }],
          messageId,
        },
      },
    };
    const response = await safeHttpRequest(invocationUrl.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      timeoutMs: 10_000,
      maxRedirects: 0,
      maxResponseBytes: 64 * 1024,
    });
    if (!response.ok || response.status !== 200)
      throw new Error(`A2A invocation failed with HTTP ${response.status}`);
    const signed = parseSignedA2aQuote(JSON.parse(response.body));
    if (signed.quote.chain_id !== selected.identity.chainId)
      throw new Error("Signed quote chain does not match canonical identity");

    const evidence = {
      dataKind: "real-external-invocation",
      protocol: "a2a-0.3.0",
      operation: "negotiate",
      category: selected.candidate.categorySlug,
      serviceId: selected.service.id,
      externalAgentId: selected.identity.externalAgentId,
      chainId: signed.quote.chain_id,
      taskId: signed.taskId,
      contextId: signed.contextId,
      requestMessageId: messageId,
      requestHash: signed.quote.request_hash,
      responseHash: signed.quote.response_hash,
      negotiationHash: signed.quote.negotiation_hash,
      providerSignature: signed.quote.provider_sig,
      verifyingContract: signed.quote.verifying_contract,
      accepted: true,
      price: signed.quote.response.terms.price,
      currency: signed.quote.response.terms.currency,
      negotiatedAt: signed.quote.response.negotiated_at,
      quoteExpiresAt: signed.quote.response.quote_expires_at,
      responseSha256: createHash("sha256").update(response.body).digest("hex"),
      jobCreated: false,
      paymentSent: false,
      transactionAttempted: false,
    };
    await store.recordServiceVerification({
      serviceId: selected.service.id,
      fromLevel: selected.service.verificationLevel,
      toLevel: "INVOCATION_VERIFIED",
      result: "passed",
      protocol: "a2a",
      requestMethod: "POST",
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      availability: "available",
      evidence,
    });
    await store.transitionCandidate({
      candidateId: selected.candidate.id,
      from: "SERVICE_OBSERVED",
      to: "INVOCATION_VERIFIED",
      evidence,
    });
    console.info(
      JSON.stringify({ event: "external_invocation_verified", ...evidence }),
    );
  } finally {
    await connection.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
