import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sealFundedSession } from "./funded-session-envelope.js";

describe("funded session envelope", () => {
  it("binds the release to the executor's X25519 key", async () => {
    const keys = generateKeyPairSync("x25519");
    const envelope = sealFundedSession("session-secret", keys.publicKey.export({ type: "spki", format: "pem" }).toString());
    expect(JSON.parse(envelope).version).toBe(1);
    expect(JSON.parse(envelope).ciphertext).not.toContain("session-secret");
  });
});
