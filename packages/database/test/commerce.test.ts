import { readFile, readdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RelicDatabase } from "../src/client.js";
import { DrizzleCommerceStore } from "../src/commerce.js";
import * as schema from "../src/schema.js";

let database: PGlite;
let store: DrizzleCommerceStore;
const agentId = "01945b1e-7e80-7000-8000-000000000301";
const serviceId = "01945b1e-7e80-7000-8000-000000000302";
const mandateId = "01945b1e-7e80-7000-8000-000000000303";
const buyer = "01945b1e-7e80-7000-8000-000000000304";
const owner = "0x1111111111111111111111111111111111111111";
const operator = "01945b1e-7e80-7000-8000-000000000305";

beforeEach(async () => {
  database = new PGlite();
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory))
    .filter((item) => /^\d{4}_.+\.sql$/.test(item) && !item.startsWith("0008_"))
    .sort()) {
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
    insert into agents (id, name, metadata_uri) values ('${agentId}', 'Health monitor', 'ipfs://fixture');
    insert into agent_identities (agent_id, standard, namespace, chain_id, registry_address, external_agent_id, owner_address, registration_status)
      values ('${agentId}', 'ERC-8004', 'eip155', 97, '0x2222222222222222222222222222222222222222', '1840', '${owner}', 'registered');
    insert into launch_candidates (agent_id, category_slug, supply_type, status, confidence, source, evidence)
      values ('${agentId}', 'health-factor-monitoring', 'third_party', 'ACTIONABLE', 'high', 'fixture', '{}');
    insert into marketplace_services (id, agent_id, source_service_id, name, interface_protocol, endpoint, network_chain_id, availability, verification_level, last_verified_at, source, provenance, raw)
      values ('${serviceId}', '${agentId}', 'health', 'Health monitor', 'erc8183', 'https://example.invalid/erc8183', 97, 'available', 'COMMERCE_VERIFIED', now(), 'fixture', 'independently_observed', '{}');
    insert into mandates (id, principal_id, principal_type, agent_id, chain_id, status, current_version, active_version)
      values ('${mandateId}', '${buyer}', 'WALLET', '${agentId}', 97, 'ACTIVE', 1, 1);
  `);
  store = new DrizzleCommerceStore(
    drizzle(database, { schema }) as unknown as RelicDatabase,
  );
});

afterEach(() => database.close());

const request = () => ({
  agentId,
  serviceId,
  chainId: 97 as const,
  capability: "Read-only Venus health-factor monitoring",
  billingModel: "PER_EXECUTION" as const,
  price: {
    chainId: 97,
    tokenAddress: "0x0000000000000000000000000000000000000000" as const,
    decimals: 18,
    amountBaseUnits: "0",
    symbol: "tBNB",
  },
  terms: "Read-only observation. No transaction authority and no funds move.",
  capabilitySnapshot: ["monitor_positions"],
  limitationsSnapshot: ["BSC Testnet only"],
  effectiveAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: null,
});

describe("production commerce persistence", () => {
  it("rejects unauthorized and stale offer publication", async () => {
    await expect(
      store.createOffer({
        operatorPrincipalId: operator,
        operatorAddress: "0x9999999999999999999999999999999999999999",
        request: request(),
      }),
    ).rejects.toThrow(/owner|eligible/i);
    await database.exec(
      `update marketplace_services set last_verified_at = now() - interval '8 days' where id = '${serviceId}'`,
    );
    await expect(
      store.createOffer({
        operatorPrincipalId: operator,
        operatorAddress: owner,
        request: request(),
      }),
    ).rejects.toThrow(/owner|eligible/i);
  });

  it("preserves accepted offer versions when the operator publishes a revision", async () => {
    const offer = await store.createOffer({
      operatorPrincipalId: operator,
      operatorAddress: owner,
      request: request(),
    });
    await store.activateOffer({
      offerId: offer!.id,
      operatorPrincipalId: operator,
      operatorAddress: owner,
    });
    const agreement = await store.createAgreement({
      principalId: buyer,
      offerId: offer!.id,
      mandateId,
    });
    const revised = await store.reviseOffer({
      offerId: offer!.id,
      operatorPrincipalId: operator,
      operatorAddress: owner,
      request: { ...request(), terms: "New terms for future agreements only." },
    });
    expect(revised).toMatchObject({ currentVersion: 2, status: "PAUSED" });
    expect(agreement).toMatchObject({
      offerVersionId: offer!.version.id,
      termsSnapshot: request().terms,
    });
    const persisted = await store.findAgreement(agreement!.id, buyer);
    expect(persisted).toMatchObject({
      offerVersionId: offer!.version.id,
      termsSnapshot: request().terms,
    });
  });

  it("deduplicates operations, leases them once, and deduplicates onchain movements", async () => {
    const offer = await store.createOffer({
      operatorPrincipalId: operator,
      operatorAddress: owner,
      request: request(),
    });
    await store.activateOffer({
      offerId: offer!.id,
      operatorPrincipalId: operator,
      operatorAddress: owner,
    });
    const agreement = await store.createAgreement({
      principalId: buyer,
      offerId: offer!.id,
      mandateId,
    });
    const first = await store.createOperation({
      agreementId: agreement!.id,
      operationType: "CREATE_JOB",
      idempotencyKey: "job-once",
      state: "READY",
    });
    const replay = await store.createOperation({
      agreementId: agreement!.id,
      operationType: "CREATE_JOB",
      idempotencyKey: "job-once",
      state: "READY",
    });
    expect(replay.id).toBe(first.id);
    const [left, right] = await Promise.all([
      store.leaseOperations({ workerId: "left", limit: 1, leaseSeconds: 60 }),
      store.leaseOperations({ workerId: "right", limit: 1, leaseSeconds: 60 }),
    ]);
    expect(left.length + right.length).toBe(1);
    const movement = {
      agreementId: agreement!.id,
      movementType: "FUNDING" as const,
      chainId: 97,
      tokenAddress: request().price.tokenAddress,
      tokenDecimals: 18,
      amountBaseUnits: "0",
      transactionHash: `0x${"ab".repeat(32)}`,
      logIndex: 0,
      finalityState: "FINALIZED" as const,
      provenance: "onchain_verified" as const,
    };
    expect(await store.recordValueMovement(movement)).not.toBeNull();
    expect(await store.recordValueMovement(movement)).toBeNull();
  });

  it("does not let historical verification activations create paid reputation", async () => {
    const offer = await store.createOffer({
      operatorPrincipalId: operator,
      operatorAddress: owner,
      request: request(),
    });
    await store.activateOffer({
      offerId: offer!.id,
      operatorPrincipalId: operator,
      operatorAddress: owner,
    });
    const agreement = await store.createAgreement({
      principalId: buyer,
      offerId: offer!.id,
      mandateId,
    });
    const activationId = "01945b1e-7e80-7000-8000-000000000399";
    await database.exec(
      `insert into activations (id, agent_id, service_id, chain_id, purpose, commerce_agreement_id) values ('${activationId}', '${agentId}', '${serviceId}', 97, 'VERIFICATION', '${agreement!.id}')`,
    );
    await expect(
      store.recordReputationObservation({
        agentId,
        agreementId: agreement!.id,
        activationId,
        kind: "completed_job",
        value: { completed: true },
        provenance: "independently_observed",
        evidenceReference: {},
        observedAt: new Date(),
      }),
    ).rejects.toThrow(/verification/i);
  });
});
