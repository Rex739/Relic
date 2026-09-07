import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedA2aSkill, privateAgentEndpoint, publicAgentCard } from "./publicGateway.js";

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

test("allows HTTP only when explicitly configured for private networking", () => {
  assert.throws(() => privateAgentEndpoint({ privateAgentUrl: "http://agent:9000", privateAgentBearerToken: "token" }));
  assert.equal(privateAgentEndpoint({ privateAgentUrl: "http://agent:9000", privateAgentBearerToken: "token", allowInternalHttp: true }).hostname, "agent");
});
