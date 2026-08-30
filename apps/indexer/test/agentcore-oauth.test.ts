import { describe, expect, it, vi } from "vitest";

import {
  agentcoreAuthenticationRequirements,
  agentcoreRuntime,
  createAgentcoreAwareRequester,
} from "../src/agentcore-oauth.js";
import type { SafeHttpResult } from "../src/endpoint-observer.js";

const arn =
  "arn:aws:bedrock-agentcore:us-east-1:699289398114:runtime/RelicYieldScout-Aby9v32xja";
const endpoint = `https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/${encodeURIComponent(arn)}/invocations/.well-known/agent-card.json`;
const credentialsJson = JSON.stringify([
  {
    runtimeArn: arn,
    tokenUrl:
      "https://bnbagent-699289398114.auth.us-east-1.amazoncognito.com/oauth2/token",
    clientId: "client-id",
    clientSecret: "client-secret",
    scope: "bnbagent-seller/invoke",
  },
]);

const result = (url: string, body: string): SafeHttpResult => ({
  endpoint: url,
  ok: true,
  status: 200,
  latencyMs: 1,
  redirectCount: 0,
  headers: { "content-type": "application/json" },
  body,
  errorCode: null,
});

describe("AgentCore OAuth request boundary", () => {
  it("recognizes a runtime URL and publishes only non-secret requirements", () => {
    expect(agentcoreRuntime(endpoint)?.arn).toBe(arn);
    expect(agentcoreAuthenticationRequirements(endpoint)).toEqual({
      type: "oauth2_client_credentials",
      provider: "aws-agentcore-cognito",
      runtimeArn: arn,
      credentialSource: "operator_secret",
    });
  });

  it("obtains and reuses a token only for the pinned runtime", async () => {
    const tokenRequest = vi
      .fn()
      .mockResolvedValue(
        result(
          "https://token.example",
          '{"access_token":"token","expires_in":300}',
        ),
      );
    const bearerRequest = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(result(url, '{"name":"Relic Yield Scout"}')),
      );
    const request = createAgentcoreAwareRequester(endpoint, {
      credentialsJson,
      tokenRequest,
      bearerRequest,
      now: () => 1_000,
    });

    await request(endpoint);
    await request(endpoint);
    expect(tokenRequest).toHaveBeenCalledTimes(1);
    expect(bearerRequest).toHaveBeenCalledTimes(2);
    expect(bearerRequest).toHaveBeenCalledWith(
      endpoint,
      "token",
      expect.objectContaining({
        allowedOrigin: "https://bedrock-agentcore.us-east-1.amazonaws.com",
      }),
    );

    const otherArn = arn.replace("RelicYieldScout", "AnotherRuntime");
    const other = endpoint.replace(
      encodeURIComponent(arn),
      encodeURIComponent(otherArn),
    );
    await expect(request(other)).resolves.toMatchObject({
      ok: false,
      errorCode: "agentcore_runtime_boundary_violation",
    });
    expect(bearerRequest).toHaveBeenCalledTimes(2);
  });

  it("fails closed before network access when credentials are absent", async () => {
    const tokenRequest = vi.fn();
    const request = createAgentcoreAwareRequester(endpoint, {
      credentialsJson: "",
      tokenRequest,
    });
    await expect(request(endpoint)).resolves.toMatchObject({
      ok: false,
      errorCode: "agentcore_oauth_not_configured",
    });
    expect(tokenRequest).not.toHaveBeenCalled();
  });
});
