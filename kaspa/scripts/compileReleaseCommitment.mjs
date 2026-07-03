import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const kaspaRoot = join(repoRoot, "kaspa");
const contractPath = join(kaspaRoot, "contracts", "ReleaseCommitment.sil");
const argsPath = join(kaspaRoot, "contracts", "ReleaseCommitment.args.json");
const artifactsDir = join(kaspaRoot, "artifacts");
const artifactPath = join(artifactsDir, "ReleaseCommitment.json");
const toolchainRoot = process.env.SILVERSCRIPT_ROOT ?? "/tmp/relic-silverscript";
const toolchainCargo = join(toolchainRoot, "Cargo.toml");
const silvercSource = join(toolchainRoot, "silverscript-lang", "src", "bin", "silverc.rs");

function requirePath(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found at ${path}`);
  }
}

function run(command, args, cwd) {
  console.log(`Compiler command: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout.trim()) {
    console.log(result.stdout.trim());
  }

  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }

  if (result.status !== 0) {
    throw new Error(`compiler command failed with status ${result.status}`);
  }
}

try {
  requirePath(contractPath, "ReleaseCommitment.sil");
  requirePath(argsPath, "ReleaseCommitment constructor args");
  requirePath(toolchainCargo, "official Silverscript Cargo workspace");
  requirePath(silvercSource, "official silverc source");
  await mkdir(artifactsDir, { recursive: true });

  run(
    "cargo",
    [
      "run",
      "-p",
      "silverscript-lang",
      "--bin",
      "silverc",
      "--",
      contractPath,
      "--constructor-args",
      argsPath,
      "-o",
      artifactPath,
    ],
    toolchainRoot,
  );

  requirePath(artifactPath, "compiled ReleaseCommitment artifact");
  console.log(`Artifact written: ${artifactPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
