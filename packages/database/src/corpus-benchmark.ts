import { readFile, readdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import type { ScanAgent } from "@relic/blockchain";
import { drizzle } from "drizzle-orm/pglite";

import type { RelicDatabase } from "./client.js";
import { DrizzleCorpusStore, type CorpusDerivedData } from "./corpus.js";
import * as schema from "./schema.js";

const registryAddress = `0x${"8".repeat(40)}`;
const ownerAddress = (index: number) =>
  `0x${index.toString(16).padStart(40, "0")}`;

const fixture = (index: number): ScanAgent => ({
  id: `benchmark-${index}`,
  token_id: String(index),
  chain_id: 56,
  contract_address: registryAddress,
  owner_address: ownerAddress(index),
  name: `Health factor fixture ${index}`,
  description:
    "A deterministic benchmark fixture for health factor monitoring and alerting.",
  image_url: null,
  supported_protocols: ["A2A"],
  x402_supported: false,
  is_verified: false,
  star_count: 0,
  total_feedbacks: 0,
  average_score: null,
  total_score: null,
  health_score: null,
  created_at: "2026-08-20T00:00:00.000Z",
  created_block_number: null,
  created_tx_hash: null,
  updated_at: "2026-08-20T00:00:00.000Z",
  raw_metadata: {
    services: [{ name: "A2A", endpoint: `https://fixture.invalid/${index}` }],
    capabilities: ["health-factor-monitoring"],
  },
});

const derived: CorpusDerivedData = {
  services: [
    {
      rawName: "A2A",
      normalizedType: "a2a",
      endpoint: "https://fixture.invalid",
      malformed: false,
      raw: { benchmark: true },
    },
  ],
  capabilities: ["health-factor-monitoring"],
  classifications: [
    {
      categorySlug: "health-factor-monitoring",
      confidence: "high",
      evidenceType: "structured_declaration",
      matchedSource: "raw_metadata.capabilities",
      matchedValue: "health-factor-monitoring",
    },
  ],
  quality: {
    completenessPercent: 50,
    readiness: "DISCOVERABLE",
    facts: {
      hasName: true,
      hasMeaningfulDescription: true,
      hasImage: false,
      hasMetadataUri: false,
      metadataResolves: false,
      hasServiceDeclaration: true,
      hasEndpoint: true,
      hasCapabilityData: true,
      hasSupportedProtocols: true,
      hasSupportedAssets: false,
      hasPricingInformation: false,
      hasReputationEvidence: false,
      hasRecentMetadata: true,
      hasVerifiableOwner: false,
      hasUsableMachineInterface: true,
      hasMarketplaceCategoryEvidence: true,
    },
    ruleVersion: "bsc-corpus-v2",
  },
  priority: 70,
};

async function databaseSize(database: PGlite): Promise<number> {
  const result = await database.query<{ bytes: number | bigint }>(
    "select pg_database_size(current_database()) bytes",
  );
  return Number(result.rows[0]?.bytes ?? 0);
}

async function createBenchmarkDatabase() {
  const database = new PGlite();
  const migrationDirectory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(migrationDirectory))
    .filter(
      (name) =>
        /^\d{4}_.+\.sql$/.test(name) &&
        !name.startsWith("0008_secure_public_schema"),
    )
    .sort();
  for (const name of names)
    await database.exec(
      await readFile(new URL(name, migrationDirectory), "utf8"),
    );
  const relational = drizzle(database, { schema });
  return {
    database,
    store: new DrizzleCorpusStore(
      relational as unknown as RelicDatabase,
      "8004scan-benchmark",
    ),
  };
}

async function runDiscoveryBenchmark(count: number) {
  const { database, store } = await createBenchmarkDatabase();
  const fetchedAt = new Date("2026-08-20T00:00:00.000Z");
  const sizeBefore = await databaseSize(database);
  const rssBefore = process.memoryUsage().rss;
  let statements = 0;
  let transactions = 0;
  let peakRss = process.memoryUsage().rss;
  const startedAt = performance.now();
  for (let offset = 0; offset < count; offset += 100) {
    const records = Array.from(
      { length: Math.min(100, count - offset) },
      (_, index) => {
        const agent = fixture(offset + index + 1);
        return { agent, raw: agent, fetchedAt };
      },
    );
    const result = await store.persistDiscoveryPage({ records, malformed: [] });
    statements += result.statements;
    transactions += result.transactionCount;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const durationMs = performance.now() - startedAt;
  const sizeAfter = await databaseSize(database);
  await database.close();
  return {
    agents: count,
    durationMs,
    agentsPerSecond: count / (durationMs / 1_000),
    statements,
    transactions,
    statementsPer100Agents: (statements / count) * 100,
    transactionProtocolRoundTripsPer100Agents:
      ((transactions * 2) / count) * 100,
    bytesPer1000Agents: ((sizeAfter - sizeBefore) / count) * 1_000,
    peakRssBytes: peakRss,
    peakRssDeltaBytes: peakRss - rssBefore,
  };
}

async function runEnrichmentBenchmark(count: number) {
  const { database, store } = await createBenchmarkDatabase();
  const fetchedAt = new Date("2026-08-20T00:00:00.000Z");
  for (let offset = 0; offset < count; offset += 100) {
    const records = Array.from(
      { length: Math.min(100, count - offset) },
      (_, index) => {
        const agent = fixture(offset + index + 1);
        return { agent, raw: agent, fetchedAt };
      },
    );
    await store.persistDiscoveryPage({ records, malformed: [] });
  }
  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  let statements = 0;
  const startedAt = performance.now();
  for (let offset = 0; offset < count; offset += 100) {
    const records = Array.from(
      { length: Math.min(100, count - offset) },
      (_, index) => ({
        agent: fixture(offset + index + 1),
        derived,
        fetchedAt,
      }),
    );
    const result = await store.persistEnrichmentBatch(records);
    statements += result.statements;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const durationMs = performance.now() - startedAt;
  await database.close();
  return {
    agents: count,
    durationMs,
    agentsPerSecond: count / (durationMs / 1_000),
    statements,
    statementsPer100Agents: (statements / count) * 100,
    peakRssDeltaBytes: peakRss - rssBefore,
  };
}

async function runLegacySample(count: number) {
  const { database, store } = await createBenchmarkDatabase();
  const fetchedAt = new Date("2026-08-20T00:00:00.000Z");
  const startedAt = performance.now();
  for (let index = 1; index <= count; index += 1) {
    const agent = fixture(index);
    await store.persistAgent({ agent, raw: agent, fetchedAt, derived });
  }
  const durationMs = performance.now() - startedAt;
  const peakRssBytes = process.memoryUsage().rss;
  await database.close();
  return {
    agents: count,
    durationMs,
    agentsPerSecond: count / (durationMs / 1_000),
    peakRssBytes,
  };
}

const legacy = await runLegacySample(100);
const discovery1000 = await runDiscoveryBenchmark(1_000);
const discovery10000 = await runDiscoveryBenchmark(10_000);
const enrichment1000 = await runEnrichmentBenchmark(1_000);
console.info(
  JSON.stringify({
    fixtureOnly: true,
    networkRequests: 0,
    pageSize: 100,
    legacy,
    discovery1000,
    discovery10000,
    enrichment1000,
  }),
);
