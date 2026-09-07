import test from "node:test";
import assert from "node:assert/strict";
import { verifyConfiguredVenusDeployment } from "./verifyDeployment.js";

test("requires deployment configuration before any network request", async () => {
  await assert.rejects(
    verifyConfiguredVenusDeployment({ CHAIN_ID: "97" }),
    /missing BSC_TESTNET_RPC_URL/,
  );
});
