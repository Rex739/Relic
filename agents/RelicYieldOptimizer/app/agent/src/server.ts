import { createServer } from "node:http";
import { resolve } from "node:path";
import { ensureAltanaSessionLoaded } from "@bnbagent/studio-runtime/wallet";
import { materializeAltanaSession } from "./altanaSession.js";
import { loadVenusTestnetConfig } from "./networkConfig.js";
import { YieldPrivateExecutor } from "./privateExecutor.js";
import { privateRuntimeHandler } from "./privateRuntime.js";
import { VenusJsonRpcClient } from "./venusRpcClient.js";

const port = Number(process.env.PORT ?? "9000");
const bearerToken = process.env.PRIVATE_AGENT_BEARER_TOKEN?.trim();
if (!bearerToken) throw new Error("PRIVATE_AGENT_BEARER_TOKEN is required");
materializeAltanaSession(
  process.env.ALTANA_SESSION,
  resolve(process.cwd(), ".studio/wallets/altana-session.json"),
);
await ensureAltanaSessionLoaded();

const config = loadVenusTestnetConfig();
const executor = new YieldPrivateExecutor(config, new VenusJsonRpcClient(config.rpcUrl));

createServer(privateRuntimeHandler(executor, bearerToken)).listen(port, "0.0.0.0", () =>
  console.info(`Relic Yield Optimizer private executor listening on ${String(port)}`),
);
