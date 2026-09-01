import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import test from "node:test";

import { relicConnectMiddleware } from "./relicConnect.js";

const privateKeyPem = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEILzslPvxL36ow3IM+uuD1GnMjBpNjByuyyJF5wCyHk1Z
-----END PRIVATE KEY-----`;
const publicKeyPem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAdp9K7DuOMnMIVw7AApEx6bGnYg1IcmzWcPV/05mx0KU=
-----END PUBLIC KEY-----`;

function token(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(null, Buffer.from(`${header}.${payload}`), createPrivateKey(privateKeyPem)).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function invoke(tokenValue: string | undefined) {
  const middleware = relicConnectMiddleware({
    publicKeyPem,
    audience: "https://agent.example/invocations?qualifier=DEFAULT",
    now: () => 1_000_000,
  });
  let status: number | undefined;
  let body: unknown;
  let next = false;
  middleware(
    {
      method: "POST",
      path: "/message/send",
      header: (name: string) => (name === "authorization" && tokenValue ? `Bearer ${tokenValue}` : undefined),
    } as never,
    {
      status: (value: number) => {
        status = value;
        return { json: (valueBody: unknown) => { body = valueBody; } };
      },
    } as never,
    () => { next = true; },
  );
  return { status, body, next };
}

test("Relic Connect accepts an inspection token for this runtime only", () => {
  const value = token({
    iss: "relic-connect",
    aud: "https://agent.example/invocations",
    scope: ["relic.inspect"],
    exp: 1_060,
  });
  assert.deepEqual(invoke(value), { status: undefined, body: undefined, next: true });
});

test("Relic Connect rejects an expired or wrong-audience token", () => {
  const value = token({
    iss: "relic-connect",
    aud: "https://other.example/invocations",
    scope: ["relic.invoke"],
    exp: 999,
  });
  assert.deepEqual(invoke(value), {
    status: 403,
    body: { error: "relic_connect_token_not_authorized" },
    next: false,
  });
});
