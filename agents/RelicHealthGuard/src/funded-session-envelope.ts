import { createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman } from "node:crypto";

type Envelope = { version?: unknown; ephemeralPublicKey?: unknown; iv?: unknown; tag?: unknown; ciphertext?: unknown };
const key = (shared: Buffer) => createHash("sha256").update(shared).digest();

/** Opens a one-time API envelope in memory. The session secret is never logged or written to disk. */
export function openFundedSession(envelopeJson: string, executorPrivateKeyPem: string): `0x${string}` {
  let envelope: Envelope;
  try { envelope = JSON.parse(envelopeJson) as Envelope; } catch { throw new Error("Health Guard funded session envelope is not valid JSON"); }
  if (envelope.version !== 1 || typeof envelope.ephemeralPublicKey !== "string" || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string")
    throw new Error("Health Guard funded session envelope is malformed");
  const privateKey = createPrivateKey(executorPrivateKeyPem);
  const ephemeral = createPublicKey(envelope.ephemeralPublicKey);
  if (privateKey.asymmetricKeyType !== "x25519" || ephemeral.asymmetricKeyType !== "x25519")
    throw new Error("Health Guard funded session envelope requires X25519 keys");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(diffieHellman({ privateKey, publicKey: ephemeral })), Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const output = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
    if (!/^0x[0-9a-fA-F]{64}$/u.test(output)) throw new Error("Health Guard funded session envelope contains an invalid key");
    return output as `0x${string}`;
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalid key")) throw error;
    throw new Error("Health Guard funded session envelope could not be authenticated");
  }
}
