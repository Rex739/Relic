import { createHash } from "node:crypto";

import { createDatabase, DrizzleSupplyStore } from "@relic/database";
import { z } from "zod";

import { safeHttpRequest } from "./endpoint-observer.js";

const arg = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const statusSchema = z.object({
  provider: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  service_price: z.string().regex(/^\d+$/),
  token_symbol: z.string().min(1),
  network: z.string().min(1),
  chain_id: z.number().int().positive(),
});

const quoteSchema = z.object({
  provider: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  price: z.string().regex(/^\d+$/),
  currency: z.string().min(1),
  estimated_completion_seconds: z.number().int().nonnegative(),
  service: z.string().min(1),
  quoted_at: z.iso.datetime({ offset: true }),
});

export function verifyErc8183Quote(statusValue: unknown, quoteValue: unknown) {
  const status = statusSchema.parse(statusValue);
  const quote = quoteSchema.parse(quoteValue);
  if (status.provider.toLowerCase() !== quote.provider.toLowerCase())
    throw new Error("ERC-8183 quote provider does not match status provider");
  if (status.service_price !== quote.price)
    throw new Error("ERC-8183 quote price does not match advertised price");
  if (status.token_symbol !== quote.currency)
    throw new Error("ERC-8183 quote currency does not match advertised token");
  return { status, quote };
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
    if (selected.service.interfaceProtocol !== "erc8183")
      throw new Error("External invocation requires an ERC-8183 service");
    if (
      selected.service.availability !== "available" ||
      selected.service.endpoint === null
    )
      throw new Error("Service must have a currently available endpoint");
    if (selected.candidate.status !== "SERVICE_OBSERVED")
      throw new Error("Candidate must be in SERVICE_OBSERVED state");
    if (selected.candidate.categorySlug !== "yield-optimisation")
      throw new Error("No bounded ERC-8183 template exists for this category");

    const base = new URL(selected.service.endpoint);
    const normalized = base.pathname.replace(/\/+$/, "");
    base.pathname = normalized.endsWith("/erc8183")
      ? normalized
      : `${normalized}/erc8183`;
    const statusUrl = new URL(base);
    statusUrl.pathname = `${base.pathname}/status`;
    const negotiateUrl = new URL(base);
    negotiateUrl.pathname = `${base.pathname}/negotiate`;

    const statusResponse = await safeHttpRequest(statusUrl.toString(), {
      method: "GET",
      timeoutMs: 5_000,
      maxRedirects: 0,
      maxResponseBytes: 64 * 1024,
    });
    if (!statusResponse.ok || statusResponse.status !== 200)
      throw new Error("ERC-8183 status endpoint is no longer available");

    const request = {
      task_description:
        "Produce a read-only risk-adjusted BSC yield allocation; do not move capital.",
      terms: {
        deliverables:
          "JSON ranked protocol allocations with observed APY/APR, constraints, and source timestamps",
        quality_standards:
          "Use current BSC protocol observations, explain risk adjustments, and do not execute transactions",
      },
    };
    const quoteResponse = await safeHttpRequest(negotiateUrl.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      timeoutMs: 10_000,
      maxRedirects: 0,
      maxResponseBytes: 64 * 1024,
    });
    if (!quoteResponse.ok || quoteResponse.status !== 200)
      throw new Error(
        `ERC-8183 negotiation failed with HTTP ${quoteResponse.status}`,
      );
    const verified = verifyErc8183Quote(
      JSON.parse(statusResponse.body),
      JSON.parse(quoteResponse.body),
    );
    if (verified.status.chain_id !== selected.identity.chainId)
      throw new Error(
        "ERC-8183 status chain does not match canonical identity",
      );

    const evidence = {
      dataKind: "real-external-invocation",
      protocol: "erc8183",
      operation: "negotiate",
      category: selected.candidate.categorySlug,
      serviceId: selected.service.id,
      externalAgentId: selected.identity.externalAgentId,
      chainId: verified.status.chain_id,
      network: verified.status.network,
      provider: verified.quote.provider,
      accepted: true,
      price: verified.quote.price,
      currency: verified.quote.currency,
      quotedAt: verified.quote.quoted_at,
      estimatedCompletionSeconds: verified.quote.estimated_completion_seconds,
      responseSha256: createHash("sha256")
        .update(quoteResponse.body)
        .digest("hex"),
      jobCreated: false,
      paymentSent: false,
      transactionAttempted: false,
    };
    await store.recordServiceVerification({
      serviceId: selected.service.id,
      fromLevel: selected.service.verificationLevel,
      toLevel: "INVOCATION_VERIFIED",
      result: "passed",
      protocol: "erc8183",
      requestMethod: "POST",
      httpStatus: quoteResponse.status,
      latencyMs: quoteResponse.latencyMs,
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
