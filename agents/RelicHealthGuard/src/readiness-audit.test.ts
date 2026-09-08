import assert from "node:assert/strict";
import test from "node:test";
import { auditHealthGuardReadiness } from "./readiness-audit.js";

const environment = {
  CHAIN_ID: "56", BSC_MAINNET_RPC_URL: "https://rpc.example",
  VENUS_USDT: "0x0000000000000000000000000000000000000001",
  VENUS_USDT_VTOKEN: "0x0000000000000000000000000000000000000002",
  VENUS_COMPTROLLER: "0x0000000000000000000000000000000000000003",
  USDT_DECIMALS: "6", MAX_REPAY_BASE_UNITS: "1000000", MINIMUM_BNB_GAS_RESERVE_WEI: "1",
  PRIVATE_AGENT_BEARER_TOKEN: "token", RELIC_API_URL: "https://api.example", RELIC_HEALTH_GUARD_INTERNAL_TOKEN: "token",
  RELIC_HEALTH_GUARD_SESSION_TRANSFER_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----",
} as NodeJS.ProcessEnv;

test("readiness audit verifies the configured deployment without enabling execution", async () => {
  const result = await auditHealthGuardReadiness(environment, async () => undefined);
  assert.equal(result.ready, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.checks.venusDeployment, "pass");
});

test("readiness audit fails closed when deployment verification fails", async () => {
  const result = await auditHealthGuardReadiness(environment, async () => { throw new Error("wrong vToken underlying"); });
  assert.equal(result.ready, false);
  assert.equal(result.checks.venusDeployment, "fail");
});
