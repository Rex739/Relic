interface StartupMemorySnapshot {
  arrayBuffers: number;
  deltaRss: number;
  external: number;
  heapTotal: number;
  heapUsed: number;
  maxRss: number;
  rss: number;
  stage: string;
}

interface StartupMemoryTelemetry {
  capture(stage: string): StartupMemorySnapshot;
  summary(): {
    largestRssIncrease: { bytes: number; stage: string };
    peakRss: number;
  };
}

const createStartupMemoryTelemetry = (): StartupMemoryTelemetry => {
  let previousRss = 0;
  let peakRss = 0;
  let largestRssIncrease = { bytes: 0, stage: "process-start" };
  return {
    capture(stage) {
      const { arrayBuffers, external, heapTotal, heapUsed, rss } =
        process.memoryUsage();
      const deltaRss = previousRss === 0 ? 0 : rss - previousRss;
      previousRss = rss;
      peakRss = Math.max(peakRss, rss);
      if (deltaRss > largestRssIncrease.bytes)
        largestRssIncrease = { bytes: deltaRss, stage };
      const snapshot = {
        stage,
        rss,
        heapUsed,
        heapTotal,
        external,
        arrayBuffers,
        deltaRss,
        maxRss: process.resourceUsage().maxRSS * 1024,
      };
      console.info(`[startup-memory] ${JSON.stringify(snapshot)}`);
      return snapshot;
    },
    summary: () => ({ largestRssIncrease, peakRss }),
  };
};

const telemetry = createStartupMemoryTelemetry();
telemetry.capture("process-start");

const fatal = (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
};

import("./runtime-bootstrap.js")
  .then(async ({ startReferenceService }) => {
    telemetry.capture("bootstrap-orchestrator:imported");
    await startReferenceService(telemetry);
  })
  .catch(fatal);
