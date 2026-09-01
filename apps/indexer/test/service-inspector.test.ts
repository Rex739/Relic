import { describe, expect, it, vi } from "vitest";

import type { SafeHttpResult } from "../src/endpoint-observer.js";
import { inspectMarketplaceService } from "../src/service-inspector.js";

const service = {
  id: "01945b1e-7e80-7000-8000-000000000001",
  agentChainId: 97,
  externalAgentId: "2016",
  endpoint: "https://agent.example",
  verificationUrl: null,
  interfaceProtocol: "erc8183",
  verificationLevel: "DECLARED" as const,
};

const response = (overrides: Partial<SafeHttpResult> = {}): SafeHttpResult => ({
  endpoint: "https://agent.example/erc8183/status",
  ok: true,
  status: 200,
  latencyMs: 12,
  redirectCount: 0,
  headers: { "content-type": "application/json" },
  body: "{}",
  errorCode: null,
  ...overrides,
});

describe("protocol-aware service inspection", () => {
  it("understands ERC-8183 payment terms without invoking the service", async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        body: JSON.stringify({ service_price: "1", currency: "U" }),
      }),
    );
    const result = await inspectMarketplaceService(service, request);
    expect(request).toHaveBeenCalledWith(
      "https://agent.example/erc8183/status",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({
      result: "passed",
      toLevel: "PAYMENT_UNDERSTOOD",
    });
    expect(result.evidence).not.toHaveProperty("body");
  });

  it("performs MCP initialize only and refuses redirects", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        response({ body: JSON.stringify({ jsonrpc: "2.0", result: {} }) }),
      );
    const result = await inspectMarketplaceService(
      { ...service, interfaceProtocol: "mcp" },
      request,
    );
    expect(request).toHaveBeenCalledWith(
      "https://agent.example",
      expect.objectContaining({ method: "POST", maxRedirects: 0 }),
    );
    const options = request.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(options.body)).toMatchObject({ method: "initialize" });
    expect(result.toLevel).toBe("SCHEMA_UNDERSTOOD");
  });

  it("records a missing endpoint as blocked, not verified", async () => {
    const result = await inspectMarketplaceService({
      ...service,
      endpoint: null,
    });
    expect(result).toMatchObject({
      result: "blocked",
      toLevel: "DECLARED",
      availability: "unknown",
    });
  });

  it("understands an A2A Agent Card without invoking a task", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          endpoint: "https://agent.example/.well-known/relic-ready.json",
          status: 404,
          body: "",
        }),
      )
      .mockResolvedValue(
        response({ body: JSON.stringify({ name: "Seller", skills: [] }) }),
      );
    const result = await inspectMarketplaceService(
      { ...service, interfaceProtocol: "a2a" },
      request,
    );
    expect(request).toHaveBeenCalledWith(
      "https://agent.example/.well-known/agent-card.json",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.toLevel).toBe("SCHEMA_UNDERSTOOD");
  });

  it("accepts a public Relic-ready document bound to the declared service", async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        endpoint: "https://agent.example/.well-known/relic-ready.json",
        body: JSON.stringify({
          version: "relic-ready/v1",
          agent: { chainId: 97, externalAgentId: "2016" },
          service: {
            endpoint: "https://agent.example",
            protocol: "a2a",
            availability: "available",
          },
          issuedAt: "2026-08-31T00:00:00.000Z",
          expiresAt: "2030-09-01T00:00:00.000Z",
        }),
      }),
    );
    const result = await inspectMarketplaceService(
      { ...service, interfaceProtocol: "a2a" },
      request,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "https://agent.example/.well-known/relic-ready.json",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({
      result: "passed",
      toLevel: "SCHEMA_UNDERSTOOD",
      evidence: { verificationDocument: "relic-ready/v1" },
    });
  });

  it("uses a metadata-declared public document for a protected execution endpoint", async () => {
    const executionEndpoint =
      "https://private-runtime.example/invocations?qualifier=DEFAULT";
    const verificationUrl =
      "https://publisher.example/relic/yield-scout-ready.json";
    const request = vi.fn().mockResolvedValue(
      response({
        endpoint: verificationUrl,
        body: JSON.stringify({
          version: "relic-ready/v1",
          agent: { chainId: 97, externalAgentId: "2016" },
          service: {
            endpoint: executionEndpoint,
            protocol: "a2a",
            availability: "available",
          },
          issuedAt: "2026-08-31T00:00:00.000Z",
          expiresAt: "2030-09-01T00:00:00.000Z",
        }),
      }),
    );

    const result = await inspectMarketplaceService(
      {
        ...service,
        endpoint: executionEndpoint,
        verificationUrl,
        interfaceProtocol: "a2a",
      },
      request,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      verificationUrl,
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({
      result: "passed",
      toLevel: "SCHEMA_UNDERSTOOD",
      evidence: { verificationDocumentSource: "erc-8004-metadata" },
    });
  });

  it("does not fall back to a private endpoint when its declared document is unavailable", async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        endpoint: "https://publisher.example/relic/ready.json",
        status: 404,
        body: "",
      }),
    );

    const result = await inspectMarketplaceService(
      {
        ...service,
        endpoint: "https://private-runtime.example/invocations",
        verificationUrl: "https://publisher.example/relic/ready.json",
        interfaceProtocol: "a2a",
      },
      request,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      result: "failed",
      httpStatus: 404,
      error: { code: "verification_document_unavailable" },
    });
  });

  it("understands an x402 challenge without sending payment", async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        status: 402,
        headers: { "payment-required": "x402" },
        body: JSON.stringify({ price: "1", currency: "USDC" }),
      }),
    );
    const result = await inspectMarketplaceService(
      { ...service, interfaceProtocol: "x402" },
      request,
    );
    expect(result).toMatchObject({
      result: "passed",
      toLevel: "PAYMENT_UNDERSTOOD",
    });
    const requestOptions = request.mock.calls[0]?.[1] as {
      headers?: Record<string, string>;
    };
    expect(requestOptions.headers).toBeUndefined();
  });

  it("does not promote a protocol endpoint that only returns an ordinary 4xx", async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        status: 404,
        body: JSON.stringify({ detail: "Not Found" }),
      }),
    );
    const result = await inspectMarketplaceService(
      { ...service, interfaceProtocol: "a2a" },
      request,
    );
    expect(result).toMatchObject({
      result: "failed",
      toLevel: "DECLARED",
      availability: "degraded",
      httpStatus: 404,
    });
  });
});
