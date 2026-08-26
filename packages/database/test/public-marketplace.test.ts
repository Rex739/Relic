import { readFile, readdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RelicDatabase } from "../src/client.js";
import { DrizzleAgentRepository } from "../src/repository.js";
import * as schema from "../src/schema.js";

let database: PGlite;
let repository: DrizzleAgentRepository;

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
  await database.exec(`
    insert into agents (id, name, description, image_url, metadata_uri, updated_at) values
      ('01945b1e-7e80-7000-8000-000000000001', 'Registered only', 'A declared agent that has never passed a controlled invocation.', null, 'ipfs://registered', '2026-08-20'),
      ('01945b1e-7e80-7000-8000-000000000002', 'Working rebalancer', 'A verified rebalancing agent with a controlled invocation.', null, 'ipfs://working', '2026-08-20'),
      ('01945b1e-7e80-7000-8000-000000000003', 'Actionable monitor', 'A verified health monitor with completed commerce evidence.', 'https://agents.example/monitor.png', 'ipfs://actionable', '2026-08-20'),
      ('01945b1e-7e80-7000-8000-000000000004', 'Stale grid agent', 'An invocation once passed but the evidence is now stale.', null, 'ipfs://stale', '2026-08-01');
    insert into agent_identities
      (agent_id, standard, namespace, chain_id, registry_address, external_agent_id, owner_address, registration_status)
    values
      ('01945b1e-7e80-7000-8000-000000000001', 'erc-8004', 'eip155', 56, '0x1111111111111111111111111111111111111111', '1', '0x0000000000000000000000000000000000000001', 'registered'),
      ('01945b1e-7e80-7000-8000-000000000002', 'erc-8004', 'eip155', 56, '0x1111111111111111111111111111111111111111', '2', '0x0000000000000000000000000000000000000002', 'registered'),
      ('01945b1e-7e80-7000-8000-000000000003', 'erc-8004', 'eip155', 97, '0x1111111111111111111111111111111111111111', '3', '0x0000000000000000000000000000000000000003', 'registered'),
      ('01945b1e-7e80-7000-8000-000000000004', 'erc-8004', 'eip155', 56, '0x1111111111111111111111111111111111111111', '4', '0x0000000000000000000000000000000000000004', 'registered');
    insert into launch_candidates (agent_id, category_slug, status, confidence, source, evidence) values
      ('01945b1e-7e80-7000-8000-000000000001', 'yield-optimisation', 'SERVICE_IDENTIFIED', 'medium', 'fixture', '{}'),
      ('01945b1e-7e80-7000-8000-000000000002', 'rebalancing', 'INVOCATION_VERIFIED', 'high', 'fixture', '{}'),
      ('01945b1e-7e80-7000-8000-000000000003', 'health-factor-monitoring', 'ACTIONABLE', 'high', 'fixture', '{}'),
      ('01945b1e-7e80-7000-8000-000000000004', 'grid-trading', 'INVOCATION_VERIFIED', 'high', 'fixture', '{}');
    insert into marketplace_services
      (id, agent_id, source_service_id, name, category_slug, interface_protocol, endpoint, protocol_support, availability, verification_level, last_verified_at, source, provenance, raw)
    values
      ('01945b1e-7e80-7000-8000-000000001001', '01945b1e-7e80-7000-8000-000000000001', 'declared', 'Declared service', 'yield-optimisation', 'mcp', 'https://declared.invalid', '{"mcp":true}', 'available', 'DECLARED', '2026-08-20', 'fixture', 'developer_declared', '{}'),
      ('01945b1e-7e80-7000-8000-000000001002', '01945b1e-7e80-7000-8000-000000000002', 'working', 'Working service', 'rebalancing', 'a2a', 'https://working.invalid', '{"a2a":true}', 'available', 'INVOCATION_VERIFIED', '2026-08-20', 'fixture', 'independently_observed', '{}'),
      ('01945b1e-7e80-7000-8000-000000001003', '01945b1e-7e80-7000-8000-000000000003', 'actionable', 'Actionable service', 'health-factor-monitoring', 'erc8183', 'https://actionable.invalid', '{"erc8183":true}', 'available', 'INVOCATION_VERIFIED', '2026-08-20', 'fixture', 'independently_observed', '{}'),
      ('01945b1e-7e80-7000-8000-000000001004', '01945b1e-7e80-7000-8000-000000000004', 'stale', 'Stale service', 'grid-trading', 'a2a', 'https://stale.invalid', '{"a2a":true}', 'available', 'INVOCATION_VERIFIED', '2026-08-01', 'fixture', 'independently_observed', '{}');
    insert into service_verification_observations
      (service_id, from_level, to_level, result, protocol, evidence, observed_at)
    values
      ('01945b1e-7e80-7000-8000-000000001002', 'ENDPOINT_OBSERVED', 'INVOCATION_VERIFIED', 'passed', 'a2a', '{}', '2026-08-20'),
      ('01945b1e-7e80-7000-8000-000000001003', 'PAYMENT_UNDERSTOOD', 'INVOCATION_VERIFIED', 'passed', 'erc8183', '{}', '2026-08-20'),
      ('01945b1e-7e80-7000-8000-000000001004', 'ENDPOINT_OBSERVED', 'INVOCATION_VERIFIED', 'passed', 'a2a', '{}', '2026-08-01');
    insert into activations (id, agent_id, service_id, chain_id, status)
    values
      ('01945b1e-7e80-7000-8000-000000002001', '01945b1e-7e80-7000-8000-000000000003', '01945b1e-7e80-7000-8000-000000001003', 97, 'COMPLETED'),
      ('01945b1e-7e80-7000-8000-000000002002', '01945b1e-7e80-7000-8000-000000000002', '01945b1e-7e80-7000-8000-000000001002', 56, 'TERMS_RESOLVED');
    insert into marketplace_outcomes
      (activation_id, agent_id, service_id, invocation_successful, commerce_successful, settlement_state, observed_cost, protocol_evidence)
    values
      ('01945b1e-7e80-7000-8000-000000002001', '01945b1e-7e80-7000-8000-000000000003', '01945b1e-7e80-7000-8000-000000001003', true, true, 'COMPLETED', '0', '{}'),
      ('01945b1e-7e80-7000-8000-000000002002', '01945b1e-7e80-7000-8000-000000000002', '01945b1e-7e80-7000-8000-000000001002', true, false, 'NOT_STARTED', '0', '{}');
    insert into agent_offers
      (id, operator_principal_id, agent_id, service_id, status, current_version)
    values
      ('01945b1e-7e80-7000-8000-000000003001', 'operator', '01945b1e-7e80-7000-8000-000000000003', '01945b1e-7e80-7000-8000-000000001003', 'ACTIVE', 1);
    insert into agent_offer_versions
      (offer_id, version, chain_id, capability, billing_model, price_base_units, payment_token_address, payment_token_decimals, currency_symbol, terms_content, terms_hash, capability_snapshot, limitations_snapshot, evidence_reference, effective_at)
    values
      ('01945b1e-7e80-7000-8000-000000003001', 1, 97, 'Health monitoring', 'PER_EXECUTION', 0, '0x0000000000000000000000000000000000000000', 18, 'tBNB', 'Read-only monitoring', '0xterms', '[]', '[]', '{}', '2026-08-19');
  `);
  repository = new DrizzleAgentRepository(
    drizzle(database, { schema }) as unknown as RelicDatabase,
    { now: () => new Date("2026-08-20T12:00:00.000Z") },
  );
});

afterEach(() => database.close());

describe("verified public marketplace", () => {
  it("never leaks a plain registration and removes stale evidence", async () => {
    const result = await repository.listPublicMarketplace({
      page: 1,
      limit: 10,
    });
    expect(result.items.map(({ name }) => name)).toEqual([
      "Actionable monitor",
      "Working rebalancer",
    ]);
    expect(result.items.some(({ name }) => name === "Registered only")).toBe(
      false,
    );
    expect(result.items.some(({ name }) => name === "Stale grid agent")).toBe(
      false,
    );
    await expect(
      repository.findPublicMarketplaceAgent(
        "01945b1e-7e80-7000-8000-000000000001",
      ),
    ).resolves.toBeNull();
  });

  it("maps successful commerce evidence to Actionable and labels testnet", async () => {
    const result = await repository.listPublicMarketplace({
      page: 1,
      limit: 10,
      tier: "Actionable",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: "Actionable monitor",
      tier: "Actionable",
      chainId: 97,
      network: "BNB Chain Testnet",
      imageUrl: "https://agents.example/monitor.png",
      verifiedInvocationCount: 1,
      completedCommerceJobCount: 1,
      activeOfferPrice: {
        amountBaseUnits: "0",
        decimals: 18,
        symbol: "tBNB",
      },
    });
  });

  it("never counts invocation evidence as a completed commerce job", async () => {
    const result = await repository.listPublicMarketplace({
      page: 1,
      limit: 10,
    });
    expect(
      result.items.find(({ name }) => name === "Working rebalancer"),
    ).toMatchObject({
      verifiedInvocationCount: 1,
      completedCommerceJobCount: 0,
      deliveryCompletedCount: 0,
      settlementCompletedCount: 0,
    });
  });

  it("applies category, protocol, and stable server pagination", async () => {
    const category = await repository.listPublicMarketplace({
      page: 1,
      limit: 10,
      category: "rebalancing",
      protocol: "a2a",
    });
    expect(category.items.map(({ name }) => name)).toEqual([
      "Working rebalancer",
    ]);
    const first = await repository.listPublicMarketplace({ page: 1, limit: 1 });
    const second = await repository.listPublicMarketplace({
      page: 2,
      limit: 1,
    });
    expect(first).toMatchObject({ total: 2, totalPages: 2 });
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it("enforces every structured intent requirement against stored evidence", async () => {
    const matching = await repository.listPublicMarketplace({
      page: 1,
      limit: 10,
      category: "rebalancing",
      requirements: ["controlled"],
    });
    expect(matching.items.map(({ name }) => name)).toEqual([
      "Working rebalancer",
    ]);
    const missing = await repository.listPublicMarketplace({
      page: 1,
      limit: 10,
      category: "yield-optimisation",
      requirements: ["USDT", "conservative"],
    });
    expect(missing.items).toEqual([]);
  });
});
