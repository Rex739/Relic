import { readFile, readdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RelicDatabase } from "../src/client.js";
import { DrizzleOnboardingStore } from "../src/onboarding.js";
import * as schema from "../src/schema.js";

let database: PGlite;
let store: DrizzleOnboardingStore;
const registry = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const owner = "0x1111111111111111111111111111111111111111";
const principal = "01945b1e-7e80-7000-8000-000000000501";

beforeEach(async () => {
  database = new PGlite();
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory))
    .filter((item) => /^\d{4}_.+\.sql$/.test(item) && !item.startsWith("0008_"))
    .sort()) {
    let migration = await readFile(new URL(name, directory), "utf8");
    for (const marker of [
      "-- Mandates are server-side authorization records",
      "-- Execution control is server-side policy state",
      "-- Commerce and wallet-session state is server-side only",
      "ALTER TABLE public.authorization_challenges ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE public.seller_agent_authorizations ENABLE ROW LEVEL SECURITY",
    ])
      if (migration.includes(marker)) migration = migration.split(marker)[0]!;
    await database.exec(migration);
  }
  store = new DrizzleOnboardingStore(
    drizzle(database, { schema }) as unknown as RelicDatabase,
  );
});

afterEach(() => database.close());

const createSubmission = (relicPrincipalId = principal) =>
  store.createSubmission({
    chainId: 97,
    registryAddress: registry,
    externalAgentId: "2016",
    supplyType: "third_party",
    relicPrincipalId,
    liveOwner: owner,
    submitterAddress: "0x2222222222222222222222222222222222222222",
    evidence: { fixture: true },
  });

describe("seller ownership persistence", () => {
  it("atomically consumes one challenge and creates only management authorization", async () => {
    const submission = await createSubmission();
    const issuedAt = new Date("2026-08-30T12:00:00.000Z");
    const challenge = await store.createOwnershipChallenge({
      submissionId: submission.id,
      principalId: principal,
      chainId: 97,
      registryAddress: registry,
      externalAgentId: "2016",
      nonceHash: "fixture-nonce-hash",
      message: "fixture canonical message",
      expectedOwner: owner,
      issuedAt,
      expiresAt: new Date("2026-08-30T12:05:00.000Z"),
    });
    const consume = () =>
      store.consumeOwnershipChallengeAndAuthorize({
        challengeId: challenge.id,
        principalId: principal,
        submissionId: submission.id,
        chainId: 97,
        registryAddress: registry,
        externalAgentId: "2016",
        signerAddress: owner,
        signatureDigest: "fixture-signature-digest",
        verifiedAt: new Date("2026-08-30T12:01:00.000Z"),
      });
    const results = await Promise.all([consume(), consume()]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    const counts = await database.query<{
      authorizations: number;
      offers: number;
      agreements: number;
      reviews: number;
    }>(`
      select
        (select count(*)::int from seller_agent_authorizations) authorizations,
        (select count(*)::int from agent_offers) offers,
        (select count(*)::int from commerce_agreements) agreements,
        (select count(*)::int from marketplace_reviews) reviews
    `);
    expect(counts.rows[0]).toEqual({
      authorizations: 1,
      offers: 0,
      agreements: 0,
      reviews: 0,
    });
  });

  it("upserts one seller-managed marketplace profile per agent", async () => {
    const agentId = "01945b1e-7e80-7000-8000-000000000601";
    await database.exec(`
      insert into agents (id, name, description, metadata_uri)
      values (
        '${agentId}',
        'Relic Yield Scout',
        'Canonical ERC-8004 description',
        'https://example.com/agent.json'
      )
    `);
    await store.upsertSellerMarketplaceProfile({
      agentId,
      principalId: principal,
      description: "A clear buyer-facing marketplace description.",
      imageUrl: "https://example.com/profile.png",
      updatedAt: new Date("2026-08-31T23:00:00.000Z"),
    });
    const updated = await store.upsertSellerMarketplaceProfile({
      agentId,
      principalId: principal,
      description: "The revised buyer-facing marketplace description.",
      imageUrl: null,
      updatedAt: new Date("2026-08-31T23:05:00.000Z"),
    });
    expect(updated).toMatchObject({
      agentId,
      description: "The revised buyer-facing marketplace description.",
      imageUrl: null,
      updatedByPrincipalId: principal,
    });
    const result = await database.query<{
      count: number;
      description: string;
    }>(`
      select count(*)::int count, max(description) description
      from seller_marketplace_profiles
      where agent_id = '${agentId}'
    `);
    expect(result.rows[0]).toEqual({
      count: 1,
      description: "The revised buyer-facing marketplace description.",
    });
  });

  it("does not let another Relic principal overwrite an unchanged owner", async () => {
    await createSubmission();
    await expect(
      createSubmission("01945b1e-7e80-7000-8000-000000000502"),
    ).rejects.toThrow(/already bound to another Relic account/);
  });
});
