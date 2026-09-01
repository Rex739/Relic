import { readFile, readdir } from "node:fs/promises";

import type {
  CanonicalExecutionAction,
  ExecutionPolicyResult,
} from "@relic/domain";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RelicDatabase } from "../src/client.js";
import { DrizzleExecutionStore } from "../src/executions.js";
import * as schema from "../src/schema.js";

let database: PGlite;
let store: DrizzleExecutionStore;
const principalId = "01945b1e-7e80-7000-8000-000000000900";
const agentId = "01945b1e-7e80-7000-8000-000000000003";
const mandateId = "01945b1e-7e80-7000-8000-000000000100";

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
    if (name.startsWith("0018_"))
      migration = migration.split(
        "ALTER TABLE public.seller_agent_authorizations ENABLE ROW LEVEL SECURITY",
      )[0]!;
    await database.exec(migration);
  }
  await database.exec(`
    insert into agents (id, name, metadata_uri) values ('${agentId}', 'Fixture agent', 'ipfs://fixture');
    insert into mandates (id, principal_id, principal_type, agent_id, chain_id, status, current_version, active_version)
    values ('${mandateId}', '${principalId}', 'DEVELOPMENT_SESSION', '${agentId}', 97, 'ACTIVE', 1, 1);
  `);
  store = new DrizzleExecutionStore(
    drizzle(database, { schema }) as unknown as RelicDatabase,
  );
});

afterEach(() => database.close());

const action = (
  id: string,
  hash: string,
  amount: string | null = null,
): CanonicalExecutionAction => ({
  id,
  mandateId,
  mandateVersion: 1,
  agentId,
  principalId,
  chainId: 97,
  actionType: amount === null ? "observe" : "swap_assets",
  capability: amount === null ? "monitor_positions" : "swap_assets",
  protocol: "Venus",
  target: null,
  asset: amount === null ? null : "USDT",
  amount,
  destination: null,
  parameters: {},
  requestedAt: "2026-08-21T12:00:00.000Z",
  deadline: "2026-08-21T13:00:00.000Z",
  source: {},
  normalizedHash: hash.padEnd(64, "0"),
  transactional: amount !== null,
});
const allow = (hash: string): ExecutionPolicyResult => ({
  decision: "ALLOW",
  reasons: [{ code: "policy_satisfied", message: "Allowed." }],
  mandateVersion: 1,
  normalizedHash: hash.padEnd(64, "0"),
  approvalMode: "PRE_AUTHORIZED",
  signingAuthorization: false,
});

describe("execution persistence", () => {
  it("deduplicates delivery and persists explainable decisions", async () => {
    const firstAction = action("01945b1e-7e80-7000-8000-000000000201", "a");
    const first = await store.createOrFind({
      id: firstAction.id,
      idempotencyKey: "same-delivery",
      principalId,
      rawRequest: { raw: true },
      action: firstAction,
    });
    const replayAction = action("01945b1e-7e80-7000-8000-000000000202", "b");
    const replay = await store.createOrFind({
      id: replayAction.id,
      idempotencyKey: "same-delivery",
      principalId,
      rawRequest: { raw: "changed" },
      action: replayAction,
    });
    expect(first.created).toBe(true);
    expect(replay).toMatchObject({
      created: false,
      record: { id: firstAction.id },
    });
    const decided = await store.recordDecision({
      executionId: firstAction.id,
      result: allow("a"),
      reserveAmount: null,
      aggregateLimit: null,
    });
    expect(decided).toMatchObject({ status: "APPROVED", decision: "ALLOW" });
  });

  it("serializes aggregate reservations so concurrent requests cannot overspend", async () => {
    const left = action("01945b1e-7e80-7000-8000-000000000211", "c", "60");
    const right = action("01945b1e-7e80-7000-8000-000000000212", "d", "60");
    await store.createOrFind({
      id: left.id,
      idempotencyKey: "budget-left",
      principalId,
      rawRequest: {},
      action: left,
    });
    await store.createOrFind({
      id: right.id,
      idempotencyKey: "budget-right",
      principalId,
      rawRequest: {},
      action: right,
    });
    const results = await Promise.all([
      store.recordDecision({
        executionId: left.id,
        result: allow("c"),
        reserveAmount: "60",
        aggregateLimit: "100",
      }),
      store.recordDecision({
        executionId: right.id,
        result: allow("d"),
        reserveAmount: "60",
        aggregateLimit: "100",
      }),
    ]);
    expect(results.map(({ decision }) => decision).sort()).toEqual([
      "ALLOW",
      "DENY",
    ]);
    expect(
      results.find(({ decision }) => decision === "DENY")?.reasons,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "aggregate_limit_race_prevented" }),
      ]),
    );
  });

  it("rejects Development API approval for wallet-backed principals", async () => {
    await database.exec(
      `update mandates set principal_type = 'WALLET' where id = '${mandateId}'`,
    );
    const pending = action("01945b1e-7e80-7000-8000-000000000299", "f", "1");
    await store.createOrFind({
      id: pending.id,
      idempotencyKey: "wallet-approval",
      principalId,
      rawRequest: {},
      action: pending,
    });
    await store.recordDecision({
      executionId: pending.id,
      result: {
        ...allow("f"),
        decision: "REQUIRE_APPROVAL",
        approvalMode: "ASK_BEFORE_EXECUTION",
      },
      reserveAmount: "1",
      aggregateLimit: "10",
    });
    await expect(
      store.approve({
        executionId: pending.id,
        principalId,
        normalizedHash: pending.normalizedHash,
        approved: true,
      }),
    ).resolves.toBeNull();
  });
});
