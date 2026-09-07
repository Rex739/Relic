import { createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman } from "node:crypto";

type Envelope = { version?: unknown; ephemeralPublicKey?: unknown; iv?: unknown; tag?: unknown; ciphertext?: unknown };
const key = (shared: Buffer) => createHash("sha256").update(shared).digest();

/** Opens an API-issued envelope in memory. The plaintext must never be logged or persisted. */
export function openFundedSession(envelopeJson: string, executorPrivateKeyPem: string): string {
  let envelope: Envelope;
  try { envelope = JSON.parse(envelopeJson) as Envelope; } catch { throw new Error("Funded session envelope is not valid JSON"); }
  if (envelope.version !== 1 || typeof envelope.ephemeralPublicKey !== "string" || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") throw new Error("Funded session envelope is malformed");
  const privateKey = createPrivateKey(executorPrivateKeyPem);
  const ephemeral = createPublicKey(envelope.ephemeralPublicKey);
  if (privateKey.asymmetricKeyType !== "x25519" || ephemeral.asymmetricKeyType !== "x25519") throw new Error("Funded session envelope requires X25519 keys");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(diffieHellman({ privateKey, publicKey: ephemeral })), Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Funded session envelope could not be authenticated"); }
}
