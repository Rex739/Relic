import assert from "node:assert/strict";
import test from "node:test";

import { forwardFundedNotification, fundedJobId, privateCycleEndpoint, publicAgentCard } from "./public-gateway.js";

const notification = {
  method: "message/send",
  params: { message: { parts: [{ kind: "data", data: { skill: "notify_funded", jobId: "8183" } }] } },
};

test("Health Guard public card exposes only funded notifications", () => {
  const card = publicAgentCard("https://health.relic.example/");
  assert.equal(card.url, "https://health.relic.example/apex");
  assert.deepEqual(card.skills.map((skill) => skill.id), ["notify_funded"]);
  assert.equal(fundedJobId(notification), "8183");
  assert.equal(fundedJobId({ ...notification, method: "message/get" }), null);
});

test("public gateway replaces untrusted request contents with a canonical job reference", async () => {
  let request: Request | undefined;
  const result = await forwardFundedNotification(notification, {
    privateAgentUrl: "http://health-guard.internal:9000",
    privateAgentBearerToken: "private-token",
    allowInternalHttp: true,
  }, async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
  }, "c84edc83-4d8a-4a8e-9d9c-1f899e58a956");

  assert.equal(result.status, 202);
  assert.deepEqual(result.body, { status: "accepted" });
  assert.equal(request?.url, "http://health-guard.internal:9000/cycles");
  assert.equal(request?.headers.get("authorization"), "Bearer private-token");
  assert.equal(request?.headers.get("x-relic-delivery-id"), "c84edc83-4d8a-4a8e-9d9c-1f899e58a956");
  assert.equal(await request?.text(), JSON.stringify({ commerceJobId: "8183" }));
});

test("public gateway rejects non-HTTPS private endpoints outside private networking", () => {
  assert.throws(() => privateCycleEndpoint({ privateAgentUrl: "http://private.example", privateAgentBearerToken: "token" }));
});
