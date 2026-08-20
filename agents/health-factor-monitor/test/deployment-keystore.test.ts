import { describe, expect, it } from "vitest";

import {
  decryptV3Keystore,
  encryptLightV3KeystoreWithPassword,
  LIGHT_SCRYPT_PARAMETERS,
  parseV3Keystore,
} from "../src/deployment-keystore.js";

const TEST_PASSWORD = "test-only-password";
const fixturePrivateKey = () =>
  Buffer.from(
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "hex",
  );

describe("testnet deployment V3 keystore", () => {
  it("encrypts and decrypts with exact Geth light scrypt parameters", () => {
    const privateKey = fixturePrivateKey();
    const encrypted = encryptLightV3KeystoreWithPassword(
      privateKey,
      TEST_PASSWORD,
    );
    const serialized = JSON.stringify(encrypted.keystore);
    expect(serialized).not.toContain(privateKey.toString("hex"));
    expect(encrypted.keystore.crypto.kdfparams).toMatchObject(
      LIGHT_SCRYPT_PARAMETERS,
    );

    const decrypted = decryptV3Keystore(
      parseV3Keystore(serialized),
      TEST_PASSWORD,
    );
    try {
      expect(decrypted.address).toBe(encrypted.address);
      expect(decrypted.privateKey.equals(privateKey)).toBe(true);
    } finally {
      decrypted.privateKey.fill(0);
      privateKey.fill(0);
    }
  });

  it("uses fresh salt, IV, and UUID for every representation", () => {
    const privateKey = fixturePrivateKey();
    try {
      const first = encryptLightV3KeystoreWithPassword(
        privateKey,
        TEST_PASSWORD,
      ).keystore;
      const second = encryptLightV3KeystoreWithPassword(
        privateKey,
        TEST_PASSWORD,
      ).keystore;
      expect(first.id).not.toBe(second.id);
      expect(first.crypto.cipherparams.iv).not.toBe(
        second.crypto.cipherparams.iv,
      );
      expect(first.crypto.kdfparams.salt).not.toBe(
        second.crypto.kdfparams.salt,
      );
    } finally {
      privateKey.fill(0);
    }
  });

  it("accepts the original SDK's standard 16-byte source salt", () => {
    const privateKey = fixturePrivateKey();
    try {
      const encrypted = encryptLightV3KeystoreWithPassword(
        privateKey,
        TEST_PASSWORD,
      ).keystore;
      encrypted.crypto.kdfparams.salt = "00".repeat(16);
      expect(() => parseV3Keystore(JSON.stringify(encrypted))).not.toThrow();
    } finally {
      privateKey.fill(0);
    }
  });

  it("rejects an invalid password", () => {
    const privateKey = fixturePrivateKey();
    try {
      const encrypted = encryptLightV3KeystoreWithPassword(
        privateKey,
        TEST_PASSWORD,
      );
      expect(() =>
        decryptV3Keystore(encrypted.keystore, "wrong-password"),
      ).toThrow("password or MAC is invalid");
    } finally {
      privateKey.fill(0);
    }
  });
});
