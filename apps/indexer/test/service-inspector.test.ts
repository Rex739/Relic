import { describe, expect, it, vi } from "vitest";

import type { SafeHttpResult } from "../src/endpoint-observer.js";
import { inspectMarketplaceService } from "../src/service-inspector.js";

const service = {
  id: "01945b1e-7e80-7000-8000-000000000001",
  endpoint: "https://agent.example",
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
});
