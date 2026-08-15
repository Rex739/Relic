import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { ERC8183Client, loadEnv } from "@bnbagent/sdk";
import {
  ERC8183Config,
  ERC8183JobOps,
  fundedJobWatcher,
  NegotiationHandler,
  parseJobDescription,
} from "@bnbagent/sdk/erc8183";
import { LocalStorageProvider } from "@bnbagent/sdk/storage";

import { analyzePosition } from "./analysis.js";
import { VenusCoreReader } from "./venus.js";

loadEnv(process.cwd());

const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

async function jsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Uint8Array);
    length += value.length;
    if (length > 64 * 1024) throw new Error("Request body exceeds 64 KiB");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function main() {
  if (!process.env.WALLET_PASSWORD)
    throw new Error(
      "WALLET_PASSWORD is required. The human operator must provide it locally; Relic will not invent or persist one.",
    );
  if (process.env.NETWORK !== "bsc-testnet")
    throw new Error("The reference seller is locked to NETWORK=bsc-testnet");
  if (process.env.ERC8183_SERVICE_PRICE !== "0")
    throw new Error(
      "The Phase 05 reference seller requires ERC8183_SERVICE_PRICE=0",
    );

  const storage = LocalStorageProvider.fromEnv();
  const config = new ERC8183Config({
    network: "bsc-testnet",
    privateKey: process.env.PRIVATE_KEY ?? "",
    walletPassword: process.env.WALLET_PASSWORD,
    walletAddress: process.env.WALLET_ADDRESS ?? "",
    walletsDir: process.env.WALLET_KEYSTORE_DIR ?? ".wallets",
    storage,
    servicePrice: "0",
    agentUrl: process.env.ERC8183_AGENT_URL ?? null,
  });
  if (config.walletProvider === null)
    throw new Error("Encrypted wallet unavailable");

  const client = await ERC8183Client.create({
    walletProvider: config.walletProvider,
    network: config.effectiveNetwork,
  });
  const jobOps = await ERC8183JobOps.create({
    walletProvider: config.walletProvider,
    network: config.effectiveNetwork,
    storageProvider: storage,
    servicePrice: 0n,
    agentUrl: config.agentUrl,
  });
  const negotiation = await NegotiationHandler.fromErc8183Client(client, {
    servicePrice: "0",
    walletProvider: config.walletProvider,
  });
  const paymentToken = await client.paymentToken();
  const stop = new AbortController();
  const reader = new VenusCoreReader();

  void fundedJobWatcher(
    jobOps,
    async (job) => {
      const rawDescription =
        typeof job.description === "string" ? job.description : "";
      const parsed = parseJobDescription(rawDescription);
      if (!parsed?.task)
        throw new Error("ERC-8183 description has no task payload");
      const input = JSON.parse(parsed.task) as unknown;
      const result = await analyzePosition(input, reader);
      const submission = await jobOps.submitResult(
        Number(job.jobId),
        JSON.stringify(result),
        {
          seller: "relic-health-factor-monitor",
          supplyType: "relic_reference",
          dataSource: result.source,
          observedBlock: result.observedBlock,
          readOnly: true,
        },
      );
      return submission.success ? undefined : { retry: submission.retryable };
    },
    {
      interval: Number(process.env.ERC8183_FUNDED_POLL_INTERVAL ?? "15"),
      stop: stop.signal,
    },
  );

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/erc8183/health")
        return send(response, 200, {
          status: "ok",
          service: "Relic health-factor monitor",
          supplyType: "relic_reference",
        });
      if (request.method === "GET" && url.pathname === "/erc8183/status")
        return send(response, 200, {
          status: "ok",
          agent_address: jobOps.agentAddress,
          commerce_address: config.effectiveCommerceAddress,
          router_address: config.effectiveRouterAddress,
          policy_address: config.effectivePolicyAddress,
          service_price: "0",
          currency: paymentToken,
          chain_id: 97,
          capability: "health-factor-monitoring",
          read_only: true,
        });
      if (request.method === "POST" && url.pathname === "/erc8183/negotiate") {
        const body = (await jsonBody(request)) as Record<string, unknown>;
        const result = await negotiation.negotiate(body);
        return send(response, 200, result.toDict());
      }
      const jobMatch = /^\/erc8183\/job\/(\d+)$/.exec(url.pathname);
      if (request.method === "GET" && jobMatch?.[1])
        return send(response, 200, await jobOps.getJob(Number(jobMatch[1])));
      const responseMatch = /^\/erc8183\/job\/(\d+)\/response$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && responseMatch?.[1])
        return send(
          response,
          200,
          await jobOps.getResponse(Number(responseMatch[1])),
        );
      return send(response, 404, { error: "not_found" });
    } catch (error) {
      console.error(
        `[health-factor-monitor] request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return send(response, 400, { error: "request_failed" });
    }
  });
  const shutdown = () => {
    stop.abort();
    server.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const port = Number(process.env.PORT ?? "8003");
  server.listen(port, "0.0.0.0", () => {
    console.info(
      `[health-factor-monitor] listening on :${port}; reference supply; zero-price; BSC testnet`,
    );
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
