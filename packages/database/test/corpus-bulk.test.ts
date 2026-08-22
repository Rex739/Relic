import { readFile, readdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import type { ScanAgent } from "@relic/blockchain";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RelicDatabase } from "../src/client.js";
import { DrizzleCorpusStore } from "../src/corpus.js";
import * as schema from "../src/schema.js";

const registryAddress = `0x${"8".repeat(40)}`;
let database: PGlite;
let store: DrizzleCorpusStore;

const fixture = (index: number): ScanAgent => ({
  id: `bulk-${index}`,
  token_id: String(index),
  chain_id: 56,
  contract_address: registryAddress,
  owner_address: `0x${index.toString(16).padStart(40, "0")}`,
  name: `Bulk fixture ${index}`,
  supported_protocols: ["A2A"],
});

beforeEach(async () => {
  database = new PGlite();
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory))
    .filter(
      (name) =>
        /^\d{4}_.+\.sql$/.test(name) &&
        !name.startsWith("0008_secure_public_schema"),
    )
    .sort();
  for (const name of names) {
    let migration = await readFile(new URL(name, directory), "utf8");
    if (name.startsWith("0011_"))
      migration = migration.split(
        "-- Mandates are server-side authorization records",
      )[0]!;
    if (name.startsWith("0012_"))
      migration = migration.split(
        "-- Execution control is server-side policy state",
      )[0]!;
    if (name.startsWith("0013_"))
      migration = migration.split(
        "-- Commerce and wallet-session state is server-side only",
      )[0]!;
    if (name.startsWith("0014_"))
      migration = migration.split(
        "ALTER TABLE public.authorization_challenges ENABLE ROW LEVEL SECURITY",
      )[0]!;
    await database.exec(migration);
  }
  store = new DrizzleCorpusStore(
    drizzle(database, { schema }) as unknown as RelicDatabase,
  );
});

afterEach(() => database.close());

describe("bulk corpus discovery persistence", () => {
  it("persists and idempotently replays a 100-agent page in four statements", async () => {
    const fetchedAt = new Date("2026-08-20T00:00:00.000Z");
    const records = Array.from({ length: 100 }, (_, index) => {
      const agent = fixture(index + 1);
      return { agent, raw: agent, fetchedAt };
    });
    const first = await store.persistDiscoveryPage({ records, malformed: [] });
    const replay = await store.persistDiscoveryPage({ records, malformed: [] });
    expect(first).toMatchObject({
      persisted: 100,
      malformed: 0,
      statements: 4,
      transactionCount: 1,
    });
    expect(replay).toMatchObject({ persisted: 100, statements: 4 });
    const counts = await database.query<{
      agents: number;
      identities: number;
      source_records: number;
    }>(`
      select
        (select count(*)::int from agents) agents,
        (select count(*)::int from agent_identities) identities,
        (select count(*)::int from corpus_source_records) source_records
    `);
    expect(counts.rows[0]).toEqual({
      agents: 100,
      identities: 100,
      source_records: 100,
    });
  });

  it("persists malformed observations in the same page transaction", async () => {
    const agent = fixture(1);
    const result = await store.persistDiscoveryPage({
      records: [{ agent, raw: agent, fetchedAt: new Date() }],
      malformed: [
        {
          raw: { broken: true },
          page: 7,
          index: 1,
          error: new Error("fixture malformed"),
        },
      ],
    });
    expect(result).toMatchObject({
      persisted: 1,
      malformed: 1,
      statements: 5,
    });
    const malformed = await database.query<{ status: string }>(
      "select status::text from ingestion_records where source_key='page:7:record:1'",
    );
    expect(malformed.rows).toEqual([{ status: "failed" }]);
  });

  it("enriches category and capability taxonomy off the discovery path", async () => {
    const agent = fixture(1);
    const fetchedAt = new Date();
    await store.persistDiscoveryPage({
      records: [{ agent, raw: agent, fetchedAt }],
      malformed: [],
    });
    const result = await store.persistEnrichmentBatch([
      {
        agent,
        fetchedAt,
        derived: {
          services: [],
          capabilities: ["health-factor-monitoring"],
          classifications: [
            {
              categorySlug: "health-factor-monitoring",
              confidence: "high",
              evidenceType: "structured_declaration",
              matchedSource: "supported_protocols",
              matchedValue: "A2A",
            },
          ],
          quality: {
            completenessPercent: 50,
            readiness: "DISCOVERABLE",
            facts: { hasName: true },
            ruleVersion: "bsc-corpus-v2",
          },
          priority: 50,
        },
      },
    ]);
    expect(result).toMatchObject({ persisted: 1, transactionCount: 1 });
    const terms = await database.query<{ kind: string }>(`
      select t.kind::text kind from agent_taxonomy at
      join taxonomy_terms t on t.id=at.term_id
      where t.slug='health-factor-monitoring'
      order by kind
    `);
    expect(terms.rows).toEqual([{ kind: "capability" }, { kind: "category" }]);
    const source = await database.query<{ version: string }>(`
      select enrichment_rule_version version from corpus_source_records
      where source_record_id='bulk-1'
    `);
    expect(source.rows).toEqual([{ version: "bsc-corpus-v2" }]);
  });
});
