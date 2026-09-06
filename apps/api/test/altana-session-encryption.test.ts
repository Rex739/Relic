import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AltanaSessionEncryption } from "../src/altana-session-encryption.js";

describe("AltanaSessionEncryption", () => {
  it("round-trips a session secret without exposing it in the envelope", () => {
    const encryption = new AltanaSessionEncryption(
      randomBytes(32).toString("base64"),
    );
    const plaintext = "0xsession-private-key";
    const encrypted = encryption.encrypt(plaintext);

    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain(plaintext);
    expect(encryption.decrypt(encrypted)).toBe(plaintext);
  });

  it("rejects a malformed encryption key or ciphertext envelope", () => {
    expect(() => new AltanaSessionEncryption("not-a-32-byte-key")).toThrow();
    const encryption = new AltanaSessionEncryption(
      randomBytes(32).toString("base64"),
    );
    expect(() => encryption.decrypt("v0.bad")).toThrow();
  });
});
