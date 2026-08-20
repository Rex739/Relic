import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { bytesToHex, getAddress, hexToBytes, keccak256 } from "viem";

export const LIGHT_SCRYPT_PARAMETERS = {
  dklen: 32,
  n: 4096,
  p: 6,
  r: 8,
} as const;

interface KeystoreV3 {
  address: string;
  crypto: {
    cipher: string;
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: string;
    kdfparams: {
      dklen: number;
      n: number;
      p: number;
      r: number;
      salt: string;
    };
    mac: string;
  };
  id: string;
  version: number;
}

const parseHex = (
  value: unknown,
  field: string,
  expectedBytes?: number,
): Buffer => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]+$/iu.test(value)
  )
    throw new Error(`Invalid hexadecimal ${field} in V3 keystore`);
  const result = Buffer.from(value, "hex");
  if (expectedBytes !== undefined && result.length !== expectedBytes)
    throw new Error(`Invalid ${field} length in V3 keystore`);
  return result;
};

const positiveInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid ${field} in V3 keystore`);
  return value;
};

const parseSalt = (value: unknown): Buffer => {
  const salt = parseHex(value, "salt");
  if (salt.length < 16 || salt.length > 64)
    throw new Error("Invalid salt length in V3 keystore");
  return salt;
};

export const parseV3Keystore = (serialized: string): KeystoreV3 => {
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Keystore is not valid JSON");
  }
  if (!candidate || typeof candidate !== "object")
    throw new Error("Keystore is not an object");

  const record = candidate as Record<string, unknown>;
  const cryptoValue = record.crypto ?? record.Crypto;
  if (record.version !== 3 || !cryptoValue || typeof cryptoValue !== "object")
    throw new Error("Only Ethereum V3 keystores are supported");

  const crypto = cryptoValue as Record<string, unknown>;
  const cipherparams = crypto.cipherparams as
    Record<string, unknown> | undefined;
  const kdfparams = crypto.kdfparams as Record<string, unknown> | undefined;
  if (!cipherparams || !kdfparams)
    throw new Error("V3 keystore cryptographic parameters are missing");
  if (crypto.cipher !== "aes-128-ctr" || crypto.kdf !== "scrypt")
    throw new Error("Only scrypt/AES-128-CTR V3 keystores are supported");

  const address = record.address;
  const id = record.id;
  if (
    typeof address !== "string" ||
    !/^(?:0x)?[0-9a-f]{40}$/iu.test(address) ||
    typeof id !== "string" ||
    id.length === 0
  )
    throw new Error("V3 keystore identity metadata is invalid");

  parseHex(cipherparams.iv, "IV", 16);
  parseHex(crypto.ciphertext, "ciphertext", 32);
  parseSalt(kdfparams.salt);
  parseHex(crypto.mac, "MAC", 32);

  return {
    address,
    crypto: {
      cipher: crypto.cipher,
      cipherparams: { iv: cipherparams.iv as string },
      ciphertext: crypto.ciphertext as string,
      kdf: crypto.kdf,
      kdfparams: {
        dklen: positiveInteger(kdfparams.dklen, "scrypt dklen"),
        n: positiveInteger(kdfparams.n, "scrypt N"),
        p: positiveInteger(kdfparams.p, "scrypt p"),
        r: positiveInteger(kdfparams.r, "scrypt r"),
        salt: kdfparams.salt as string,
      },
      mac: crypto.mac as string,
    },
    id,
    version: 3,
  };
};

const deriveKey = (
  password: string,
  salt: Buffer,
  parameters: KeystoreV3["crypto"]["kdfparams"],
): Buffer => {
  if (parameters.dklen !== 32)
    throw new Error("V3 keystore scrypt dklen must be 32");
  if ((parameters.n & (parameters.n - 1)) !== 0)
    throw new Error("V3 keystore scrypt N must be a power of two");
  if (parameters.n > 1_048_576 || parameters.r > 32 || parameters.p > 32)
    throw new Error("V3 keystore scrypt parameters exceed local safety limits");

  const estimatedMemory = 128 * parameters.n * parameters.r;
  const maxmem = Math.max(32 * 1024 * 1024, estimatedMemory + 32 * 1024 * 1024);
  return scryptSync(password, salt, parameters.dklen, {
    N: parameters.n,
    maxmem,
    p: parameters.p,
    r: parameters.r,
  });
};

const addressFromPrivateKey = (privateKey: Buffer): `0x${string}` => {
  if (privateKey.length !== 32)
    throw new Error("Decrypted V3 keystore key is not 32 bytes");
  const keyAgreement = createECDH("secp256k1");
  keyAgreement.setPrivateKey(privateKey);
  const publicKey = keyAgreement.getPublicKey(undefined, "uncompressed");
  try {
    const publicKeyHash = keccak256(publicKey.subarray(1));
    return getAddress(`0x${publicKeyHash.slice(-40)}`);
  } finally {
    publicKey.fill(0);
  }
};

export interface DecryptedV3Keystore {
  address: `0x${string}`;
  privateKey: Buffer;
}

export const decryptV3Keystore = (
  keystore: KeystoreV3,
  password: string,
): DecryptedV3Keystore => {
  const salt = parseSalt(keystore.crypto.kdfparams.salt);
  const iv = parseHex(keystore.crypto.cipherparams.iv, "IV", 16);
  const ciphertext = parseHex(keystore.crypto.ciphertext, "ciphertext", 32);
  const expectedMac = parseHex(keystore.crypto.mac, "MAC", 32);
  let derivedKey: Buffer | undefined;
  let privateKey: Buffer | undefined;

  try {
    derivedKey = deriveKey(password, salt, keystore.crypto.kdfparams);
    const actualMac = Buffer.from(
      hexToBytes(
        keccak256(
          bytesToHex(Buffer.concat([derivedKey.subarray(16, 32), ciphertext])),
        ),
      ),
    );
    if (
      actualMac.length !== expectedMac.length ||
      !timingSafeEqual(actualMac, expectedMac)
    )
      throw new Error("V3 keystore password or MAC is invalid");

    const decipher = createDecipheriv(
      "aes-128-ctr",
      derivedKey.subarray(0, 16),
      iv,
    );
    privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const address = addressFromPrivateKey(privateKey);
    if (
      address.slice(2).toLowerCase() !==
      keystore.address.replace(/^0x/u, "").toLowerCase()
    )
      throw new Error("V3 keystore address does not match its decrypted key");
    return { address, privateKey };
  } catch (error) {
    privateKey?.fill(0);
    throw error;
  } finally {
    derivedKey?.fill(0);
    salt.fill(0);
  }
};

export const encryptLightV3KeystoreWithPassword = (
  privateKey: Buffer,
  password: string,
): { address: `0x${string}`; keystore: KeystoreV3 } => {
  if (!password) throw new Error("A non-empty keystore password is required");
  const address = addressFromPrivateKey(privateKey);
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  let derivedKey: Buffer | undefined;

  try {
    const kdfparams = {
      ...LIGHT_SCRYPT_PARAMETERS,
      salt: salt.toString("hex"),
    };
    derivedKey = deriveKey(password, salt, kdfparams);
    const cipher = createCipheriv(
      "aes-128-ctr",
      derivedKey.subarray(0, 16),
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update(privateKey),
      cipher.final(),
    ]);
    const mac = keccak256(
      bytesToHex(Buffer.concat([derivedKey.subarray(16, 32), ciphertext])),
    ).slice(2);

    return {
      address,
      keystore: {
        address: address.slice(2).toLowerCase(),
        crypto: {
          cipher: "aes-128-ctr",
          cipherparams: { iv: iv.toString("hex") },
          ciphertext: ciphertext.toString("hex"),
          kdf: "scrypt",
          kdfparams,
          mac,
        },
        id: randomUUID(),
        version: 3,
      },
    };
  } finally {
    derivedKey?.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
};
