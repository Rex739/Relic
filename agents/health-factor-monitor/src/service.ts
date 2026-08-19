import type { IncomingMessage, ServerResponse } from "node:http";

import { EVMWalletProvider, ERC8183Client, loadEnv } from "@bnbagent/sdk";
import {
  ERC8183Config,
  ERC8183JobOps,
  fundedJobWatcher,
  NegotiationHandler,
  parseJobDescription,
} from "@bnbagent/sdk/erc8183";

import { analyzePosition } from "./analysis.js";
import { PostgresArtifactStorage } from "./postgres-storage.js";
import { parseReferenceRuntimeEnvironment } from "./runtime-environment.js";
import {
  type ReferenceAgentMount,
  startReferenceRuntime,
} from "./runtime-host.js";
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
  const environment = parseReferenceRuntimeEnvironment(process.env);
  if (
    !EVMWalletProvider.keystoreExists(
      environment.walletAddress,
      environment.keystoreDirectory,
    )
  )
    throw new Error(
      `Encrypted keystore for WALLET_ADDRESS is missing from WALLET_KEYSTORE_DIR; refusing SDK wallet auto-creation`,
    );

  const storage = new PostgresArtifactStorage(
    environment.databaseUrl,
    "health-factor-monitor",
  );
  let startupComplete = false;
  let startupStop: AbortController | undefined;
  let startupWatcher: Promise<void> | undefined;
  try {
    await storage.verify();
    const config = new ERC8183Config({
      network: "bsc-testnet",
      walletPassword: environment.walletPassword,
      walletAddress: environment.walletAddress,
      walletsDir: environment.keystoreDirectory,
      storage,
      servicePrice: "0",
      agentUrl: environment.agentUrl,
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
    startupStop = stop;
    const reader = new VenusCoreReader();

    const watcher = fundedJobWatcher(
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
        interval: environment.fundedPollInterval,
        stop: stop.signal,
      },
    );
    startupWatcher = watcher;

    let agentReady = true;
    const healthFactorAgent: ReferenceAgentMount = {
      slug: "health-factor-monitor",
      ready: () => agentReady,
      close: async () => {
        agentReady = false;
        stop.abort();
        await watcher;
        await storage.close();
      },
      handle: async (request, response, url) => {
        if (request.method === "GET" && url.pathname === "/erc8183/health") {
          send(response, 200, {
            status: "ok",
            service: "Relic health-factor monitor",
            supplyType: "relic_reference",
          });
          return true;
        }
        if (request.method === "GET" && url.pathname === "/erc8183/status") {
          send(response, 200, {
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
          return true;
        }
        if (
          request.method === "POST" &&
          url.pathname === "/erc8183/negotiate"
        ) {
          const body = (await jsonBody(request)) as Record<string, unknown>;
          const result = await negotiation.negotiate(body);
          send(response, 200, result.toDict());
          return true;
        }
        const jobMatch = /^\/erc8183\/job\/(\d+)$/.exec(url.pathname);
        if (request.method === "GET" && jobMatch?.[1]) {
          send(response, 200, await jobOps.getJob(Number(jobMatch[1])));
          return true;
        }
        const responseMatch = /^\/erc8183\/job\/(\d+)\/response$/.exec(
          url.pathname,
        );
        if (request.method === "GET" && responseMatch?.[1]) {
          const jobId = Number(responseMatch[1]);
          const cached = await jobOps.getResponse(jobId);
          if (cached.success) send(response, 200, cached);
          else
            send(response, 200, {
              success: true,
              ...(await storage.download(`erc8183-job-${jobId}.json`)),
            });
          return true;
        }
        return false;
      },
    };
    const runtime = await startReferenceRuntime(environment.port, [
      healthFactorAgent,
    ]);
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.info(`[reference-runtime] received ${signal}; shutting down`);
      await runtime.close();
    };
    process.once("SIGINT", () => void shutdown("SIGINT").catch(fatalShutdown));
    process.once(
      "SIGTERM",
      () => void shutdown("SIGTERM").catch(fatalShutdown),
    );
    console.info(
      `[reference-runtime] listening on 0.0.0.0:${environment.port}; agents=health-factor-monitor; zero-price; BSC testnet`,
    );
    startupComplete = true;
  } finally {
    if (!startupComplete) {
      startupStop?.abort();
      await startupWatcher;
      await storage.close();
    }
  }
}

const fatalShutdown = (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
