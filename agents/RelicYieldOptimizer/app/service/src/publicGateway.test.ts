import test from "node:test";
import assert from "node:assert/strict";
import { forwardA2aRequest, fundedJobId, isAllowedA2aSkill, privateAgentEndpoint, publicAgentCard } from "./publicGateway.js";

const negotiate = {
  method: "message/send",
  params: { message: { parts: [{ kind: "data", data: { skill: "negotiate" } }] } },
};

test("advertises the executable apex URL, not the card URL", () => {
  assert.equal(publicAgentCard("https://example.test/").url, "https://example.test/apex");
});

test("forwards only declared commerce skills", () => {
  assert.equal(isAllowedA2aSkill(negotiate), true);
  assert.equal(isAllowedA2aSkill({ ...negotiate, params: { message: { parts: [{ kind: "data", data: { skill: "execute_anything" } }] } } }), false);
});

test("extracts only a numeric funded job id from the public notification", () => {
  const funded = {
    method: "message/send",
    params: { message: { parts: [{ kind: "data", data: { skill: "notify_funded", jobId: "8183" } }] } },
  };
  assert.equal(fundedJobId(funded), "8183");
  assert.equal(fundedJobId(negotiate), null);
  assert.equal(fundedJobId({ ...funded, params: { message: { parts: [{ kind: "data", data: { skill: "notify_funded", jobId: "not-a-job" } }] } } }), null);
});

test("allows HTTP only when explicitly configured for private networking", () => {
  const config = { privateAgentUrl: "http://agent:9000", privateAgentBearerToken: "token", relicApiUrl: "http://api:8787", relicInternalToken: "token" };
  assert.throws(() => privateAgentEndpoint(config));
  assert.equal(privateAgentEndpoint({ ...config, allowInternalHttp: true }).hostname, "agent");
});

test("replaces public A2A contents with Relic's canonical funded-job request", async () => {
  const funded = {
    method: "message/send",
    params: { message: { parts: [{ kind: "data", data: { skill: "notify_funded", jobId: "8183", amountBaseUnits: "999999" } }] } },
  };
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url, init) => {
    calls.push({ url: String(url), body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    if (String(url).includes("execution-request")) {
      return new Response(JSON.stringify({ kind: "relic.funded_yield_job.v1", commerceJobId: "8183", amountBaseUnits: "1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ state: "COMPLETED" }), { status: 200 });
  }) as typeof fetch;
  const result = await forwardA2aRequest(funded, {
    privateAgentUrl: "http://agent:9000", privateAgentBearerToken: "agent-token",
    relicApiUrl: "http://api:8787", relicInternalToken: "relic-token", allowInternalHttp: true,
  }, fetchImpl);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /8183\/execution-request$/u);
  assert.deepEqual(calls[1]!.body, { kind: "relic.funded_yield_job.v1", commerceJobId: "8183", amountBaseUnits: "1" });
});
