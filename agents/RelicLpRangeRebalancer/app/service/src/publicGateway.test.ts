import assert from "node:assert/strict";
import test from "node:test";

import { forwardA2aRequest, privateAgentEndpoint, publicAgentCard } from "./publicGateway.js";

const message = {
  jsonrpc: "2.0",
  id: "request-1",
  method: "message/send",
  params: {
    message: {
      role: "user",
      parts: [{ kind: "data", data: { skill: "negotiate" } }],
    },
  },
};

test("public card exposes the public A2A endpoint without private authentication", () => {
  const card = publicAgentCard("https://rebalancer.relic.example/");
  assert.equal(card.url, "https://rebalancer.relic.example/apex");
  assert.equal("security" in card, false);
  assert.deepEqual(card.skills.map((skill) => skill.id), ["negotiate", "notify_funded"]);
});

test("gateway rejects unsupported public skills", async () => {
  const result = await forwardA2aRequest({ method: "message/send" }, {
    privateAgentUrl: "https://private.example",
  });
  assert.equal(result.status, 400);
});

test("gateway forwards only a valid seller request with service credentials", async () => {
  let authorization = "";
  const result = await forwardA2aRequest(
    message,
    {
      privateAgentUrl: "https://private.example/invocations",
      privateAgentBearerToken: "service-token",
    },
    async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ jsonrpc: "2.0", result: { ok: true } }), {
        status: 200,
      });
    },
  );
  assert.equal(authorization, "Bearer service-token");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { jsonrpc: "2.0", result: { ok: true } });
});

test("private agent needs HTTPS outside local development", () => {
  assert.throws(
    () => privateAgentEndpoint({ privateAgentUrl: "http://private.example" }),
    /HTTPS/,
  );
});
