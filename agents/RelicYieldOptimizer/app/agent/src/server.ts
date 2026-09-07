import { createServer } from "node:http";
import { FundedSessionClient } from "./fundedSessionClient.js";
import { loadVenusTestnetConfig } from "./networkConfig.js";
import { PerJobAltanaSigner } from "./perJobAltanaSigner.js";
import { YieldPrivateExecutor } from "./privateExecutor.js";
import { privateRuntimeHandler } from "./privateRuntime.js";
import { RelicExecutionJobStore } from "./relicExecutionJobStore.js";
import { VenusOnchainExecutionReader } from "./venusExecutionReader.js";
import { VenusJsonRpcClient } from "./venusRpcClient.js";

const port = Number(process.env.PORT ?? "9000");
const bearerToken = process.env.PRIVATE_AGENT_BEARER_TOKEN?.trim();
if (!bearerToken) throw new Error("PRIVATE_AGENT_BEARER_TOKEN is required");

const config = loadVenusTestnetConfig();
const apiUrl = process.env.RELIC_API_URL?.trim();
const internalToken = process.env.RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN?.trim();
const transferPrivateKey = process.env.RELIC_YIELD_SESSION_TRANSFER_PRIVATE_KEY?.trim();
if (!apiUrl || !internalToken || !transferPrivateKey)
  throw new Error("RELIC_API_URL, RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN, and RELIC_YIELD_SESSION_TRANSFER_PRIVATE_KEY are required");
const venus = new VenusJsonRpcClient(config.rpcUrl);
const sessions = new FundedSessionClient({ apiUrl, bearerToken: internalToken, executorPrivateKeyPem: transferPrivateKey });
const store = new RelicExecutionJobStore({ apiUrl, bearerToken: internalToken });
const executor = new YieldPrivateExecutor(config, venus, async (request) => {
  const released = await sessions.release(request.commerceJobId);
  if (released.commerceJobId !== request.commerceJobId || released.mandateId.length === 0)
    throw new Error("Yield signing denied: Relic released a mismatched funded session");
  if (released.walletAddress.toLowerCase() !== request.mandate.account.toLowerCase())
    throw new Error("Yield signing denied: canonical mandate account differs from the funded session owner");
  if (request.mandate.expiresAt > released.expiresAt)
    throw new Error("Yield signing denied: canonical mandate outlives the funded session");
  return {
    signer: new PerJobAltanaSigner(config, released),
    reader: new VenusOnchainExecutionReader(config, venus),
    store,
  };
});

createServer(privateRuntimeHandler(executor, bearerToken)).listen(port, "0.0.0.0", () =>
  console.info(`Relic Yield Optimizer private executor listening on ${String(port)}`),
);
