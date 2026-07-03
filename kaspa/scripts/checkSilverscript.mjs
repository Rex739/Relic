import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const kaspaRoot = join(repoRoot, "kaspa");
const contractPath = join(kaspaRoot, "contracts", "ReleaseCommitment.sil");
const argsPath = join(kaspaRoot, "contracts", "ReleaseCommitment.args.json");
const artifactPath = join(kaspaRoot, "artifacts", "ReleaseCommitment.json");
const toolchainRoot = process.env.SILVERSCRIPT_ROOT ?? "/tmp/relic-silverscript";
const toolchainCargo = join(toolchainRoot, "Cargo.toml");
const silvercSource = join(toolchainRoot, "silverscript-lang", "src", "bin", "silverc.rs");
const silverscriptCargo = join(toolchainRoot, "silverscript-lang", "Cargo.toml");

function commandStatus(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    available: result.status === 0,
    output: `${result.stdout}${result.stderr}`.trim(),
  };
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const rust = commandStatus("rustc");
const cargo = commandStatus("cargo");
const git = commandStatus("git");
const node = commandStatus("node");
const contractExists = await fileExists(contractPath);
const argsExist = await fileExists(argsPath);
const artifactExists = await fileExists(artifactPath);
const toolchainExists = existsSync(toolchainCargo);
const silvercExists = existsSync(silvercSource);
const packageExists = existsSync(silverscriptCargo);

console.log("Relic Kaspa Silverscript validation check");
console.log("No tools will be installed. No wallets, keys, or funds will be created.");
console.log("");
console.log(`Contract: ${contractPath}`);
console.log(`Contract exists: ${contractExists ? "yes" : "no"}`);
console.log(`Constructor args: ${argsPath}`);
console.log(`Constructor args exist: ${argsExist ? "yes" : "no"}`);
console.log(`Artifact: ${artifactPath}`);
console.log(`Artifact exists: ${artifactExists ? "yes" : "no"}`);
console.log(`rustc: ${rust.available ? rust.output : "not found"}`);
console.log(`cargo: ${cargo.available ? cargo.output : "not found"}`);
console.log(`git: ${git.available ? git.output : "not found"}`);
console.log(`node: ${node.available ? node.output : "not found"}`);
console.log(`Silverscript root: ${toolchainRoot}`);
console.log(`Official workspace detected: ${toolchainExists ? "yes" : "no"}`);
console.log(`silverscript-lang package detected: ${packageExists ? "yes" : "no"}`);
console.log(`silverc source detected: ${silvercExists ? "yes" : "no"}`);
console.log("");

if (!contractExists) {
  process.exitCode = 1;
  console.log("Status: blocked. ReleaseCommitment.sil is missing.");
} else if (!argsExist) {
  process.exitCode = 1;
  console.log("Status: blocked. ReleaseCommitment.args.json is missing.");
} else if (!rust.available || !cargo.available) {
  process.exitCode = 1;
  console.log("Status: blocked. Rust and Cargo are required before attempting Silverscript validation.");
} else if (!toolchainExists || !packageExists || !silvercExists) {
  process.exitCode = 1;
  console.log("Status: blocked. Official Silverscript workspace was not detected.");
  console.log("Clone https://github.com/kaspanet/silverscript into /tmp/relic-silverscript, or set SILVERSCRIPT_ROOT.");
} else {
  console.log("Status: ready for compilation.");
  console.log("Verified compiler command:");
  console.log(
    `cargo run -p silverscript-lang --bin silverc -- ${contractPath} --constructor-args ${argsPath} -o ${artifactPath}`,
  );
}
