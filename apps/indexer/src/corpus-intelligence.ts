import { createHash } from "node:crypto";

import type { ScanAgent } from "@relic/blockchain";

export const CORPUS_RULE_VERSION = "bsc-corpus-v2";

export type ReadinessState =
  "NOT_READY" | "PARTIAL" | "DISCOVERABLE" | "ACTIONABLE";

export interface ServiceDeclarationInput {
  rawName: string;
  normalizedType: string;
  endpoint: string | null;
  malformed: boolean;
  raw: Record<string, unknown>;
}

export interface ClassificationMatch {
  categorySlug:
    | "rebalancing"
    | "grid-trading"
    | "yield-optimisation"
    | "health-factor-monitoring";
  confidence: "high" | "medium";
  evidenceType: "structured_declaration" | "explicit_description_term";
  matchedSource: string;
  matchedValue: string;
}

export interface QualityFacts {
  [key: string]: boolean;
  hasName: boolean;
  hasMeaningfulDescription: boolean;
  hasImage: boolean;
  hasMetadataUri: boolean;
  metadataResolves: boolean;
  hasServiceDeclaration: boolean;
  hasEndpoint: boolean;
  hasCapabilityData: boolean;
  hasSupportedProtocols: boolean;
  hasSupportedAssets: boolean;
  hasPricingInformation: boolean;
  hasReputationEvidence: boolean;
  hasRecentMetadata: boolean;
  hasVerifiableOwner: boolean;
  hasUsableMachineInterface: boolean;
  hasMarketplaceCategoryEvidence: boolean;
}

const compact = (value: string | null | undefined) => value?.trim() ?? "";
const normalizedText = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_/]+/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function normalizeServiceType(raw: string): string {
  const value = normalizedText(raw);
  if (/^(a2a|agent-to-agent|agent2agent)$/.test(value)) return "a2a";
  if (/^(mcp|model-context-protocol)$/.test(value)) return "mcp";
  if (/^(web|http|https|api|rest|rest-api|http-api)$/.test(value))
    return "http-api";
  if (value === "oasf") return "oasf";
  if (value === "email") return "email";
  if (value === "x402") return "x402";
  if (/^(erc-?8183|eip-?8183)$/.test(value)) return "erc8183";
  return value === "" ? "unknown" : `other:${value}`;
}

const capabilityAliases: ReadonlyArray<[RegExp, string]> = [
  [
    /\b(?:yield[\s_-]*(?:farm(?:ing)?|optimi[sz](?:e|er|ation))|defi[\s_-]*yield)\b/i,
    "yield-optimisation",
  ],
  [/\bgrid[\s_-]*trad(?:e|er|ing)\b/i, "grid-trading"],
  [/\brebalanc(?:e|er|ing)\b/i, "rebalancing"],
  [
    /\bhealth[\s_-]*factor[\s_-]*(?:monitor|monitoring|alert)\b/i,
    "health-factor-monitoring",
  ],
];

export function normalizeCapabilities(values: readonly string[]): string[] {
  const result = new Set<string>();
  for (const raw of values) {
    const alias = capabilityAliases.find(([pattern]) => pattern.test(raw));
    result.add(alias?.[1] ?? normalizedText(raw));
  }
  result.delete("");
  return [...result].sort();
}

function rawServices(rawMetadata: unknown): ServiceDeclarationInput[] {
  if (rawMetadata === null || typeof rawMetadata !== "object") return [];
  const metadata = rawMetadata as Record<string, unknown>;
  const services = Array.isArray(metadata.services)
    ? metadata.services
    : metadata.endpoints;
  if (!Array.isArray(services)) return [];
  return services.map((value, index) => {
    const record =
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const rawName =
      typeof record.name === "string"
        ? record.name
        : typeof record.type === "string"
          ? record.type
          : `malformed-service-${index}`;
    const endpoint =
      typeof record.endpoint === "string"
        ? record.endpoint
        : typeof record.url === "string"
          ? record.url
          : null;
    return {
      rawName,
      normalizedType: normalizeServiceType(rawName),
      endpoint,
      malformed:
        compact(rawName) === "" || value === null || typeof value !== "object",
      raw: record,
    };
  });
}

export function extractServiceDeclarations(
  agent: ScanAgent,
): ServiceDeclarationInput[] {
  const declarations: ServiceDeclarationInput[] = agent.supported_protocols.map(
    (rawName) => ({
      rawName,
      normalizedType: normalizeServiceType(rawName),
      endpoint: null,
      malformed: compact(rawName) === "",
      raw: { protocol: rawName },
    }),
  );
  if (agent.x402_supported === true)
    declarations.push({
      rawName: "X402",
      normalizedType: "x402",
      endpoint: null,
      malformed: false,
      raw: { x402_supported: true },
    });
  declarations.push(...rawServices(agent.raw_metadata));
  return declarations.filter(
    (declaration, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.rawName === declaration.rawName &&
          candidate.endpoint === declaration.endpoint,
      ) === index,
  );
}

export function classifyAgent(
  agent: Pick<
    ScanAgent,
    "name" | "description" | "supported_protocols" | "raw_metadata"
  >,
): ClassificationMatch[] {
  const rawCapabilities =
    agent.raw_metadata !== null &&
    typeof agent.raw_metadata === "object" &&
    Array.isArray((agent.raw_metadata as Record<string, unknown>).capabilities)
      ? (
          (agent.raw_metadata as Record<string, unknown>)
            .capabilities as unknown[]
        ).filter((value): value is string => typeof value === "string")
      : [];
  const structured = [
    ...agent.supported_protocols.map((value) => ({
      source: "supported_protocols",
      value,
    })),
    ...rawServices(agent.raw_metadata).map((service) => ({
      source: "raw_metadata.services",
      value: service.rawName,
    })),
    ...rawCapabilities.map((value) => ({
      source: "raw_metadata.capabilities",
      value,
    })),
  ];
  const unstructured = [
    { source: "name", value: agent.name ?? "" },
    { source: "description", value: agent.description ?? "" },
  ];
  const results = new Map<string, ClassificationMatch>();
  for (const item of [...structured, ...unstructured]) {
    for (const [pattern, categorySlug] of capabilityAliases) {
      if (!pattern.test(item.value) || results.has(categorySlug)) continue;
      const isStructured = structured.includes(item);
      results.set(categorySlug, {
        categorySlug: categorySlug as ClassificationMatch["categorySlug"],
        confidence: isStructured ? "high" : "medium",
        evidenceType: isStructured
          ? "structured_declaration"
          : "explicit_description_term",
        matchedSource: item.source,
        matchedValue: item.value,
      });
    }
  }
  return [...results.values()];
}

export function profileQuality(input: {
  agent: ScanAgent;
  metadataUri?: string | null;
  metadataResolves?: boolean;
  verifiedOwner?: boolean;
  categoryCount?: number;
  now?: Date;
}): {
  facts: QualityFacts;
  completenessPercent: number;
  readiness: ReadinessState;
} {
  const declarations = extractServiceDeclarations(input.agent);
  const capabilities = normalizeCapabilities([
    ...declarations.map((item) => item.rawName),
  ]);
  const sourceUpdatedAt = Date.parse(input.agent.updated_at ?? "");
  const now = (input.now ?? new Date()).getTime();
  const meaningfulDescription = compact(input.agent.description).length >= 40;
  const usableInterface = declarations.some((item) =>
    ["a2a", "mcp", "http-api", "oasf", "erc8183"].includes(item.normalizedType),
  );
  const facts: QualityFacts = {
    hasName: compact(input.agent.name).length > 0,
    hasMeaningfulDescription: meaningfulDescription,
    hasImage: compact(input.agent.image_url).length > 0,
    hasMetadataUri: compact(input.metadataUri).length > 0,
    metadataResolves: input.metadataResolves === true,
    hasServiceDeclaration: declarations.length > 0,
    hasEndpoint: declarations.some((item) => compact(item.endpoint).length > 0),
    hasCapabilityData: capabilities.length > 0,
    hasSupportedProtocols: input.agent.supported_protocols.length > 0,
    hasSupportedAssets: false,
    hasPricingInformation:
      input.agent.x402_supported === true ||
      /\b(?:price|pricing|subscription|per query|x402)\b/i.test(
        input.agent.description ?? "",
      ),
    hasReputationEvidence: (input.agent.total_feedbacks ?? 0) > 0,
    hasRecentMetadata:
      Number.isFinite(sourceUpdatedAt) &&
      now - sourceUpdatedAt <= 90 * 86_400_000,
    hasVerifiableOwner: input.verifiedOwner === true,
    hasUsableMachineInterface: usableInterface,
    hasMarketplaceCategoryEvidence: (input.categoryCount ?? 0) > 0,
  };
  const values = Object.values(facts);
  const completenessPercent = Math.round(
    (values.filter(Boolean).length / values.length) * 100,
  );
  const understandable = facts.hasName && facts.hasMeaningfulDescription;
  let readiness: ReadinessState = "PARTIAL";
  if (
    !facts.hasName &&
    !facts.hasMeaningfulDescription &&
    !facts.hasServiceDeclaration
  )
    readiness = "NOT_READY";
  else if (
    understandable &&
    (facts.hasCapabilityData || facts.hasServiceDeclaration)
  )
    readiness = "DISCOVERABLE";
  if (
    understandable &&
    facts.metadataResolves &&
    facts.hasEndpoint &&
    facts.hasUsableMachineInterface &&
    facts.hasPricingInformation
  )
    readiness = "ACTIONABLE";
  return { facts, completenessPercent, readiness };
}

export function duplicateFingerprint(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
}
