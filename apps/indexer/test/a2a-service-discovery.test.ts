import { describe, expect, it, vi } from "vitest";

import type { SafeHttpResult } from "../src/endpoint-observer.js";
import { resolveA2aInvocationEndpoint } from "../src/a2a-service-discovery.js";

const response = (body: unknown): SafeHttpResult => ({
  endpoint: "https://agent.example/.well-known/agent-card.json",
  ok: true,
  status: 200,
  latencyMs: 1,
  redirectCount: 0,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  errorCode: null,
});

describe("A2A service discovery", () => {
  it("uses the executable URL declared by the agent card", async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        name: "Seller",
        url: "https://agent.example/custom-invocation",
        protocolVersion: "0.3.0",
        skills: [{ id: "negotiate" }],
      }),
    );
    await expect(
      resolveA2aInvocationEndpoint(
        "https://agent.example/.well-known/agent-card.json",
        request,
      ),
    ).resolves.toEqual({
      status: "resolved",
      discoveryUrl: "https://agent.example/.well-known/agent-card.json",
      invocationUrl: "https://agent.example/custom-invocation",
      categoryTerms: ["Seller", "negotiate"],
    });
  });

  it("rejects an invocation URL on a different origin", async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        name: "Seller",
        url: "https://attacker.example/apex",
        protocolVersion: "0.3.0",
        skills: [{ id: "negotiate" }],
      }),
    );
    await expect(
      resolveA2aInvocationEndpoint("https://agent.example", request),
    ).resolves.toMatchObject({
      status: "unresolved",
      reason: "agent_card_invocation_url_outside_origin",
    });
  });
});
