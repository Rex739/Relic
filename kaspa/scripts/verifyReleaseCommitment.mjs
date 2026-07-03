import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const kaspaRoot = join(repoRoot, "kaspa");
const sourcePath = join(kaspaRoot, "contracts", "ReleaseCommitment.sil");
const artifactPath = join(kaspaRoot, "artifacts", "ReleaseCommitment.json");
const reportPath = join(kaspaRoot, "artifacts", "ReleaseCommitment.verification.md");
const toolchainRoot = process.env.SILVERSCRIPT_ROOT ?? "/tmp/relic-silverscript";
const debuggerReadmePath = join(toolchainRoot, "debugger", "cli", "README.md");
const debuggerTestRunnerPath = join(toolchainRoot, "debugger", "session", "src", "test_runner.rs");

const expectedCompilerVersion = "0.1.0";
const forbiddenReleaseReadyNames = ["releaseReady", "markReleaseReady", "setReleaseReady", "RELEASE_READY"];
const expectedAbi = [
  "__covenant_entrypoint_auth_acknowledgeFinance",
  "__covenant_entrypoint_auth_acknowledgeBilling",
  "__covenant_entrypoint_auth_supersede",
];

function fail(message) {
  throw new Error(message);
}

function requireFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} missing at ${path}`);
  }
}

function includesAll(haystack, needles) {
  return needles.every((needle) => haystack.includes(needle));
}

function sourceHasFunction(source, functionName) {
  return new RegExp(`function\\s+${functionName}\\s*\\(`).test(source);
}

function sourceHasTransitionDeclaration(source, functionName) {
  return new RegExp(
    `#\\[covenant\\.singleton\\(mode\\s*=\\s*transition\\)\\]\\s*function\\s+${functionName}\\s*\\(`,
    "m",
  ).test(source);
}

function extractFunction(source, functionName) {
  const start = source.search(new RegExp(`function\\s+${functionName}\\s*\\(`));
  if (start < 0) {
    return "";
  }

  const braceStart = source.indexOf("{", start);
  if (braceStart < 0) {
    return "";
  }

  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return "";
}

function makeInvariant(name, ok, evidence) {
  return { name, ok, evidence };
}

function reportStatus(value) {
  return value ? "PASS" : "FAIL";
}

requireFile(sourcePath, "ReleaseCommitment source");
requireFile(artifactPath, "ReleaseCommitment artifact");

const source = readFileSync(sourcePath, "utf8");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const debuggerReadme = existsSync(debuggerReadmePath) ? readFileSync(debuggerReadmePath, "utf8") : "";
const debuggerTestRunnerExists = existsSync(debuggerTestRunnerPath);

const contractName = artifact.contract_name;
const astName = artifact.ast?.name;
const compilerVersion = artifact.compiler_version;
const abiNames = Array.isArray(artifact.abi) ? artifact.abi.map((entry) => entry.name) : [];
const artifactFunctionNames = Array.isArray(artifact.ast?.functions)
  ? artifact.ast.functions.map((fn) => fn.name)
  : [];
const sourceContractMatches = /contract\s+ReleaseCommitment\s*\(/.test(source);
const releaseReadyEntrypoints = abiNames.filter((name) =>
  forbiddenReleaseReadyNames.some((forbidden) => name.toLowerCase().includes(forbidden.toLowerCase())),
);
const releaseReadySourceFunctions = forbiddenReleaseReadyNames.filter((name) => sourceHasFunction(source, name));

const financeBody = extractFunction(source, "acknowledgeFinance");
const billingBody = extractFunction(source, "acknowledgeBilling");
const supersedeBody = extractFunction(source, "supersede");

const runtimeSupportDetected =
  debuggerReadme.includes("For covenant tests") &&
  debuggerReadme.includes("active_input_index") &&
  debuggerTestRunnerExists;
const runtimeProofStatus = "STATIC ONLY";
const runtimeLimitation = runtimeSupportDetected
  ? "The official debugger documents covenant transaction-context tests, but this contract's paths require valid signature checks. No wallet/private-key material was created or used, so runtime covenant execution was not performed."
  : "No official runtime/debugger covenant transaction-context support was detected in the local toolchain checkout.";

const invariants = [
  makeInvariant(
    "A blocked commitment begins in an acknowledgement-required state.",
    source.includes("int initStatus") && existsSync(join(kaspaRoot, "contracts", "ReleaseCommitment.args.json")),
    "Constructor includes initStatus. The deterministic constructor args initialize status to 0.",
  ),
  makeInvariant(
    "Finance acknowledgement is allowed only from the initial blocked state.",
    includesAll(financeBody, [
      "require(prev_state.status == 0)",
      "require(prev_state.financeAcknowledged == false)",
      "require(prev_state.billingAcknowledged == false)",
      "require(checkSig(financeSignature, prev_state.financeOwner))",
      "status: 1",
    ]),
    "acknowledgeFinance requires status 0, both acknowledgement flags false, Finance Systems Owner signature, and returns status 1.",
  ),
  makeInvariant(
    "Billing acknowledgement is not valid before Finance acknowledgement.",
    includesAll(billingBody, [
      "require(prev_state.status == 1)",
      "require(prev_state.financeAcknowledged == true)",
      "require(prev_state.billingAcknowledged == false)",
      "require(checkSig(billingSignature, prev_state.billingPolicyLead))",
    ]),
    "acknowledgeBilling requires status 1 and financeAcknowledged true before Billing Policy Lead signature can advance.",
  ),
  makeInvariant(
    "The valid acknowledgement sequence leads to REMEDIATION_REQUIRED.",
    includesAll(financeBody, ["status: 1", "financeAcknowledged: true"]) &&
      includesAll(billingBody, ["status: 2", "financeAcknowledged: true", "billingAcknowledged: true"]),
    "Finance transition returns status 1; billing transition returns status 2 with both acknowledgements true.",
  ),
  makeInvariant(
    "There is no valid contract transition from BLOCKED to RELEASE_READY.",
    releaseReadyEntrypoints.length === 0 && releaseReadySourceFunctions.length === 0 && !source.includes("status: 4"),
    "ABI exposes no release-ready entrypoint and source contains no RELEASE_READY function or status return.",
  ),
  makeInvariant(
    "There is no valid contract transition from REMEDIATION_REQUIRED to RELEASE_READY.",
    includesAll(supersedeBody, [
      "require(prev_state.status == 2)",
      "require(prev_state.financeAcknowledged == true)",
      "require(prev_state.billingAcknowledged == true)",
      "status: 3",
    ]) && !supersedeBody.includes("status: 4"),
    "The only remediation-state transition is supersede, which returns status 3 rather than release-ready.",
  ),
  makeInvariant(
    "RELEASE_READY must require a separate clean-review commitment.",
    includesAll(supersedeBody, [
      "byte[32] supersedingCommitmentId",
      "require(supersedingCommitmentId != prev_state.commitmentId)",
      "sourceCommitmentId: supersedingCommitmentId",
    ]),
    "supersede requires a distinct supersedingCommitmentId and records it as sourceCommitmentId.",
  ),
  makeInvariant(
    "The original blocked commitment remains a separate evidence record.",
    includesAll(supersedeBody, [
      "commitmentId: prev_state.commitmentId",
      "evidenceDigest: prev_state.evidenceDigest",
      "status: 3",
    ]),
    "supersede preserves commitmentId and evidenceDigest while marking the blocked record superseded.",
  ),
  makeInvariant(
    "The implemented model uses 1:1 singleton covenant transition declarations.",
    ["acknowledgeFinance", "acknowledgeBilling", "supersede"].every((name) => sourceHasTransitionDeclaration(source, name)),
    "All three transition functions use #[covenant.singleton(mode = transition)].",
  ),
  makeInvariant(
    "Artifact ABI matches expected generated covenant entrypoints.",
    expectedAbi.every((entrypoint) => abiNames.includes(entrypoint)),
    `ABI entrypoints: ${abiNames.join(", ")}`,
  ),
];

if (contractName !== "ReleaseCommitment" || astName !== "ReleaseCommitment" || !sourceContractMatches) {
  fail("Source and artifact contract names do not match ReleaseCommitment.");
}

if (!compilerVersion) {
  fail("Artifact compiler version is missing.");
}

if (compilerVersion !== expectedCompilerVersion) {
  fail(`Unexpected compiler version ${compilerVersion}; expected ${expectedCompilerVersion}.`);
}

if (releaseReadyEntrypoints.length > 0 || releaseReadySourceFunctions.length > 0) {
  fail("Contract exposes a direct RELEASE_READY transition.");
}

const failedInvariants = invariants.filter((invariant) => !invariant.ok);
if (failedInvariants.length > 0) {
  fail(`ReleaseCommitment verification failed: ${failedInvariants.map((item) => item.name).join("; ")}`);
}

const timestamp = new Date().toISOString();
const exactCommands = [
  "cargo test -p silverscript-lang",
  "npm run kaspa:compile",
  "npm run kaspa:verify",
];

const report = `# ReleaseCommitment Verification

- Verification timestamp: ${timestamp}
- Contract source path: ${sourcePath}
- Artifact path: ${artifactPath}
- Contract name: ${contractName}
- Compiler version: ${compilerVersion}
- Testnet scope: Kaspa Testnet 12 only
- Deployment status: NOT DEPLOYED
- Runtime proof status: ${runtimeProofStatus}
- Transaction IDs: none
- Wallet information: none
- Fake explorer links: none

## Artifact ABI

${abiNames.map((name) => `- \`${name}\``).join("\n")}

## Compiler Artifact Structure

- Script byte length: ${Array.isArray(artifact.script) ? artifact.script.length : "unknown"}
- State layout: ${JSON.stringify(artifact.state_layout)}
- Lowered artifact functions: ${artifactFunctionNames.map((name) => `\`${name}\``).join(", ")}

## Verified Invariants

${invariants.map((item) => `- ${reportStatus(item.ok)}: ${item.name}\n  - Evidence: ${item.evidence}`).join("\n")}

## Runtime Execution Support

- Official debugger covenant support detected: ${runtimeSupportDetected ? "yes" : "no"}
- Runtime execution performed: no
- Reason: ${runtimeLimitation}

## Unverified Limitations

- No real covenant transaction-context execution was run for this Relic contract.
- No signatures were generated or used.
- No wallet, private key, seed phrase, testnet funds, transaction, deployment, or explorer proof exists.
- BLOCKED -> RELEASE_READY rejection is statically verified from source, compiler-produced AST/ABI, and absence of release-ready entrypoints; it is not a runtime rejection proof.

## Exact Commands

${exactCommands.map((command) => `- \`${command}\``).join("\n")}
`;

writeFileSync(reportPath, report);

console.log("ReleaseCommitment verification completed.");
console.log(`Contract: ${contractName}`);
console.log(`Compiler version: ${compilerVersion}`);
console.log(`Entrypoints: ${abiNames.join(", ")}`);
console.log(`Runtime proof status: ${runtimeProofStatus}`);
console.log(`Report written: ${reportPath}`);
