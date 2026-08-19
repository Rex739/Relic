import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("Marketplace Kernel migration", () => {
  it("creates the schema, seeds core categories, and enforces chain identity uniqueness", async () => {
    const database = new PGlite();
    databases.push(database);
    const migration = await readFile(
      new URL("../migrations/0000_marketplace_kernel.sql", import.meta.url),
      "utf8",
    );
    await database.exec(migration);
    const indexerMigration = await readFile(
      new URL("../migrations/0001_shallow_blue_marvel.sql", import.meta.url),
      "utf8",
    );
    await database.exec(indexerMigration);

    const categories = await database.query<{ slug: string }>(
      "select slug from taxonomy_terms where kind = 'category' order by slug",
    );
    expect(categories.rows.map(({ slug }) => slug)).toEqual([
      "grid-trading",
      "health-factor-monitoring",
      "rebalancing",
      "yield-optimisation",
    ]);

    await database.exec(`
      insert into agents (id, name, metadata_uri)
      values ('01945b1e-7e80-7000-8000-000000000001', 'Test-only', 'data:application/json,{}');
      insert into agent_identities
        (agent_id, standard, namespace, chain_id, registry_address, external_agent_id, owner_address, registration_status)
      values
        ('01945b1e-7e80-7000-8000-000000000001', 'erc-8004', 'eip155', 56, '0xregistry', '1', '0xowner', 'registered');
    `);
    await expect(
      database.exec(`
        insert into agents (id, name, metadata_uri)
        values ('01945b1e-7e80-7000-8000-000000000002', 'Duplicate', 'data:application/json,{}');
        insert into agent_identities
          (agent_id, standard, namespace, chain_id, registry_address, external_agent_id, owner_address, registration_status)
        values
          ('01945b1e-7e80-7000-8000-000000000002', 'erc-8004', 'eip155', 56, '0xregistry', '1', '0xowner2', 'registered');
      `),
    ).rejects.toThrow();
  });

  it("persists checkpoints and rejects duplicate raw logs for idempotent replay", async () => {
    const database = new PGlite();
    databases.push(database);
    for (const name of [
      "0000_marketplace_kernel.sql",
      "0001_shallow_blue_marvel.sql",
      "0002_outstanding_cannonball.sql",
      "0003_wealthy_loners.sql",
    ]) {
      await database.exec(
        await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    }
    await database.exec(`
      insert into indexer_checkpoints
        (chain_id, registry_address, indexed_block, indexed_block_hash, safe_block, status)
      values (56, '0xregistry', 100, '0xblock', 115, 'succeeded');
      insert into raw_chain_events
        (chain_id, contract_address, event_name, block_number, block_hash, transaction_hash, transaction_index, log_index, decoded_payload)
      values (56, '0xregistry', 'Registered', 100, '0xblock', '0xtx', 0, 0, '{}');
    `);
    const checkpoint = await database.query<{ indexed_block: bigint }>(
      "select indexed_block from indexer_checkpoints where chain_id = 56",
    );
    expect(String(checkpoint.rows[0]?.indexed_block)).toBe("100");
    await expect(
      database.exec(`
        insert into raw_chain_events
          (chain_id, contract_address, event_name, block_number, block_hash, transaction_hash, transaction_index, log_index, decoded_payload)
        values (56, '0xregistry', 'Registered', 100, '0xblock', '0xtx', 0, 0, '{}');
      `),
    ).rejects.toThrow();
  });

  it("creates resumable corpus, verification, readiness, and observation state", async () => {
    const database = new PGlite();
    databases.push(database);
    for (const name of [
      "0000_marketplace_kernel.sql",
      "0001_shallow_blue_marvel.sql",
      "0002_outstanding_cannonball.sql",
      "0003_wealthy_loners.sql",
    ])
      await database.exec(
        await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    const tables = await database.query<{ table_name: string }>(`
      select table_name from information_schema.tables
      where table_schema='public' and table_name in (
        'corpus_import_checkpoints', 'corpus_source_records',
        'verification_queue', 'agent_quality_profiles', 'endpoint_observations'
      ) order by table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "agent_quality_profiles",
      "corpus_import_checkpoints",
      "corpus_source_records",
      "endpoint_observations",
      "verification_queue",
    ]);
  });

  it("creates durable launch supply, service verification, and activation state", async () => {
    const database = new PGlite();
    databases.push(database);
    for (const name of [
      "0000_marketplace_kernel.sql",
      "0001_shallow_blue_marvel.sql",
      "0002_outstanding_cannonball.sql",
      "0003_wealthy_loners.sql",
      "0004_perfect_captain_britain.sql",
      "0005_talented_jimmy_woo.sql",
    ])
      await database.exec(
        await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    const tables = await database.query<{ table_name: string }>(`
      select table_name from information_schema.tables
      where table_schema='public' and table_name in (
        'targeted_discovery_runs', 'launch_candidates', 'marketplace_services',
        'service_verification_observations', 'activations', 'activation_transitions',
        'activation_preflights'
      ) order by table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "activation_preflights",
      "activation_transitions",
      "activations",
      "launch_candidates",
      "marketplace_services",
      "service_verification_observations",
      "targeted_discovery_runs",
    ]);
    await database.exec(`
      insert into agents (id, name, metadata_uri)
      values ('01945b1e-7e80-7000-8000-000000000010', 'Fixture seller', 'data:application/json,{}');
      insert into marketplace_services
        (id, agent_id, source_service_id, name, category_slug, interface_protocol, source, provenance, raw)
      values
        ('01945b1e-7e80-7000-8000-000000000011', '01945b1e-7e80-7000-8000-000000000010', 'seller-1', 'Source A', 'grid-trading', 'erc8183', 'source-a', 'developer_declared', '{}'),
        ('01945b1e-7e80-7000-8000-000000000012', '01945b1e-7e80-7000-8000-000000000010', 'seller-1', 'Conflicting source B', 'grid-trading', 'erc8183', 'source-b', 'secondary_unverified', '{}');
      insert into activations
        (id, agent_id, service_id, chain_id, status, commerce_address, description_hash)
      values
        ('01945b1e-7e80-7000-8000-000000000013', '01945b1e-7e80-7000-8000-000000000010', '01945b1e-7e80-7000-8000-000000000011', 97, 'PREPARED', '0xcommerce', 'fixture-hash');
      insert into activation_transitions
        (activation_id, status, evidence)
      values
        ('01945b1e-7e80-7000-8000-000000000013', 'PREPARED', '{"fixture":true}');
      insert into activation_preflights
        (chain_id, status, commerce_address, payment_token, contract_deployed, transaction_attempted, evidence, failure)
      values
        (97, 'BLOCKED', '0xcommerce', '0xtoken', true, false, '{"fixture":true}', '{"reason":"no seller"}');
    `);
    const persisted = await database.query<{
      services: number;
      transitions: number;
      preflights: number;
    }>(`
      select
        (select count(*)::int from marketplace_services) services,
        (select count(*)::int from activation_transitions) transitions,
        (select count(*)::int from activation_preflights) preflights
    `);
    expect(persisted.rows[0]).toEqual({
      services: 2,
      transitions: 1,
      preflights: 1,
    });
  });

  it("persists Phase 05 onboarding, ownership, stable lifecycle, and factual outcomes", async () => {
    const database = new PGlite();
    databases.push(database);
    for (const name of [
      "0000_marketplace_kernel.sql",
      "0001_shallow_blue_marvel.sql",
      "0002_outstanding_cannonball.sql",
      "0003_wealthy_loners.sql",
      "0004_perfect_captain_britain.sql",
      "0005_talented_jimmy_woo.sql",
      "0006_sticky_darkstar.sql",
    ])
      await database.exec(
        await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    await database.exec(`
      insert into agents (id, name, metadata_uri)
      values ('01945b1e-7e80-7000-8000-000000000030', 'Fixture reference', 'data:application/json,{}');
      insert into launch_candidates
        (id, agent_id, category_slug, supply_type, status, confidence, source, evidence)
      values
        ('01945b1e-7e80-7000-8000-000000000031', '01945b1e-7e80-7000-8000-000000000030', 'health-factor-monitoring', 'relic_reference', 'ACTIONABLE', 'high', 'fixture', '{"fixture":true}');
      insert into agent_submissions
        (id, chain_id, external_agent_id, supply_type, status, agent_id, candidate_id, evidence)
      values
        ('01945b1e-7e80-7000-8000-000000000032', 97, '42', 'relic_reference', 'ACTIONABLE', '01945b1e-7e80-7000-8000-000000000030', '01945b1e-7e80-7000-8000-000000000031', '{"fixture":true}');
      insert into ownership_challenges
        (id, submission_id, nonce_hash, message, expected_owner, signer_address, signature_digest, expires_at, consumed_at, verified_at)
      values
        ('01945b1e-7e80-7000-8000-000000000033', '01945b1e-7e80-7000-8000-000000000032', 'nonce-digest', 'fixture challenge', '0xowner', '0xowner', 'signature-digest', now() + interval '1 hour', now(), now());
      insert into marketplace_services
        (id, agent_id, source_service_id, name, category_slug, interface_protocol, verification_level, source, provenance, raw)
      values
        ('01945b1e-7e80-7000-8000-000000000034', '01945b1e-7e80-7000-8000-000000000030', 'health-1', 'Health monitor', 'health-factor-monitoring', 'erc8183', 'COMMERCE_VERIFIED', 'fixture', 'developer_declared', '{"fixture":true}');
      insert into activations
        (id, agent_id, service_id, chain_id, status, lifecycle_state, external_job_id, commerce_address, budget)
      values
        ('01945b1e-7e80-7000-8000-000000000035', '01945b1e-7e80-7000-8000-000000000030', '01945b1e-7e80-7000-8000-000000000034', 97, 'COMPLETED', 'COMPLETED', '7', '0xcommerce', '0');
      insert into activation_lifecycle_transitions
        (activation_id, from_state, to_state, evidence)
      values
        ('01945b1e-7e80-7000-8000-000000000035', 'SETTLING', 'COMPLETED', '{"fixture":true}');
      insert into marketplace_outcomes
        (activation_id, agent_id, service_id, invocation_successful, commerce_successful, execution_duration_ms, response_status, settlement_state, observed_cost, protocol_evidence)
      values
        ('01945b1e-7e80-7000-8000-000000000035', '01945b1e-7e80-7000-8000-000000000030', '01945b1e-7e80-7000-8000-000000000034', true, true, 42, 'delivered', 'COMPLETED', '0', '{"fixture":true}');
    `);
    const persisted = await database.query<{
      supply_type: string;
      lifecycle_state: string;
      observed_cost: string;
      signature_digest: string;
    }>(`
      select s.supply_type::text, a.lifecycle_state::text, o.observed_cost, c.signature_digest
      from agent_submissions s
      join ownership_challenges c on c.submission_id=s.id
      join activations a on a.agent_id=s.agent_id
      join marketplace_outcomes o on o.activation_id=a.id
    `);
    expect(persisted.rows[0]).toEqual({
      supply_type: "relic_reference",
      lifecycle_state: "COMPLETED",
      observed_cost: "0",
      signature_digest: "signature-digest",
    });
  });

  it("secures the Relic public schema without exposing Data API policies", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
    `);
    for (const name of [
      "0000_marketplace_kernel.sql",
      "0001_shallow_blue_marvel.sql",
      "0002_outstanding_cannonball.sql",
      "0003_wealthy_loners.sql",
      "0004_perfect_captain_britain.sql",
      "0005_talented_jimmy_woo.sql",
      "0006_sticky_darkstar.sql",
      "0007_woozy_magma.sql",
      "0008_secure_public_schema.sql",
    ])
      await database.exec(
        await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );

    const state = await database.query<{
      table_count: number;
      rls_enabled_count: number;
      policy_count: number;
      anon_can_read_artifacts: boolean;
      authenticated_can_write_artifacts: boolean;
    }>(`
      select
        (select count(*)::int
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p')) table_count,
        (select count(*)::int
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity) rls_enabled_count,
        (select count(*)::int from pg_policies where schemaname = 'public') policy_count,
        has_table_privilege('anon', 'public.reference_agent_artifacts', 'select') anon_can_read_artifacts,
        has_table_privilege('authenticated', 'public.reference_agent_artifacts', 'insert') authenticated_can_write_artifacts
    `);
    expect(state.rows[0]).toEqual({
      table_count: 43,
      rls_enabled_count: 43,
      policy_count: 0,
      anon_can_read_artifacts: false,
      authenticated_can_write_artifacts: false,
    });

    await database.exec(`
      create table future_relic_table (id integer primary key);
    `);
    const futureAccess = await database.query<{
      anon_can_read: boolean;
      authenticated_can_write: boolean;
    }>(`
      select
        has_table_privilege('anon', 'public.future_relic_table', 'select') anon_can_read,
        has_table_privilege('authenticated', 'public.future_relic_table', 'insert') authenticated_can_write
    `);
    expect(futureAccess.rows[0]).toEqual({
      anon_can_read: false,
      authenticated_can_write: false,
    });
  });
});
