import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface KeystoreV3Shape {
  address?: unknown;
  crypto?: unknown;
  version?: unknown;
}

export const verifyInjectedKeystore = (
  address: `0x${string}`,
  directory: string,
) => {
  const directoryStat = statSync(directory, { throwIfNoEntry: false });
  if (!directoryStat?.isDirectory())
    throw new Error("WALLET_KEYSTORE_DIR is missing or is not a directory");

  const path = join(directory, `${address}.json`);
  const fileStat = statSync(path, { throwIfNoEntry: false });
  if (!fileStat?.isFile())
    throw new Error(
      "Encrypted keystore for WALLET_ADDRESS is missing from WALLET_KEYSTORE_DIR; refusing SDK wallet auto-creation",
    );
  if (fileStat.size > 1024 * 1024)
    throw new Error("Encrypted keystore exceeds the 1 MiB safety limit");

  let parsed: KeystoreV3Shape;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as KeystoreV3Shape;
  } catch {
    throw new Error("Encrypted keystore is not valid JSON");
  }
  if (parsed.version !== 3 || typeof parsed.crypto !== "object")
    throw new Error("Encrypted keystore is not a supported V3 keystore");
  const expectedAddress = address.slice(2).toLowerCase();
  if (
    typeof parsed.address !== "string" ||
    parsed.address.replace(/^0x/u, "").toLowerCase() !== expectedAddress
  )
    throw new Error("WALLET_ADDRESS does not match the encrypted keystore");
};
