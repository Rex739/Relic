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
    if (name.startsWith("0018_"))
      migration = migration.split(
        "ALTER TABLE public.seller_agent_authorizations ENABLE ROW LEVEL SECURITY",
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
      ('01945b1e-7e80-7000-8000-000000001002', 'ENDPOINT_OBSERVED', 'INVOCATION_VERIFIED', 'passed', 'a2a', '{"price":"1000000000","currency":"0xcE24439F2D9C6a2289F741120FE202248B666666"}', '2026-08-20'),
      ('01945b1e-7e80-7000-8000-000000001003', 'PAYMENT_UNDERSTOOD', 'INVOCATION_VERIFIED', 'passed', 'erc8183', '{"price":"1000000000","currency":"0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565"}', '2026-08-20'),
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
    insert into commerce_agreements
      (id, principal_id, agent_id, service_id, offer_id, offer_version_id, status, chain_id, terms_hash, terms_snapshot, pricing_snapshot, amount_base_units, payment_token_address, payment_token_decimals)
    values
      ('01945b1e-7e80-7000-8000-000000005001', 'buyer', '01945b1e-7e80-7000-8000-000000000003', '01945b1e-7e80-7000-8000-000000001003', '01945b1e-7e80-7000-8000-000000003001', (select id from agent_offer_versions where offer_id='01945b1e-7e80-7000-8000-000000003001' and version=1), 'ACTIVE', 97, '0xterms', 'Read-only monitoring', '{"amountBaseUnits":"0"}', 0, '0x0000000000000000000000000000000000000000', 18);
    update activations set
      purpose='USER_COMMERCE',
      marketplace_history_eligible=true,
      commerce_agreement_id='01945b1e-7e80-7000-8000-000000005001',
      lifecycle_state='COMPLETED'
      where id='01945b1e-7e80-7000-8000-000000002001';
    insert into activations
      (id, agent_id, service_id, chain_id, purpose, marketplace_history_eligible, commerce_agreement_id, status, lifecycle_state)
    values
      ('01945b1e-7e80-7000-8000-000000002003', '01945b1e-7e80-7000-8000-000000000003', '01945b1e-7e80-7000-8000-000000001003', 97, 'USER_COMMERCE', true, '01945b1e-7e80-7000-8000-000000005001', 'FAILED', 'FAILED'),
      ('01945b1e-7e80-7000-8000-000000002004', '01945b1e-7e80-7000-8000-000000000003', '01945b1e-7e80-7000-8000-000000001003', 97, 'USER_COMMERCE', false, '01945b1e-7e80-7000-8000-000000005001', 'FAILED', 'FAILED');
    insert into commerce_operations
      (id, agreement_id, activation_id, operation_type, state, idempotency_key, attempt)
    values
      ('01945b1e-7e80-7000-8000-000000004001', '01945b1e-7e80-7000-8000-000000005001', '01945b1e-7e80-7000-8000-000000002001', 'FUND', 'FINALIZED', 'fixture:fund:completed', 1),
      ('01945b1e-7e80-7000-8000-000000004002', '01945b1e-7e80-7000-8000-000000005001', '01945b1e-7e80-7000-8000-000000002003', 'FUND', 'FINALIZED', 'fixture:fund:failed', 2),
      ('01945b1e-7e80-7000-8000-000000004003', '01945b1e-7e80-7000-8000-000000005001', '01945b1e-7e80-7000-8000-000000002004', 'FUND', 'FINALIZED', 'fixture:fund:engineering-validation', 3);
    insert into marketplace_outcomes
      (activation_id, agent_id, service_id, invocation_successful, commerce_successful, settlement_state, observed_cost, protocol_evidence)
    values
      ('01945b1e-7e80-7000-8000-000000002003', '01945b1e-7e80-7000-8000-000000000003', '01945b1e-7e80-7000-8000-000000001003', false, false, 'FAILED', '0', '{}');
    insert into marketplace_reviews
      (activation_id, commerce_agreement_id, reviewer_principal_id, reviewer_role,
       subject_type, subject_agent_id, sentiment, tags, message,
       eligibility_provenance)
    values
      ('01945b1e-7e80-7000-8000-000000002001',
       '01945b1e-7e80-7000-8000-000000005001', 'buyer', 'BUYER', 'AGENT',
       '01945b1e-7e80-7000-8000-000000000003', 'GOOD',
       '["accurate-result"]', 'Clear result.',
       '{"rule":"completed_user_commerce_v1"}');
    insert into reputation_inventory
      (agent_id, source, feedback_count, average_score, star_count, raw, observed_at)
    values
      ('01945b1e-7e80-7000-8000-000000000003', '8004scan', 99, 4.9, 98,
       '{"source":"external"}', '2026-08-20');
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
      eligibleAcceptedJobCount: 2,
      completedCommerceJobCount: 1,
      completionRatePercent: 50,
      reviewCount: 1,
      reviewGoodCount: 1,
      reviewBadCount: 0,
      feedbackCount: 99,
      activeOfferPrice: {
        amountBaseUnits: "0",
        decimals: 18,
        symbol: "tBNB",
      },
    });
  });

  it("projects only verified buyer-to-agent reviews into public stats and detail", async () => {
    const detail = await repository.findPublicMarketplaceAgent(
      "01945b1e-7e80-7000-8000-000000000003",
    );
    expect(detail).toMatchObject({
      reviewCount: 1,
      reviewGoodCount: 1,
      reviewBadCount: 0,
      reviews: [
        {
          reviewerRole: "BUYER",
          subjectType: "AGENT",
          sentiment: "GOOD",
          tags: ["accurate-result"],
          message: "Clear result.",
        },
      ],
    });
  });

  it("keeps review sentiment independent from completion rate and external feedback", async () => {
    await database.exec(`
      update marketplace_reviews set sentiment = 'BAD', tags = '["service-issue"]';
    `);
    const [agent] = (
      await repository.listPublicMarketplace({ page: 1, limit: 10 })
    ).items.filter(({ id }) => id === "01945b1e-7e80-7000-8000-000000000003");
    expect(agent).toMatchObject({
      completionRatePercent: 50,
      reviewCount: 1,
      reviewGoodCount: 0,
      reviewBadCount: 1,
      feedbackCount: 99,
    });
  });

  it("counts genuine zero-price success and accepted failure but excludes funded engineering validation", async () => {
    const result = await repository.listPublicMarketplace({
      page: 1,
      limit: 10,
      category: "health-factor-monitoring",
    });
    expect(result.items[0]).toMatchObject({
      eligibleAcceptedJobCount: 2,
      completedCommerceJobCount: 1,
      completionRatePercent: 50,
      activeOfferPrice: { amountBaseUnits: "0" },
    });
  });

  it("keeps public hireability consistent across list, detail, compare and categories", async () => {
    const id = "01945b1e-7e80-7000-8000-000000000003";
    const [list, detail, compare, categories] = await Promise.all([
      repository.listPublicMarketplace({ page: 1, limit: 10 }),
      repository.findPublicMarketplaceAgent(id),
      repository.comparePublicMarketplaceAgents([id]),
      repository.listPublicCategories(),
    ]);
    const listed = list.items.find((agent) => agent.id === id);
    expect(listed).toMatchObject({ tier: "Actionable", hireable: true });
    expect(detail).toMatchObject({ tier: "Actionable", hireable: true });
    expect(compare[0]).toMatchObject({ tier: "Actionable", hireable: true });
    expect(
      categories.find(({ slug }) => slug === "health-factor-monitoring"),
    ).toMatchObject({
      discovered: 1,
      verified: 1,
      ready: 1,
      hireable: 1,
      working: 1,
      actionable: 1,
    });
  });

  it("keeps discovered and verified category inventory distinct from public supply", async () => {
    const categories = await repository.listPublicCategories();
    expect(
      categories.find(({ slug }) => slug === "grid-trading"),
    ).toMatchObject({
      discovered: 1,
      verified: 1,
      ready: 0,
      hireable: 0,
    });
    expect(
      categories.find(({ slug }) => slug === "yield-optimisation"),
    ).toMatchObject({
      discovered: 1,
      verified: 0,
      ready: 0,
      hireable: 0,
    });
  });

  it("returns owner-scoped seller readiness without weakening public gates", async () => {
    const [working] = await repository.sellerReadiness(
      "0x0000000000000000000000000000000000000002",
    );
    expect(working).toMatchObject({
      name: "Working rebalancer",
      marketplaceStatus: "PUBLIC",
      hireable: false,
      verifiedPrice: {
        chainId: 56,
        amountBaseUnits: "1000000000",
        symbol: "U",
      },
      requirements: {
        identity: { state: "complete" },
        service: { state: "complete" },
        verification: { state: "complete" },
        commerce: { state: "complete" },
        offer: { state: "blocked" },
      },
    });

    const [hireable] = await repository.sellerReadiness(
      "0x0000000000000000000000000000000000000003",
    );
    expect(hireable).toMatchObject({
      name: "Actionable monitor",
      marketplaceStatus: "PUBLIC",
      hireable: true,
      verifiedPrice: {
        chainId: 97,
        amountBaseUnits: "1000000000",
        symbol: "U",
      },
    });
  });

  it("does not project an unrecognized payment token as a verified seller price", async () => {
    await database.exec(`
      update service_verification_observations
      set evidence = '{"price":"1000000000","currency":"0x9999999999999999999999999999999999999999"}'
      where service_id = '01945b1e-7e80-7000-8000-000000001002';
    `);
    const [readiness] = await repository.sellerReadiness(
      "0x0000000000000000000000000000000000000002",
    );
    expect(readiness?.verifiedPrice).toBeNull();
  });

  it("reports stale verification honestly in owner readiness", async () => {
    const [stale] = await repository.sellerReadiness(
      "0x0000000000000000000000000000000000000004",
    );
    expect(stale).toMatchObject({
      marketplaceStatus: "NOT_READY",
      hireable: false,
      requirements: {
        verification: {
          state: "attention",
          label: "Verification expired — refresh required",
        },
      },
    });
  });

  it("keeps a fresh test deployment out of public supply", async () => {
    await database.exec(`
      update agents
      set description = 'TEST DEPLOYMENT — not for production use'
      where id = '01945b1e-7e80-7000-8000-000000000004';
      update marketplace_services
      set last_verified_at = '2026-08-20'
      where id = '01945b1e-7e80-7000-8000-000000001004';
      update service_verification_observations
      set observed_at = '2026-08-20'
      where service_id = '01945b1e-7e80-7000-8000-000000001004';
    `);
    const publicResult = await repository.listPublicMarketplace({
      page: 1,
      limit: 10,
    });
    expect(publicResult.items.some(({ id }) => id.endsWith("0004"))).toBe(
      false,
    );
    const [readiness] = await repository.sellerReadiness(
      "0x0000000000000000000000000000000000000004",
    );
    expect(readiness).toMatchObject({
      testDeployment: true,
      marketplaceStatus: "NOT_READY",
      hireable: false,
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
      eligibleAcceptedJobCount: 0,
      completedCommerceJobCount: 0,
      completionRatePercent: null,
      reviewCount: 0,
      reviewGoodCount: 0,
      reviewBadCount: 0,
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
