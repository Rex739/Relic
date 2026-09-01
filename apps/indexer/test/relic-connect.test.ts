import { describe, expect, it, vi } from "vitest";

import {
  createRelicConnectRequester,
  issueRelicConnectToken,
  relicConnectAudience,
} from "../src/relic-connect.js";
import type { SafeHttpResult } from "../src/endpoint-observer.js";

const privateKeyPem = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEILzslPvxL36ow3IM+uuD1GnMjBpNjByuyyJF5wCyHk1Z
-----END PRIVATE KEY-----`;

const endpoint = "https://agent.example/invocations?qualifier=DEFAULT";

const response = (target: string): SafeHttpResult => ({
  endpoint: target,
  ok: true,
  status: 200,
  latencyMs: 1,
  redirectCount: 0,
  headers: {},
  body: "{}",
  errorCode: null,
});

describe("Relic Connect requester", () => {
  it("pins the audience to the execution endpoint without its transport query", () => {
    expect(relicConnectAudience(endpoint)).toBe(
      "https://agent.example/invocations",
    );
  });

  it("issues a short-lived Ed25519 inspection token", () => {
    const token = issueRelicConnectToken({
      endpoint,
      scopes: ["relic.inspect"],
      privateKeyPem,
      now: () => 1_000_000,
      jti: "test-token",
    });
    const [, encodedClaims] = token.split(".");
    expect(encodedClaims).toBeDefined();
    const decoded: unknown = JSON.parse(
      Buffer.from(encodedClaims!, "base64url").toString("utf8"),
    );
    assertObject(decoded);
    const claims = decoded;
    expect(claims).toMatchObject({
      iss: "relic-connect",
      aud: "https://agent.example/invocations",
      scope: ["relic.inspect"],
      exp: 1_060,
    });
  });

  it("never sends the token to a different endpoint", async () => {
    const bearerRequest = vi.fn((target: string) => Promise.resolve(response(target)));
    const request = createRelicConnectRequester(endpoint, {
      privateKeyPem,
      bearerRequest,
      now: () => 1_000_000,
    });
    await expect(request("https://other.example/invocations")).resolves.toMatchObject({
      ok: false,
      errorCode: "relic_connect_audience_boundary_violation",
    });
    expect(bearerRequest).not.toHaveBeenCalled();
  });

  it("uses only a scoped bearer token for the pinned endpoint", async () => {
    const bearerRequest = vi.fn((target: string) => Promise.resolve(response(target)));
    const request = createRelicConnectRequester(endpoint, {
      privateKeyPem,
      bearerRequest,
      now: () => 1_000_000,
    });
    await request(endpoint);
    expect(bearerRequest).toHaveBeenCalledWith(
      endpoint,
      expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
      expect.objectContaining({ allowedOrigin: "https://agent.example" }),
    );
  });
});

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
}
