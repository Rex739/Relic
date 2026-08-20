import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyInjectedKeystore } from "../src/wallet-keystore.js";

const directories: string[] = [];
const address = "0x323F064B777745703Fa8eB56109A763503AeE4Dd" as const;

const fixtureDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "relic-keystore-test-"));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

describe("injected keystore preflight", () => {
  it("accepts a matching encrypted V3 keystore", () => {
    const directory = fixtureDirectory();
    writeFileSync(
      join(directory, `${address}.json`),
      JSON.stringify({
        version: 3,
        address: address.slice(2).toLowerCase(),
        crypto: { ciphertext: "fixture-encrypted-content" },
      }),
    );
    expect(() => verifyInjectedKeystore(address, directory)).not.toThrow();
  });

  it("rejects an address mismatch without asking the SDK to create a wallet", () => {
    const directory = fixtureDirectory();
    writeFileSync(
      join(directory, `${address}.json`),
      JSON.stringify({
        version: 3,
        address: "0".repeat(40),
        crypto: { ciphertext: "fixture-encrypted-content" },
      }),
    );
    expect(() => verifyInjectedKeystore(address, directory)).toThrow(
      /does not match/,
    );
  });

  it("rejects a missing keystore directory", () => {
    const parent = fixtureDirectory();
    const missing = join(parent, "missing");
    expect(() => verifyInjectedKeystore(address, missing)).toThrow(
      /missing or is not a directory/,
    );
  });

  it("rejects a directory in place of the expected keystore file", () => {
    const directory = fixtureDirectory();
    mkdirSync(join(directory, `${address}.json`));
    expect(() => verifyInjectedKeystore(address, directory)).toThrow(
      /refusing SDK wallet auto-creation/,
    );
  });
});
