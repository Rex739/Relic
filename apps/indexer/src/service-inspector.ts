import { createHash } from "node:crypto";

import type { DrizzleSupplyStore } from "@relic/database";
import type { ServiceVerificationLevel } from "@relic/domain";

import {
  agentcoreRuntime,
  createAgentcoreAwareRequester,
} from "./agentcore-oauth.js";
import type { safeHttpRequest, SafeHttpResult } from "./endpoint-observer.js";
import {
  assertCandidateTransition,
  verificationLevelRank,
} from "./launch-supply.js";

export interface InspectableService {
  id: string;
  endpoint: string | null;
  interfaceProtocol: string;
  verificationLevel: ServiceVerificationLevel;
}

export interface ServiceInspectionResult {
  fromLevel: ServiceVerificationLevel;
  toLevel: ServiceVerificationLevel;
  result: "passed" | "failed" | "blocked";
  protocol: string;
  requestMethod: "GET" | "OPTIONS" | "POST" | null;
  httpStatus: number | null;
  latencyMs: number | null;
  availability: "unknown" | "available" | "degraded" | "unavailable";
  evidence: Record<string, unknown>;
  error?: { code: string };
}

type SafeRequester = typeof safeHttpRequest;

function appendPath(endpoint: string, suffix: string) {
  const url = new URL(endpoint);
  const normalized = url.pathname.replace(/\/+$/, "");
  url.pathname = `${normalized}${suffix}`;
  return url.toString();
}

function protocolEndpoint(endpoint: string, protocol: string) {
  const path = new URL(endpoint).pathname.toLowerCase().replace(/\/+$/, "");
  if (protocol === "erc8183") {
    if (path.endsWith("/erc8183/status") || path.endsWith("/status"))
      return endpoint;
    if (path.endsWith("/erc8183")) return appendPath(endpoint, "/status");
    return appendPath(endpoint, "/erc8183/status");
  }
  if (protocol === "a2a") {
    if (path.endsWith("/agent-card.json")) return endpoint;
    return appendPath(endpoint, "/.well-known/agent-card.json");
  }
  return endpoint;
}

function parseObject(body: string): Record<string, unknown> | null {
  if (body.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function responseEvidence(
  response: SafeHttpResult,
  parsed: Record<string, unknown> | null,
) {
  return {
    inspectedEndpoint: response.endpoint,
    redirectCount: response.redirectCount,
    contentType: response.headers["content-type"] ?? null,
    responseBytes: Buffer.byteLength(response.body),
    responseSha256: createHash("sha256").update(response.body).digest("hex"),
    jsonFields: parsed === null ? [] : Object.keys(parsed).sort(),
  };
}

function availability(
  response: SafeHttpResult,
): ServiceInspectionResult["availability"] {
  if (response.status === null) return "unavailable";
  if (response.status >= 400) return "degraded";
  return "available";
}

function headerValue(response: SafeHttpResult, name: string) {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

function hasPaymentTerms(parsed: Record<string, unknown> | null) {
  if (parsed === null) return false;
  const keys = new Set(Object.keys(parsed).map((key) => key.toLowerCase()));
  const hasPrice = ["price", "service_price", "budget", "amount"].some((key) =>
    keys.has(key),
  );
  const hasCurrency = ["currency", "token", "payment_token", "asset"].some(
    (key) => keys.has(key),
  );
  return hasPrice && hasCurrency;
}

function understoodSchema(
  protocol: string,
  parsed: Record<string, unknown> | null,
) {
  if (parsed === null) return false;
  if (protocol === "a2a")
    return (
      typeof parsed.name === "string" &&
      (Array.isArray(parsed.skills) || parsed.capabilities !== undefined)
    );
  if (protocol === "mcp")
    return (
      parsed.jsonrpc === "2.0" &&
      (parsed.result !== undefined || parsed.error !== undefined)
    );
  return Object.keys(parsed).length > 0;
}

export async function inspectMarketplaceService(
  service: InspectableService,
  request?: SafeRequester,
): Promise<ServiceInspectionResult> {
  const protocol = service.interfaceProtocol.toLowerCase();
  if (service.endpoint === null || service.endpoint.trim() === "")
    return {
      fromLevel: service.verificationLevel,
      toLevel: service.verificationLevel,
      result: "blocked",
      protocol,
      requestMethod: null,
      httpStatus: null,
      latencyMs: null,
      availability: "unknown",
      evidence: { boundary: "no network request", reason: "missing_endpoint" },
      error: { code: "missing_endpoint" },
    };

  let endpoint: string;
  try {
    endpoint = protocolEndpoint(service.endpoint, protocol);
  } catch {
    return {
      fromLevel: service.verificationLevel,
      toLevel: service.verificationLevel,
      result: "failed",
      protocol,
      requestMethod: null,
      httpStatus: null,
      latencyMs: null,
      availability: "unavailable",
      evidence: { boundary: "no network request", reason: "invalid_url" },
      error: { code: "invalid_url" },
    };
  }

  const method =
    protocol === "mcp" ? "POST" : protocol === "generic" ? "OPTIONS" : "GET";
  const authenticated = agentcoreRuntime(endpoint) !== null;
  const requester = request ?? createAgentcoreAwareRequester(endpoint);
  const response = await requester(endpoint, {
    method,
    timeoutMs: 5_000,
    maxRedirects: protocol === "mcp" ? 0 : 2,
    maxResponseBytes: 64 * 1024,
    ...(protocol === "mcp"
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "relic-safe-inspection",
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "relic-inspector", version: "1.0.0" },
            },
          }),
        }
      : {}),
  });
  const parsed = parseObject(response.body);
  const evidence = {
    ...responseEvidence(response, parsed),
    boundary:
      protocol === "mcp"
        ? "MCP initialize only; no tool invocation"
        : authenticated
          ? "operator-authenticated metadata inspection; no paid invocation"
          : "credential-free metadata/status inspection; no paid invocation",
  };
  const expectedPaymentChallenge =
    (protocol === "x402" || protocol === "b402") && response.status === 402;
  if (
    !response.ok ||
    (response.status !== null &&
      response.status >= 400 &&
      !expectedPaymentChallenge)
  )
    return {
      fromLevel: service.verificationLevel,
      toLevel: service.verificationLevel,
      result: "failed",
      protocol,
      requestMethod: method,
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      availability: availability(response),
      evidence,
      error: { code: response.errorCode ?? "request_failed" },
    };

  let toLevel: ServiceVerificationLevel = "ENDPOINT_OBSERVED";
  if (protocol === "erc8183" && hasPaymentTerms(parsed))
    toLevel = "PAYMENT_UNDERSTOOD";
  else if (protocol === "a2a" || protocol === "mcp") {
    if (understoodSchema(protocol, parsed)) toLevel = "SCHEMA_UNDERSTOOD";
  } else if (protocol === "x402" || protocol === "b402") {
    const challenge = [
      headerValue(response, "www-authenticate"),
      headerValue(response, "payment-required"),
      headerValue(response, "x-payment-required"),
    ].join(" ");
    if (
      expectedPaymentChallenge &&
      (/payment|x402|b402/i.test(challenge) || hasPaymentTerms(parsed))
    )
      toLevel = "PAYMENT_UNDERSTOOD";
  } else if (understoodSchema(protocol, parsed)) {
    toLevel = "SCHEMA_UNDERSTOOD";
  }
  if (
    verificationLevelRank(service.verificationLevel) >
    verificationLevelRank(toLevel)
  )
    toLevel = service.verificationLevel;
  return {
    fromLevel: service.verificationLevel,
    toLevel,
    result: "passed",
    protocol,
    requestMethod: method,
    httpStatus: response.status,
    latencyMs: response.latencyMs,
    availability: availability(response),
    evidence,
  };
}

export async function inspectLaunchServices(
  store: DrizzleSupplyStore,
  limit: number,
) {
  const counters = { attempted: 0, passed: 0, failed: 0, blocked: 0 };
  const transitioned = new Set<string>();
  for (const row of await store.serviceInspectionCandidates(limit)) {
    counters.attempted += 1;
    const observation = await inspectMarketplaceService(row.service);
    counters[observation.result] += 1;
    await store.recordServiceVerification({
      serviceId: row.service.id,
      ...observation,
    });
    if (
      observation.result === "passed" &&
      verificationLevelRank(observation.toLevel) >=
        verificationLevelRank("ENDPOINT_OBSERVED") &&
      row.candidate.status === "SERVICE_IDENTIFIED" &&
      !transitioned.has(row.candidate.id)
    ) {
      assertCandidateTransition("SERVICE_IDENTIFIED", "SERVICE_OBSERVED");
      await store.transitionCandidate({
        candidateId: row.candidate.id,
        from: "SERVICE_IDENTIFIED",
        to: "SERVICE_OBSERVED",
        evidence: {
          source: "relic-safe-service-inspector",
          serviceId: row.service.id,
          protocol: observation.protocol,
          verificationLevel: observation.toLevel,
        },
      });
      transitioned.add(row.candidate.id);
    }
  }
  return counters;
}
