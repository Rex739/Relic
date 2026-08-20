import { describe, expect, it, vi } from "vitest";

import {
  Scan8004Provider,
  ScanRateLimitError,
  ScanRequestBudgetError,
} from "../src/8004scan.js";

const agent = {
  id: "scan-1",
  token_id: "1",
  chain_id: 56,
  contract_address: `0x${"8".repeat(40)}`,
  owner_address: `0x${"1".repeat(40)}`,
  supported_protocols: ["A2A"],
};

const pageResponse = (headers: HeadersInit = {}) =>
  new Response(
    JSON.stringify({
      success: true,
      data: [agent],
      meta: { pagination: { page: 1, limit: 1, total: 2, hasMore: true } },
    }),
    { status: 200, headers },
  );

describe("8004scan paginated provider", () => {
  it("performs bounded targeted semantic discovery", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [agent],
          meta: { version: "1.0.0" },
        }),
        { headers: { "x-ratelimit-remaining": "8" } },
      ),
    );
    const result = await new Scan8004Provider({
      fetch: fetchMock,
    }).searchAgents({
      query: "health factor liquidation protection",
      chainId: 56,
      limit: 10,
    });
    expect(result.agents).toHaveLength(1);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(typeof request).toBe("string");
    if (typeof request !== "string") throw new Error("Expected a URL string");
    expect(request).toContain(
      "agents/search?q=health+factor+liquidation+protection",
    );
    expect(request).toContain("chainId=56");
  });

  it("uses the documented paginated keyword filter as a distinct path", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(pageResponse());
    const result = await new Scan8004Provider({
      fetch: fetchMock,
    }).searchAgentsKeyword({
      query: "LP range rebalancer",
      chainId: 56,
      limit: 25,
    });
    expect(result.agents).toHaveLength(1);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(typeof request).toBe("string");
    if (typeof request !== "string") throw new Error("Expected a URL string");
    expect(request).toContain("search=LP+range+rebalancer");
    expect(request).toContain("chainId=56");
    expect(request).not.toContain("agents/search");
  });

  it("uses API key auth, pagination, and exposes rate-limit state", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      pageResponse({
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "29",
        "x-ratelimit-reset": "2026-08-14T01:00:00.000Z",
      }),
    );
    const provider = new Scan8004Provider({
      apiKey: "fixture-key",
      fetch: fetchMock,
    });
    const page = await provider.listAgents({ chainId: 56, page: 1, limit: 1 });
    expect(page).toMatchObject({ total: 2, hasMore: true });
    expect(page.rateLimit).toEqual({
      limit: 30,
      remaining: 29,
      resetAt: "2026-08-14T01:00:00.000Z",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-api-key": "fixture-key",
    });
    expect(provider.accessMode).toBe("authenticated");
    const request = fetchMock.mock.calls[0]?.[0];
    expect(typeof request).toBe("string");
    if (typeof request !== "string") throw new Error("Expected a URL string");
    expect(request).toContain("chainId=56");
  });

  it("waits until the advertised reset before the next request", async () => {
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        pageResponse({
          "x-ratelimit-limit": "10",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1970-01-01T00:00:01.000Z",
        }),
      )
      .mockResolvedValueOnce(pageResponse());
    const provider = new Scan8004Provider({
      fetch: fetchMock,
      sleep,
      now: () => 0,
    });
    await provider.listAgents({ chainId: 56, page: 1, limit: 1 });
    await provider.listAgents({ chainId: 56, page: 2, limit: 1 });
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("identifies an observed Pro key without exposing the credential", async () => {
    const provider = new Scan8004Provider({
      apiKey: "fixture-pro-key",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        pageResponse({
          "x-ratelimit-limit": "500",
          "x-ratelimit-remaining": "499",
        }),
      ),
    });
    await provider.listAgents({ chainId: 56, page: 1, limit: 1 });
    expect(provider.operationalMode).toBe("pro_authenticated");
  });

  it("stops immediately on rate limiting and enters degraded mode", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "RATE_LIMIT_EXCEEDED" },
        }),
        {
          status: 429,
          headers: {
            "x-ratelimit-limit": "10",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "2026-08-20T19:00:00.000Z",
          },
        },
      ),
    );
    const provider = new Scan8004Provider({ fetch: fetchMock, maxRetries: 3 });
    await expect(
      provider.listAgents({ chainId: 56, page: 1, limit: 1 }),
    ).rejects.toBeInstanceOf(ScanRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider.operationalMode).toBe("rate_limited_degraded");
  });

  it("enforces a local request budget before another API call", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(pageResponse());
    const provider = new Scan8004Provider({
      fetch: fetchMock,
      requestBudget: 1,
    });
    await provider.listAgents({ chainId: 56, page: 1, limit: 1 });
    await expect(
      provider.listAgents({ chainId: 56, page: 2, limit: 1 }),
    ).rejects.toBeInstanceOf(ScanRequestBudgetError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces the official maximum page size without making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new Scan8004Provider({ fetch: fetchMock });
    await expect(
      provider.listAgents({ chainId: 56, page: 1, limit: 101 }),
    ).rejects.toThrow("page size must be between 1 and 100");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
