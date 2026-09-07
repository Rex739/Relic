import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { openFundedSession } from "./fundedSessionEnvelope.js";

test("rejects malformed funded-session envelopes", () => {
  const keys = generateKeyPairSync("x25519");
  assert.throws(() => openFundedSession("{}", keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()), /malformed/);
});
