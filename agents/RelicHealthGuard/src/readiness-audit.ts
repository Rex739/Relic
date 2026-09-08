import { loadHealthGuardConfig, type HealthGuardConfig, type HealthGuardPoolConfig } from "./config.js";

export type ReadinessAudit = Readonly<{
  ready: boolean;
  executionEnabled: boolean;
  checks: Readonly<Record<string, "pass" | "fail">>;
  detail?: string;
}>;

const requiredRuntimeKeys = [
  "PRIVATE_AGENT_BEARER_TOKEN",
  "RELIC_API_URL",
  "RELIC_HEALTH_GUARD_INTERNAL_TOKEN",
  "RELIC_HEALTH_GUARD_SESSION_TRANSFER_PRIVATE_KEY",
] as const;

/**
 * Read-only production readiness gate. It verifies the configured Mainnet
 * deployment but deliberately never starts a scheduler or signs a call.
 */
export async function auditHealthGuardReadiness(
  env: NodeJS.ProcessEnv,
  verifyDeployment: (config: HealthGuardConfig, pool: HealthGuardPoolConfig) => Promise<void>,
): Promise<ReadinessAudit> {
  const checks: Record<string, "pass" | "fail"> = {};
  let config: HealthGuardConfig;
  try {
    config = loadHealthGuardConfig(env);
    checks.mainnetConfiguration = "pass";
  } catch (error) {
    checks.mainnetConfiguration = "fail";
    return { ready: false, executionEnabled: false, checks, detail: error instanceof Error ? error.message : "Mainnet configuration is invalid" };
  }
  for (const key of requiredRuntimeKeys) checks[key] = env[key]?.trim() ? "pass" : "fail";
  const apiUrl = env.RELIC_API_URL?.trim();
  if (apiUrl && !/^https:\/\//u.test(apiUrl)) checks.RELIC_API_URL = "fail";
  const transferKey = env.RELIC_HEALTH_GUARD_SESSION_TRANSFER_PRIVATE_KEY;
  if (transferKey && !/BEGIN (?:RSA |EC )?PRIVATE KEY/u.test(transferKey))
    checks.RELIC_HEALTH_GUARD_SESSION_TRANSFER_PRIVATE_KEY = "fail";
  try {
    await Promise.all([...config.pools.values()].map((pool) => verifyDeployment(config, pool)));
    checks.venusDeployment = "pass";
  } catch (error) {
    checks.venusDeployment = "fail";
    return { ready: false, executionEnabled: config.executionEnabled, checks, detail: error instanceof Error ? error.message : "Venus deployment verification failed" };
  }
  const ready = Object.values(checks).every((value) => value === "pass");
  return { ready, executionEnabled: config.executionEnabled, checks, ...(ready ? {} : { detail: "One or more private-runtime credentials are missing or invalid" }) };
}
