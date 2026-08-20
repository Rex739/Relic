import type { IncomingMessage, ServerResponse } from "node:http";

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

  const { getAddress } = await import("viem");
  const walletAddress = getAddress(environment.walletAddress);
  telemetry.capture("viem/rpc:imported");

  const { PostgresArtifactStorage } = await import("./postgres-storage.js");
  telemetry.capture("database/postgres:imported");
  const storage = new PostgresArtifactStorage(
    environment.databaseUrl,
    "health-factor-monitor",
  );
  let startupComplete = false;
  let startupStop: AbortController | undefined;
  let startupWatcher: Promise<void> | undefined;
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
      servicePrice: "0",
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
      servicePrice: 0n,
      agentUrl: config.agentUrl,
    });
    const negotiation = await sdk.NegotiationHandler.fromErc8183Client(client, {
      servicePrice: "0",
      walletProvider: config.walletProvider,
    });
    const paymentToken = await client.paymentToken();
    telemetry.capture("bnb-agent-sdk/erc8183:initialized");

    const { VenusCoreReader } = await import("./venus.js");
    const reader = new VenusCoreReader();
    telemetry.capture("venus:imported-and-initialized");

    const { startReferenceRuntime } = await import("./runtime-host.js");
    telemetry.capture("http-runtime:imported");
    const stop = new AbortController();
    startupStop = stop;
    let agentReady = false;
    const healthFactorAgent = {
      slug: "health-factor-monitor",
      ready: () => agentReady,
      close: async () => {
        agentReady = false;
        stop.abort();
        await startupWatcher;
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
    runtime = await startReferenceRuntime(environment.port, [
      healthFactorAgent,
    ]);
    telemetry.capture("http-runtime:initialized");

    let analysisModulePromise:
      ReturnType<typeof importAnalysisModule> | undefined;
    const loadAnalysisModule = async () => {
      const firstLoad = analysisModulePromise === undefined;
      analysisModulePromise ??= importAnalysisModule();
      const module = await analysisModulePromise;
      if (firstLoad) telemetry.capture("funded-job-analysis:imported");
      return module;
    };
    startupWatcher = sdk.fundedJobWatcher(
      jobOps,
      async (job) => {
        const { analyzePosition } = await loadAnalysisModule();
        const rawDescription =
          typeof job.description === "string" ? job.description : "";
        const parsed = sdk.parseJobDescription(rawDescription);
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
    await new Promise<void>((resolve) => setImmediate(resolve));
    agentReady = true;
    telemetry.capture("funded-job-polling:initialized");

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
      `[reference-runtime] listening on 0.0.0.0:${environment.port}; agents=health-factor-monitor; zero-price; BSC testnet`,
    );
    setTimeout(() => telemetry.capture("steady-state:5s"), 5_000).unref();
    setTimeout(() => telemetry.capture("steady-state:30s"), 30_000).unref();
    startupComplete = true;
  } finally {
    if (!startupComplete) {
      startupStop?.abort();
      await startupWatcher;
      await runtime?.close();
      if (!runtime) await storage.close();
    }
  }
}

const importAnalysisModule = () => import("./analysis.js");
