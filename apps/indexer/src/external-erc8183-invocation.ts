import { createHash } from "node:crypto";

import { verifyQuoteSignature } from "@bnbagent/sdk/erc8183";
import { createDatabase, DrizzleSupplyStore } from "@relic/database";
import { createPublicClient, getAddress, http } from "viem";
import { z } from "zod";

import { safeHttpRequest } from "./endpoint-observer.js";

const arg = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const legacyStatusSchema = z.object({
  provider: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  service_price: z.string().regex(/^\d+$/),
  token_symbol: z.string().min(1),
  network: z.string().min(1),
  chain_id: z.number().int().positive(),
});

const referenceStatusSchema = z.object({
  agent_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  commerce_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  service_price: z.string().regex(/^\d+$/),
  currency: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chain_id: z.number().int().positive(),
  capability: z.string().min(1),
  read_only: z.literal(true),
});

const legacyQuoteSchema = z.object({
  provider: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  price: z.string().regex(/^\d+$/),
  currency: z.string().min(1),
  estimated_completion_seconds: z.number().int().nonnegative(),
  service: z.string().min(1),
  quoted_at: z.iso.datetime({ offset: true }),
});

const signedQuoteSchema = z
  .object({
    request: z.record(z.string(), z.unknown()),
    response: z
      .object({
        accepted: z.literal(true),
        terms: z
          .object({
            price: z.string().regex(/^\d+$/),
            currency: z.string().min(1),
          })
          .passthrough(),
        estimated_completion_seconds: z.number().int().nonnegative(),
        negotiated_at: z.number().int().positive(),
      })
      .passthrough(),
    negotiation_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    provider_sig: z.string().regex(/^0x[0-9a-fA-F]+$/),
    chain_id: z.number().int().positive(),
    verifying_contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .passthrough();

export function verifyErc8183Quote(statusValue: unknown, quoteValue: unknown) {
  const status = z
    .union([legacyStatusSchema, referenceStatusSchema])
    .parse(statusValue);
  const signed = signedQuoteSchema.safeParse(quoteValue);
  const quote = signed.success
    ? {
        provider: "provider" in status ? status.provider : status.agent_address,
        price: signed.data.response.terms.price,
        currency: signed.data.response.terms.currency,
        estimated_completion_seconds:
          signed.data.response.estimated_completion_seconds,
        quoted_at: new Date(
          signed.data.response.negotiated_at * 1_000,
        ).toISOString(),
      }
    : legacyQuoteSchema.parse(quoteValue);
  const provider =
    "provider" in status ? status.provider : status.agent_address;
  const currency =
    "token_symbol" in status ? status.token_symbol : status.currency;
  if (provider.toLowerCase() !== quote.provider.toLowerCase())
    throw new Error("ERC-8183 quote provider does not match status agent");
  if (status.service_price !== quote.price)
    throw new Error("ERC-8183 quote price does not match advertised price");
  if (currency.toLowerCase() !== quote.currency.toLowerCase())
    throw new Error("ERC-8183 quote currency does not match advertised token");
  if (signed.success && signed.data.chain_id !== status.chain_id)
    throw new Error("ERC-8183 quote chain does not match status chain");
  return { status, quote, signed: signed.success ? signed.data : null };
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
    if (
      selected.candidate.categorySlug !== "yield-optimisation" &&
      selected.candidate.categorySlug !== "health-factor-monitoring"
    )
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

    const healthFactor =
      selected.candidate.categorySlug === "health-factor-monitoring";
    const request = {
      task_description: healthFactor
        ? "Verify the Relic Health Factor Monitor seller endpoint with a read-only BSC Testnet health-factor request; do not create a job, move assets, request a buyer signature, or transact."
        : "Produce a read-only risk-adjusted BSC yield allocation; do not move capital.",
      terms: {
        deliverables: healthFactor
          ? "A zero-price negotiation response for read-only health-factor monitoring"
          : "JSON ranked protocol allocations with observed APY/APR, constraints, and source timestamps",
        quality_standards: healthFactor
          ? "BSC Testnet only; no blockchain writes or payment"
          : "Use current BSC protocol observations, explain risk adjustments, and do not execute transactions",
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
    const provider = getAddress(verified.quote.provider);
    if (provider !== getAddress(selected.identity.ownerAddress))
      throw new Error("ERC-8183 status agent does not match identity owner");
    let signatureMethod: "eip191" | "erc1271" | null = null;
    if (verified.signed !== null) {
      const rpcUrl =
        verified.status.chain_id === 97
          ? process.env.BSC_TESTNET_RPC_URL
          : process.env.BSC_MAINNET_RPC_URL;
      if (!rpcUrl)
        throw new Error("RPC URL is required for quote verification");
      if (
        "commerce_address" in verified.status &&
        getAddress(verified.signed.verifying_contract) !==
          getAddress(verified.status.commerce_address)
      )
        throw new Error("ERC-8183 quote is bound to an unexpected contract");
      const verdict = await verifyQuoteSignature({
        envelope: verified.signed,
        provider,
        publicClient: createPublicClient({ transport: http(rpcUrl) }),
        expectedVerifyingContract: getAddress(
          verified.signed.verifying_contract,
        ),
      });
      if (!verdict.valid)
        throw new Error(
          `ERC-8183 provider signature is invalid: ${verdict.reason}`,
        );
      signatureMethod = verdict.method;
    }

    const evidence = {
      dataKind: "real-external-invocation",
      protocol: "erc8183",
      operation: "negotiate",
      category: selected.candidate.categorySlug,
      serviceId: selected.service.id,
      externalAgentId: selected.identity.externalAgentId,
      chainId: verified.status.chain_id,
      network:
        "network" in verified.status
          ? verified.status.network
          : verified.status.chain_id === 97
            ? "bsc-testnet"
            : "bsc-mainnet",
      provider: verified.quote.provider,
      accepted: true,
      price: verified.quote.price,
      currency: verified.quote.currency,
      quotedAt: verified.quote.quoted_at,
      estimatedCompletionSeconds: verified.quote.estimated_completion_seconds,
      negotiationHash: verified.signed?.negotiation_hash ?? null,
      providerSignatureVerified: signatureMethod !== null,
      providerSignatureMethod: signatureMethod,
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
