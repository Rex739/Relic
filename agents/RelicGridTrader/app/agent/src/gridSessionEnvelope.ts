import { createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman } from "node:crypto";

/** Opens an API-sealed per-job session only in the private Grid runtime. */
export function openGridFundedSession(envelope: string, privateKeyPem: string): string {
  let value: unknown;
  try { value = JSON.parse(envelope); } catch { throw new Error("Grid funded session envelope is malformed"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Grid funded session envelope is malformed");
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || typeof input.ephemeralPublicKey !== "string" || typeof input.iv !== "string" || typeof input.tag !== "string" || typeof input.ciphertext !== "string") throw new Error("Grid funded session envelope is incomplete");
  const privateKey = createPrivateKey(privateKeyPem);
  const ephemeral = createPublicKey(input.ephemeralPublicKey);
  if (privateKey.asymmetricKeyType !== "x25519" || ephemeral.asymmetricKeyType !== "x25519") throw new Error("Grid funded session envelope requires X25519 keys");
  try {
    const key = createHash("sha256").update(diffieHellman({ privateKey, publicKey: ephemeral })).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(input.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(input.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(input.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Grid funded session envelope could not be authenticated"); }
}
