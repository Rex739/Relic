import { verifyVenusDeployment } from "./deploymentVerifier.js";
import { loadVenusConfig } from "./networkConfig.js";
import { VenusJsonRpcClient } from "./venusRpcClient.js";

/**
 * Pre-deployment, read-only validation command.
 *
 * This is deliberately a separate command from the future executor: it uses
 * the exact environment Northflank will inject, performs no signing, and
 * exits non-zero if the configured market is not the real expected market.
 */
export async function verifyConfiguredVenusDeployment(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const config = loadVenusConfig(env);
  const deployment = await verifyVenusDeployment(
    new VenusJsonRpcClient(config.rpcUrl),
    config,
  );
  return JSON.stringify({
    status: "verified",
    chainId: deployment.chainId,
    token: deployment.usdtSymbol,
    decimals: deployment.usdtDecimals,
    withdrawableCashBaseUnits: deployment.withdrawableCashBaseUnits.toString(),
    verifiedAt: deployment.verifiedAt.toISOString(),
  });
}

if (process.argv[1]?.endsWith("verifyDeployment.js")) {
  verifyConfiguredVenusDeployment()
    .then((output) => console.log(output))
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : "Venus deployment verification failed",
      );
      process.exitCode = 1;
    });
}
