import { Scan8004Provider } from "@relic/blockchain";

import { deriveScanAgent } from "./corpus-bootstrap.js";

const count = 10_000;
const registryAddress = `0x${"8".repeat(40)}`;
const rawAgents = Array.from({ length: count }, (_, index) => ({
  id: `cpu-${index + 1}`,
  token_id: String(index + 1),
  chain_id: 56,
  contract_address: registryAddress,
  owner_address: `0x${(index + 1).toString(16).padStart(40, "0")}`,
  name: `Health factor fixture ${index + 1}`,
  description:
    "A deterministic benchmark fixture for health factor monitoring and alerting.",
  supported_protocols: ["A2A"],
  total_feedbacks: 0,
  raw_metadata: {
    services: [
      {
        name: "A2A",
        endpoint: `https://fixture.invalid/${index + 1}`,
      },
    ],
    capabilities: ["health-factor-monitoring"],
  },
}));
const serialized = JSON.stringify({ data: rawAgents });
const rssBefore = process.memoryUsage().rss;
const jsonStartedAt = performance.now();
const parsed = JSON.parse(serialized) as { data: unknown[] };
const jsonParseMs = performance.now() - jsonStartedAt;
const parser = new Scan8004Provider({
  fetch: () => {
    throw new Error("CPU benchmark must not make network requests");
  },
});
const normalizationStartedAt = performance.now();
const normalized = parsed.data.map((record) => parser.parseAgent(record));
const normalizationMs = performance.now() - normalizationStartedAt;
const enrichmentStartedAt = performance.now();
const derived = normalized.map(deriveScanAgent);
const enrichmentDerivationMs = performance.now() - enrichmentStartedAt;
const rssAfter = process.memoryUsage().rss;

console.info(
  JSON.stringify({
    fixtureOnly: true,
    networkRequests: 0,
    agents: count,
    serializedBytes: Buffer.byteLength(serialized),
    jsonParseMs,
    normalizationMs,
    enrichmentDerivationMs,
    derivedServices: derived.reduce(
      (total, record) => total + record.services.length,
      0,
    ),
    derivedClassifications: derived.reduce(
      (total, record) => total + record.classifications.length,
      0,
    ),
    peakRssDeltaBytes: rssAfter - rssBefore,
  }),
);
