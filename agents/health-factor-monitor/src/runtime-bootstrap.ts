import type { IncomingMessage, ServerResponse } from "node:http";
import type { getAddress } from "viem";

interface StartupMemoryTelemetry {
  capture(stage: string): { maxRss: number; rss: number };
  summary(): {
    largestRssIncrease: { bytes: number; stage: string };
    peakRss: number;
  };
}

interface StartedRuntime {
  close(): Promise<void>;
}

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

const fatalShutdown = (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
};

export async function startReferenceService(telemetry: StartupMemoryTelemetry) {
  const { loadLocalEnvironment } = await import("./local-env.js");
  telemetry.capture("environment/config:imported");
  const loadedEnvironmentFiles = loadLocalEnvironment(process.cwd());
  console.info(
    `[reference-runtime] environment sources loaded=${loadedEnvironmentFiles.length}`,
  );
  const { parseReferenceRuntimeEnvironment } =
    await import("./runtime-environment.js");
  const environment = parseReferenceRuntimeEnvironment(process.env);
  telemetry.capture("environment/config:initialized");

  const viem = (await import("viem")) as {
    getAddress: typeof getAddress;
  };
  const walletAddress = viem.getAddress(environment.walletAddress);
  telemetry.capture("viem/rpc:imported");

  const { PostgresArtifactStorage } = await import("./postgres-storage.js");
  const { normalizeDeliveryContent } = await import("./delivery-content.js");
  telemetry.capture("database/postgres:imported");
  const storage = new PostgresArtifactStorage(
    environment.databaseUrl,
    "health-factor-monitor",
  );
  let startupComplete = false;
  let runtime: StartedRuntime | undefined;
  try {
    await storage.verify();
    telemetry.capture("database/postgres:initialized");

    const { verifyInjectedKeystore } = await import("./wallet-keystore.js");
    telemetry.capture("wallet/keystore:imported");
    verifyInjectedKeystore(walletAddress, environment.keystoreDirectory);
    telemetry.capture("wallet/keystore:validated");

    const sdk = await import("@bnbagent/sdk/erc8183");
    telemetry.capture("bnb-agent-sdk/erc8183:imported");

    const config = new sdk.ERC8183Config({
      network: "bsc-testnet",
      walletPassword: environment.walletPassword,
      walletAddress,
      walletsDir: environment.keystoreDirectory,
      storage,
      servicePrice: environment.servicePrice,
      agentUrl: environment.agentUrl,
    });
    if (config.walletProvider === null)
      throw new Error("Encrypted wallet unavailable");
    telemetry.capture("wallet/keystore:decrypted");

    const client = await sdk.ERC8183Client.create({
      walletProvider: config.walletProvider,
      network: config.effectiveNetwork,
    });
    const jobOps = await sdk.ERC8183JobOps.create({
      walletProvider: config.walletProvider,
      network: config.effectiveNetwork,
      storageProvider: storage,
      servicePrice: BigInt(environment.servicePrice),
      agentUrl: config.agentUrl,
    });
    const negotiation = await sdk.NegotiationHandler.fromErc8183Client(client, {
      servicePrice: environment.servicePrice,
      walletProvider: config.walletProvider,
      quoteTtlSeconds: environment.signedQuoteTtlSeconds,
    });
    const paymentToken = await client.paymentToken();
    telemetry.capture("bnb-agent-sdk/erc8183:initialized");

    const { startReferenceRuntime } = await import("./runtime-host.js");
    telemetry.capture("http-runtime:imported");
    let agentReady = false;
    const healthFactorAgent = {
      slug: "health-factor-monitor",
      ready: () => agentReady,
      close: async () => {
        agentReady = false;
        await storage.close();
      },
      handle: async (
        request: IncomingMessage,
        response: ServerResponse,
        url: URL,
      ) => {
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
            service_price: environment.servicePrice,
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
        const jobMatch = /^\/erc8183\/job\/(\d+)$/u.exec(url.pathname);
        if (request.method === "GET" && jobMatch?.[1]) {
          send(response, 200, await jobOps.getJob(Number(jobMatch[1])));
          return true;
        }
        const responseMatch = /^\/erc8183\/job\/(\d+)\/response$/u.exec(
          url.pathname,
        );
        if (request.method === "GET" && responseMatch?.[1]) {
          const jobId = Number(responseMatch[1]);
          const persisted = normalizeDeliveryContent(
            await storage.download(`erc8183-job-${jobId}.json`),
          );
          send(response, 200, { success: true, ...persisted });
          return true;
        }
        return false;
      },
    };
    runtime = await startReferenceRuntime(environment.port, [
      healthFactorAgent,
    ]);
    telemetry.capture("http-runtime:initialized");

    // The reference runtime deliberately has no autonomous blockchain-write
    // loop. Provider execution and delivery preparation are orchestrated by
    // Relic's durable commerce operation path, which records signer role,
    // idempotency, prepared calldata, and the returned transaction hash.
    agentReady = true;
    telemetry.capture("funded-job-polling:disabled-no-signing-authority");

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.info(`[reference-runtime] received ${signal}; shutting down`);
      await runtime?.close();
    };
    process.once("SIGINT", () => void shutdown("SIGINT").catch(fatalShutdown));
    process.once(
      "SIGTERM",
      () => void shutdown("SIGTERM").catch(fatalShutdown),
    );
    const finalSnapshot = telemetry.capture("startup-complete");
    const summary = telemetry.summary();
    console.info(
      `[startup-memory-summary] ${JSON.stringify({
        currentRss: finalSnapshot.rss,
        peakRss: Math.max(summary.peakRss, finalSnapshot.maxRss),
        largestRssIncrease: summary.largestRssIncrease,
      })}`,
    );
    console.info(
      `[reference-runtime] listening on 0.0.0.0:${environment.port}; agents=health-factor-monitor; price=${environment.servicePrice}; BSC testnet`,
    );
    setTimeout(() => telemetry.capture("steady-state:5s"), 5_000).unref();
    setTimeout(() => telemetry.capture("steady-state:30s"), 30_000).unref();
    startupComplete = true;
  } finally {
    if (!startupComplete) {
      await runtime?.close();
      if (!runtime) await storage.close();
    }
  }
}
