import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [coralApiUrl, authKey, relicApiBaseUrl, relicWorkspaceUrl, relicReviewRequest] = process.argv.slice(2);

if (!coralApiUrl || !authKey || !relicApiBaseUrl || !relicWorkspaceUrl || !relicReviewRequest) {
  throw new Error("Missing Coral demo arguments.");
}

const sessionRequest = {
  agentGraphRequest: {
    agents: [
      {
        id: { name: "relic-review-governor", version: "0.1.0", registrySourceId: { type: "local" } },
        name: "relic-review-governor",
        options: {
          RELIC_REVIEW_REQUEST: { type: "string", value: relicReviewRequest },
          RELIC_WORKSPACE_URL: { type: "string", value: relicWorkspaceUrl },
        },
        provider: { type: "local", runtime: "executable" },
        blocking: true,
      },
      {
        id: { name: "relic-verification-bridge", version: "0.1.0", registrySourceId: { type: "local" } },
        name: "relic-verification-bridge",
        options: {
          RELIC_API_BASE_URL: { type: "string", value: relicApiBaseUrl },
          RELIC_WORKSPACE_URL: { type: "string", value: relicWorkspaceUrl },
        },
        provider: { type: "local", runtime: "executable" },
        blocking: true,
      },
      {
        id: { name: "relic-release-policy-guard", version: "0.1.0", registrySourceId: { type: "local" } },
        name: "relic-release-policy-guard",
        options: {},
        provider: { type: "local", runtime: "executable" },
        blocking: true,
      },
    ],
    groups: [["relic-review-governor", "relic-verification-bridge", "relic-release-policy-guard"]],
    customTools: {},
  },
  namespaceProvider: {
    type: "create_if_not_exists",
    namespaceRequest: {
      name: "relic-meridian-governance",
      deleteOnLastSessionExit: false,
      annotations: {
        app: "relic",
        demo: "meridian-grid-governance",
      },
    },
  },
  execution: {
    mode: "immediate",
    runtimeSettings: {
      ttl: 300000,
      extendedEndReport: true,
      persistenceMode: { mode: "hold_after_exit", duration: 600000 },
    },
  },
  annotations: {
    "relic.demo": "meridian-governance",
  },
};

const response = await fetch(new URL("/api/v1/local/session", coralApiUrl), {
  method: "POST",
  headers: {
    Authorization: `Bearer ${authKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(sessionRequest),
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Coral session creation failed with HTTP ${response.status}: ${body}`);
}

const result = await response.json();
console.log(`Session ID: ${result.sessionId}`);
console.log(`Namespace: ${result.namespace}`);
console.log(`Coral Console: ${new URL("/ui/console", coralApiUrl).toString()}`);
console.log("Inspect thread messages in Coral Console, or run:");
console.log(`  CORAL_AUTH_KEY=*** coral/scripts/inspectGovernanceRun.sh ${result.sessionId}`);

const report = await waitForPolicyReport({
  coralApiUrl,
  authKey,
  namespace: result.namespace,
  sessionId: result.sessionId,
});
const policyMessage = findPolicyMessage(report);

if (!policyMessage) {
  console.log("Run created. Final governance result was not available before the local wait timeout.");
  process.exitCode = 2;
} else {
  const policy = JSON.parse(policyMessage.text).policy;
  console.log(`Run completed: ${report.base?.status?.type ?? "unknown"}`);
  console.log(`Final deterministic governance result: ${policy.result}`);
  console.log(`Release ready: ${String(policy.releaseReady)}`);
  console.log(`Policy message: ${policy.message}`);
  const artifactPath = await writeRealSessionArtifact(result.sessionId, report);
  console.log(`Real Coral session artifact: ${artifactPath}`);
}

async function waitForPolicyReport({ coralApiUrl, authKey, namespace, sessionId }) {
  const url = new URL(`/api/v1/local/session/${namespace}/${sessionId}/extended`, coralApiUrl);
  let lastReport = null;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const inspectResponse = await fetch(url, {
      headers: {
        Authorization: `Bearer ${authKey}`,
      },
    });

    if (inspectResponse.ok) {
      lastReport = await inspectResponse.json();
      if (findPolicyMessage(lastReport)) {
        return lastReport;
      }
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }

  return lastReport;
}

function findPolicyMessage(report) {
  return report?.threads
    ?.flatMap((thread) => thread.messages ?? [])
    .find((message) => message.text?.includes("\"GOVERNANCE_POLICY_RESULT\""));
}

async function writeRealSessionArtifact(sessionId, report) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const artifactDir = resolve(scriptDir, "../artifacts");
  const artifactPath = resolve(artifactDir, `coral-session-${sessionId}.json`);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return artifactPath;
}
