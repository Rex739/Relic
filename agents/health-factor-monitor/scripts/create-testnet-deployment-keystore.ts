import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress } from "viem";

import { loadLocalEnvironment } from "../src/local-env.js";
import {
  decryptV3Keystore,
  encryptLightV3KeystoreWithPassword,
  LIGHT_SCRYPT_PARAMETERS,
  parseV3Keystore,
} from "../src/deployment-keystore.js";

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(agentRoot, "../..");
const deploymentDirectory = join(agentRoot, ".deployment-secrets", "wallets");
loadLocalEnvironment(repositoryRoot);
loadLocalEnvironment(process.cwd());
loadLocalEnvironment(agentRoot);

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

if (process.env.PRIVATE_KEY)
  throw new Error(
    "PRIVATE_KEY is forbidden; this utility only re-encrypts an existing V3 keystore",
  );
if (process.env.NETWORK && process.env.NETWORK !== "bsc-testnet")
  throw new Error("This deployment-keystore utility is locked to bsc-testnet");

const walletAddress = getAddress(required("WALLET_ADDRESS"));
const sourceDirectoryInput =
  process.env.WALLET_KEYSTORE_DIR?.trim() || ".studio/wallets";
const sourceDirectory = isAbsolute(sourceDirectoryInput)
  ? sourceDirectoryInput
  : resolve(agentRoot, sourceDirectoryInput);
const sourcePath = join(sourceDirectory, `${walletAddress}.json`);
const destinationPath = join(deploymentDirectory, `${walletAddress}.json`);
const temporaryPath = join(deploymentDirectory, `.${randomUUID()}.tmp`);
const password = required("WALLET_PASSWORD");
delete process.env.WALLET_PASSWORD;

const sourceStat = statSync(sourcePath, { throwIfNoEntry: false });
if (!sourceStat?.isFile())
  throw new Error("The existing encrypted testnet V3 keystore was not found");
if (sourceStat.size > 1024 * 1024)
  throw new Error("The existing V3 keystore exceeds the 1 MiB safety limit");

const originalSerialized = readFileSync(sourcePath, "utf8");
const originalDigest = createHash("sha256").update(originalSerialized).digest();
const original = parseV3Keystore(originalSerialized);
let originalDecrypted: ReturnType<typeof decryptV3Keystore> | undefined;
let deploymentDecrypted: ReturnType<typeof decryptV3Keystore> | undefined;
let temporaryCreated = false;

try {
  originalDecrypted = decryptV3Keystore(original, password);
  if (getAddress(originalDecrypted.address) !== walletAddress)
    throw new Error("WALLET_ADDRESS does not match the original V3 keystore");

  const deployment = encryptLightV3KeystoreWithPassword(
    originalDecrypted.privateKey,
    password,
  );
  if (getAddress(deployment.address) !== walletAddress)
    throw new Error("Deployment keystore address changed during re-encryption");

  mkdirSync(deploymentDirectory, { mode: 0o700, recursive: true });
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  temporaryCreated = true;
  try {
    writeFileSync(
      descriptor,
      `${JSON.stringify(deployment.keystore)}\n`,
      "utf8",
    );
  } finally {
    closeSync(descriptor);
  }

  const persistedDeployment = parseV3Keystore(
    readFileSync(temporaryPath, "utf8"),
  );
  deploymentDecrypted = decryptV3Keystore(persistedDeployment, password);
  if (
    getAddress(deploymentDecrypted.address) !== walletAddress ||
    !originalDecrypted.privateKey.equals(deploymentDecrypted.privateKey)
  )
    throw new Error("Original and deployment keystores are not equivalent");

  const finalOriginalDigest = createHash("sha256")
    .update(readFileSync(sourcePath))
    .digest();
  if (!originalDigest.equals(finalOriginalDigest))
    throw new Error("The original V3 keystore changed during re-encryption");

  linkSync(temporaryPath, destinationPath);
  unlinkSync(temporaryPath);
  temporaryCreated = false;

  process.stdout.write(
    `${JSON.stringify({
      address: walletAddress,
      destination: destinationPath,
      kdf: { ...LIGHT_SCRYPT_PARAMETERS },
      network: "bsc-testnet",
      originalUnchanged: true,
      privateKeyEqualityVerified: true,
      sameAddressVerified: true,
    })}\n`,
  );
} finally {
  if (temporaryCreated) unlinkSync(temporaryPath);
  originalDecrypted?.privateKey.fill(0);
  deploymentDecrypted?.privateKey.fill(0);
}
