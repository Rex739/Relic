import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const algorithm = "aes-256-gcm";
const version = "v1";

/**
 * Encrypts the private half of a buyer's scoped Altana session key before it
 * is persisted. The buyer's admin/private wallet key is never accepted here.
 */
export class AltanaSessionEncryption {
  readonly #key: Buffer;

  public constructor(encodedKey: string) {
    this.#key = Buffer.from(encodedKey.trim(), "base64");
    if (this.#key.length !== 32)
      throw new Error(
        "ALTANA_SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes",
      );
  }

  public encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(algorithm, this.#key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      version,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  public decrypt(envelope: string): string {
    const [envelopeVersion, iv, tag, ciphertext, ...extra] = envelope.split(".");
    if (
      envelopeVersion !== version ||
      iv === undefined ||
      tag === undefined ||
      ciphertext === undefined ||
      extra.length > 0
    )
      throw new Error("Invalid encrypted Altana session envelope");
    const decipher = createDecipheriv(
      algorithm,
      this.#key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
