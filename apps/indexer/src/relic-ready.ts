import { z } from "zod";

/**
 * Provider-neutral public listing contract. This document deliberately
 * contains no credential, wallet secret, buyer data, or executable action.
 * The identity and service URL are matched against ERC-8004 data that Relic
 * already resolved independently before this document can promote a service.
 */
const relicReadyDocumentSchema = z.object({
  version: z.literal("relic-ready/v1"),
  agent: z.object({
    chainId: z.number().int().positive(),
    externalAgentId: z.string().min(1),
  }),
  service: z.object({
    endpoint: z.url(),
    protocol: z.string().trim().min(1),
    availability: z.literal("available"),
  }),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export type RelicReadyDocument = z.infer<typeof relicReadyDocumentSchema>;

export function relicReadyDocumentUrl(
  serviceEndpoint: string,
  declaredVerificationUrl?: string | null,
) {
  if (declaredVerificationUrl !== undefined && declaredVerificationUrl !== null)
    return new URL(declaredVerificationUrl).toString();
  const endpoint = new URL(serviceEndpoint);
  return new URL("/.well-known/relic-ready.json", endpoint.origin).toString();
}

export function parseRelicReadyDocument(
  body: string,
  expected: {
    chainId: number;
    externalAgentId: string;
    endpoint: string;
    protocol: string;
  },
  now = new Date(),
): RelicReadyDocument {
  const document = relicReadyDocumentSchema.parse(JSON.parse(body));
  if (document.agent.chainId !== expected.chainId)
    throw new Error(
      "Relic-ready document chain does not match ERC-8004 identity",
    );
  if (document.agent.externalAgentId !== expected.externalAgentId)
    throw new Error(
      "Relic-ready document agent ID does not match ERC-8004 identity",
    );
  if (
    new URL(document.service.endpoint).toString() !==
    new URL(expected.endpoint).toString()
  )
    throw new Error(
      "Relic-ready document service endpoint does not match the declared endpoint",
    );
  if (
    document.service.protocol.toLowerCase() !== expected.protocol.toLowerCase()
  )
    throw new Error(
      "Relic-ready document protocol does not match the declared service",
    );
  const issuedAt = new Date(document.issuedAt);
  const expiresAt = new Date(document.expiresAt);
  if (expiresAt <= issuedAt || expiresAt <= now)
    throw new Error(
      "Relic-ready document is expired or has an invalid validity window",
    );
  return document;
}
