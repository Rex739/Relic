import { createCipheriv, createHash, diffieHellman, generateKeyPairSync, randomBytes, createPublicKey } from "node:crypto";

type Envelope = Readonly<{ version: 1; ephemeralPublicKey: string; iv: string; tag: string; ciphertext: string }>;

const key = (shared: Buffer) => createHash("sha256").update(shared).digest();

/** Encrypts a just-authorized scoped session to one private executor. */
export function sealFundedSession(sessionPrivateKey: string, executorPublicKeyPem: string): string {
  const recipient = createPublicKey(executorPublicKeyPem);
  if (recipient.asymmetricKeyType !== "x25519") throw new Error("Yield session transfer requires an X25519 executor public key");
  const ephemeral = generateKeyPairSync("x25519");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient })), iv);
  const ciphertext = Buffer.concat([cipher.update(sessionPrivateKey, "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    ephemeralPublicKey: ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString(),
    iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url"),
  } satisfies Envelope);
}
