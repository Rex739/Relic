import { readFile, readdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RelicDatabase } from "../src/client.js";
import { DrizzleMandateStore } from "../src/mandates.js";
import * as schema from "../src/schema.js";

let database: PGlite;
let store: DrizzleMandateStore;
const principalId = "01945b1e-7e80-7000-8000-000000000900";
const agentId = "01945b1e-7e80-7000-8000-000000000003";
const serviceId = "01945b1e-7e80-7000-8000-000000001003";

beforeEach(async () => {
  database = new PGlite();
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && !name.startsWith("0008_"))
    .sort();
  for (const name of names) {
    let sql = await readFile(new URL(name, directory), "utf8");
    if (name.startsWith("0011_"))
      sql = sql.split("-- Mandates are server-side authorization records")[0]!;
    if (name.startsWith("0012_"))
      sql = sql.split("-- Execution control is server-side policy state")[0]!;
    if (name.startsWith("0013_"))
      sql = sql.split(
        "-- Commerce and wallet-session state is server-side only",
      )[0]!;
    if (name.startsWith("0014_"))
      sql = sql.split(
        "ALTER TABLE public.authorization_challenges ENABLE ROW LEVEL SECURITY",
      )[0]!;
    await database.exec(sql);
  }
  await database.exec(`
    insert into agents (id, name, description, metadata_uri) values
      ('${agentId}', 'Relic Health Factor Monitor', 'Read-only monitoring.', 'ipfs://health');
    insert into marketplace_services
      (id, agent_id, source_service_id, name, category_slug, interface_protocol, endpoint, protocol_support, availability, verification_level, last_verified_at, source, provenance, raw)
    values
      ('${serviceId}', '${agentId}', 'health', 'Health monitor', 'health-factor-monitoring', 'erc8183', 'https://example.test/erc8183', '{"Venus":true}', 'available', 'INVOCATION_VERIFIED', '2026-08-21', 'fixture', 'independently_observed', '{}');
  `);
  store = new DrizzleMandateStore(
    drizzle(database, { schema }) as unknown as RelicDatabase,
  );
});

afterEach(() => database.close());

const profile = {
  agentId,
  agentName: "Relic Health Factor Monitor",
  tier: "Actionable" as const,
  chainId: 97 as const,
  network: "BNB Chain Testnet" as const,
  serviceId,
  serviceEndpoint: "https://example.test/erc8183",
  serviceVerificationLevel: "INVOCATION_VERIFIED" as const,
  verificationTimestamp: "2026-08-21T10:00:00.000Z",
  capabilitySet: ["monitor_positions", "generate_alerts"],
  supportedAssets: [],
  supportedProtocols: ["Venus"],
  supportedContracts: [],
  approvalModes: ["OBSERVE_ONLY" as const],
  transactional: false,
  current: true,
  attentionReason: null,
};
const configuration = {
  objective: "Monitor my Venus position and alert below health factor 1.30.",
  allowedCapabilities: ["monitor_positions", "generate_alerts"],
  deniedCapabilities: ["transfer_tokens"],
  allowedAssets: [],
  allowedProtocols: ["Venus"],
  allowedContracts: [],
  perActionLimit: null,
  aggregateLimit: null,
  executionFrequency: null,
  startAt: "2026-08-21T10:00:00.000Z",
  expiresAt: "2026-08-28T10:00:00.000Z",
  approvalMode: "OBSERVE_ONLY" as const,
  riskConstraints: { alertHealthFactorBelow: "1.30" },
  stopConditions: [{ kind: "SERVICE_STALE" }],
};
const evidence = {
  agentId,
  externalAgentId: "1840",
  registryAddress: "0x1111111111111111111111111111111111111111",
  serviceId,
  serviceEndpoint: profile.serviceEndpoint,
  verificationTier: "Actionable" as const,
  verificationTimestamp: profile.verificationTimestamp,
  chainId: 97 as const,
  capabilitySet: profile.capabilitySet,
  evidenceSnapshot: { checks: { commerceVerified: true } },
};

describe("durable mandate persistence", () => {
  it("persists lifecycle events and evidence-bound activation", async () => {
    const draft = await store.createMandate({
      principalId,
      principalType: "DEVELOPMENT_SESSION",
      profile,
      configuration,
      evidence,
    });
    expect(draft).toMatchObject({
      status: "DRAFT",
      authorizationBoundary: "POLICY_ONLY",
      currentVersion: 1,
      activeVersion: null,
    });
    const reviewed = await store.transitionMandate({
      id: draft.id,
      principalId,
      from: ["DRAFT"],
      to: "REVIEWED",
      event: "MANDATE_REVIEWED",
      securitySensitive: true,
    });
    const active = await store.transitionMandate({
      id: draft.id,
      principalId,
      from: ["REVIEWED"],
      to: "ACTIVE",
      event: "MANDATE_ACTIVATED",
      securitySensitive: true,
      activateCurrentVersion: true,
    });
    expect(reviewed?.version.approvedAt).not.toBeNull();
    expect(active).toMatchObject({ status: "ACTIVE", activeVersion: 1 });
    expect(active?.events.map((event) => event.type)).toEqual([
      "MANDATE_ACTIVATED",
      "MANDATE_REVIEWED",
      "MANDATE_CREATED",
    ]);
    expect(active?.version.evidence).toMatchObject({
      externalAgentId: "1840",
      serviceId,
      verificationTier: "Actionable",
    });
  });

  it("creates an immutable replacement version and requires reapproval", async () => {
    const draft = await store.createMandate({
      principalId,
      principalType: "DEVELOPMENT_SESSION",
      profile,
      configuration,
      evidence,
    });
    await store.transitionMandate({
      id: draft.id,
      principalId,
      from: ["DRAFT"],
      to: "REVIEWED",
      event: "MANDATE_REVIEWED",
      securitySensitive: true,
    });
    const updated = await store.createMandateVersion({
      id: draft.id,
      principalId,
      profile,
      configuration: {
        ...configuration,
        objective: `${configuration.objective} Send one concise alert.`,
      },
      evidence,
    });
    expect(updated).toMatchObject({
      status: "DRAFT",
      currentVersion: 2,
      activeVersion: null,
    });
    const rows = await database.query<{
      version: number;
      state: string;
      objective: string;
    }>(
      `select version, state, objective from mandate_versions where mandate_id = '${draft.id}' order by version`,
    );
    expect(rows.rows).toEqual([
      { version: 1, state: "SUPERSEDED", objective: configuration.objective },
      {
        version: 2,
        state: "DRAFT",
        objective: `${configuration.objective} Send one concise alert.`,
      },
    ]);
  });

  it("pauses active mandates when current evidence needs attention", async () => {
    const draft = await store.createMandate({
      principalId,
      principalType: "DEVELOPMENT_SESSION",
      profile,
      configuration,
      evidence,
    });
    await store.transitionMandate({
      id: draft.id,
      principalId,
      from: ["DRAFT"],
      to: "REVIEWED",
      event: "MANDATE_REVIEWED",
      securitySensitive: true,
    });
    await store.transitionMandate({
      id: draft.id,
      principalId,
      from: ["REVIEWED"],
      to: "ACTIVE",
      event: "MANDATE_ACTIVATED",
      securitySensitive: true,
      activateCurrentVersion: true,
    });
    const blocked = await store.markAttentionRequired({
      id: draft.id,
      principalId,
      reason: "Verified endpoint is stale.",
    });
    expect(blocked).toMatchObject({
      status: "PAUSED",
      attentionReason: "Verified endpoint is stale.",
    });
    expect(blocked?.events[0]).toMatchObject({
      type: "MANDATE_ATTENTION_REQUIRED",
      securitySensitive: true,
    });
  });
});
