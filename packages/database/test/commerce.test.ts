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
const buyerAddress = "0x4444444444444444444444444444444444444444";
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
    if (name.startsWith("0018_"))
      migration = migration.split(
        "ALTER TABLE public.seller_agent_authorizations ENABLE ROW LEVEL SECURITY",
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

async function authorizedExecution() {
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
  const authorizationId = "01945b1e-7e80-7000-8000-000000000320";
  const executionId = "01945b1e-7e80-7000-8000-000000000321";
  await database.exec(`
    update commerce_agreements
      set status = 'AUTHORIZED', authorization_artifact_id = null
      where id = '${agreement!.id}';
    insert into authorization_artifacts
      (id, principal_id, agreement_id, mandate_id, mandate_version,
       authorization_type, signer_address, chain_id, normalized_payload,
       signature, message_hash, terms_hash, nonce_hash, verification_status,
       evidence_reference, expires_at)
      values
      ('${authorizationId}', '${buyer}', '${agreement!.id}', '${mandateId}', 1,
       'WALLET_SIGNATURE', '${buyerAddress}', 97, '{}', '0x01',
       '0x${"ab".repeat(32)}', '${agreement!.termsHash}', 'nonce-activation',
       'VERIFIED', '{}', now() + interval '1 hour');
    update commerce_agreements
      set authorization_artifact_id = '${authorizationId}'
      where id = '${agreement!.id}';
    insert into execution_requests
      (id, mandate_id, mandate_version, agent_id, principal_id, chain_id,
       idempotency_key, raw_request, normalized_action, normalized_hash,
       status, decision, decision_reasons, deadline)
      values
      ('${executionId}', '${mandateId}', 1, '${agentId}', '${buyer}', 97,
       'real-buyer-observation', '{}', '{}', '${"cd".repeat(32)}',
       'SUCCEEDED', 'ALLOW', '[]', now() + interval '5 minutes');
  `);
  return { agreement: agreement!, authorizationId, executionId };
}

async function completedMarketplaceActivation() {
  const fixture = await authorizedExecution();
  const activation = await store.createUserCommerceActivation({
    agreementId: fixture.agreement.id,
    executionRequestId: fixture.executionId,
    authorizationId: fixture.authorizationId,
    commerceAddress: "0x5555555555555555555555555555555555555555",
    clientAddress: buyerAddress,
    evaluatorAddress: "0x6666666666666666666666666666666666666666",
  });
  await database.exec(`
    update activations
      set lifecycle_state = 'COMPLETED', status = 'COMPLETED',
          reconciliation_state = 'CURRENT', provider_address = '${owner}'
      where id = '${activation.id}';
    insert into marketplace_outcomes
      (activation_id, agent_id, service_id, invocation_successful,
       commerce_successful, settlement_state, observed_cost, protocol_evidence)
    values
      ('${activation.id}', '${agentId}', '${serviceId}', true, true,
       'NONE', '0', '{"source":"completed-marketplace-fixture"}');
    insert into commerce_operations
      (agreement_id, activation_id, execution_request_id, operation_type,
       state, idempotency_key, attempt)
    values
      ('${fixture.agreement.id}', '${activation.id}', '${fixture.executionId}',
       'FUND', 'FINALIZED', 'review-fixture:fund:${activation.id}', 1);
  `);
  return { ...fixture, activation };
}

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

  it("allows a verified seller to create an offer before commerce validation", async () => {
    await database.exec(
      `update launch_candidates set status = 'INVOCATION_VERIFIED' where agent_id = '${agentId}'`,
    );
    const offer = await store.createOffer({
      operatorPrincipalId: operator,
      operatorAddress: owner,
      request: request(),
    });
    expect(offer).toMatchObject({
      status: "DRAFT",
      agentId,
      serviceId,
    });
    await expect(
      store.createOffer({
        operatorPrincipalId: operator,
        operatorAddress: owner,
        request: request(),
      }),
    ).rejects.toThrow(/current offer already exists/i);
  });

  it("lists active offers through the seller authorization guard", async () => {
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

    await expect(store.activeOffersForAgent(agentId)).resolves.toMatchObject([
      { id: offer!.id, status: "ACTIVE" },
    ]);
  });

  it("creates generic paid validation handoffs from the active offer snapshot", async () => {
    const offer = await store.createOffer({
      operatorPrincipalId: operator,
      operatorAddress: owner,
      request: {
        ...request(),
        capability: "Yield optimisation",
        capabilitySnapshot: ["compare_yield_opportunities"],
        price: {
          chainId: 97,
          tokenAddress: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
          decimals: 18,
          amountBaseUnits: "1000000000",
          symbol: "U",
        },
        terms: "Return a deterministic yield comparison artifact.",
      },
    });
    await store.activateOffer({
      offerId: offer!.id,
      operatorPrincipalId: operator,
      operatorAddress: owner,
    });
    const first = await store.createCommerceValidationSession({
      offerId: offer!.id,
      sellerPrincipalId: operator,
      handoffTokenHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    expect(first).toMatchObject({
      session: {
        offerId: offer!.id,
        offerVersionId: offer!.version.id,
        agentId,
        serviceId,
        chainId: 97,
        status: "OPEN",
      },
      offer: {
        version: {
          capability: "Yield optimisation",
          price: { amountBaseUnits: "1000000000", symbol: "U" },
        },
      },
    });
    const second = await store.createCommerceValidationSession({
      offerId: offer!.id,
      sellerPrincipalId: operator,
      handoffTokenHash: "b".repeat(64),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    expect(
      await store.commerceValidationSession({
        sessionId: first.session.id,
        handoffTokenHash: "a".repeat(64),
      }),
    ).toMatchObject({ status: "CANCELLED" });
    expect(
      await store.commerceValidationSession({
        sessionId: second.session.id,
        handoffTokenHash: "b".repeat(64),
      }),
    ).toMatchObject({ status: "OPEN" });
    await expect(
      store.claimCommerceValidationSession({
        sessionId: second.session.id,
        handoffTokenHash: "b".repeat(64),
        buyerPrincipalId: operator,
        buyerAddress: owner,
        chainId: 97,
      }),
    ).rejects.toThrow(/seller wallet cannot act as the validation buyer/i);
    const claimed = await store.claimCommerceValidationSession({
      sessionId: second.session.id,
      handoffTokenHash: "b".repeat(64),
      buyerPrincipalId: buyer,
      buyerAddress,
      chainId: 97,
    });
    expect(claimed).toMatchObject({
      status: "CLAIMED",
      buyerPrincipalId: buyer,
    });
    await expect(
      store.claimCommerceValidationSession({
        sessionId: second.session.id,
        handoffTokenHash: "b".repeat(64),
        buyerPrincipalId: buyer,
        buyerAddress,
        chainId: 97,
      }),
    ).resolves.toMatchObject({ id: second.session.id, status: "CLAIMED" });
    const prepared = await store.prepareCommerceValidationSession({
      sessionId: second.session.id,
      handoffTokenHash: "b".repeat(64),
      buyerPrincipalId: buyer,
    });
    expect(prepared).toMatchObject({
      status: "CLAIMED",
      buyerPrincipalId: buyer,
    });
    expect(typeof prepared.mandateId).toBe("string");
    expect(typeof prepared.agreementId).toBe("string");
    await expect(
      store.prepareCommerceValidationSession({
        sessionId: second.session.id,
        handoffTokenHash: "b".repeat(64),
        buyerPrincipalId: buyer,
      }),
    ).resolves.toMatchObject({
      mandateId: prepared.mandateId,
      agreementId: prepared.agreementId,
    });
    const validation = await database.query<{
      mandate_status: string;
      approval_mode: string;
      allowed_capabilities: string[];
      agreement_status: string;
      session_expires_at: Date;
      mandate_expires_at: Date;
      agreement_expires_at: Date;
      price: string;
      terms_hash: string;
      operations: number;
      outcomes: number;
    }>(`
      select m.status mandate_status,
             mv.approval_mode,
             mv.allowed_capabilities,
             ca.status agreement_status,
             cvs.expires_at session_expires_at,
             mv.expires_at mandate_expires_at,
             ca.expires_at agreement_expires_at,
             ca.amount_base_units::text price,
             ca.terms_hash,
             (select count(*)::int from commerce_operations co where co.agreement_id = ca.id) operations,
             (select count(*)::int from marketplace_outcomes mo where mo.activation_id in
               (select a.id from activations a where a.commerce_agreement_id = ca.id)) outcomes
        from commerce_validation_sessions cvs
        join mandates m on m.id = cvs.mandate_id
        join mandate_versions mv on mv.mandate_id = m.id and mv.version = m.active_version
        join commerce_agreements ca on ca.id = cvs.agreement_id
       where cvs.id = '${second.session.id}'
    `);
    expect(validation.rows).toEqual([
      expect.objectContaining({
        mandate_status: "ACTIVE",
        approval_mode: "OBSERVE_ONLY",
        allowed_capabilities: [
          "Yield optimisation",
          "compare_yield_opportunities",
        ],
        agreement_status: "DRAFT",
        price: "1000000000",
        terms_hash: offer!.version.termsHash,
        operations: 0,
        outcomes: 0,
      }),
    ]);
    expect(validation.rows[0]!.mandate_expires_at.getTime()).toBeGreaterThan(
      validation.rows[0]!.session_expires_at.getTime(),
    );
    expect(validation.rows[0]!.agreement_expires_at).toEqual(
      validation.rows[0]!.mandate_expires_at,
    );
    const authorizationId = "01945b1e-7e80-7000-8000-000000000398";
    await database.exec(`
      insert into authorization_artifacts
        (id, principal_id, agreement_id, mandate_id, mandate_version,
         authorization_type, signer_address, chain_id, normalized_payload,
         signature, message_hash, terms_hash, nonce_hash, verification_status,
         evidence_reference, expires_at)
      values
        ('${authorizationId}', '${buyer}', '${prepared.agreementId}', '${prepared.mandateId}', 1,
         'WALLET_SIGNATURE', '${buyerAddress}', 97, '{}', '0x01',
         '0x${"ab".repeat(32)}', '${offer!.version.termsHash}', 'validation-activation',
         'VERIFIED', '{}', now() + interval '1 hour');
      update commerce_agreements
         set status = 'AUTHORIZED', authorization_artifact_id = '${authorizationId}'
       where id = '${prepared.agreementId}';
    `);
    const activation = await store.prepareCommerceValidationActivation({
      agreementId: prepared.agreementId!,
      principalId: buyer,
      clientAddress: buyerAddress,
      commerceAddress: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
      evaluatorAddress: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
      providerAddress: owner,
      approvalPayloadHash: `0x${"12".repeat(32)}`,
      approvalEvidence: {
        commerceValidation: true,
        amountBaseUnits: "1000000000",
        transactionSubmitted: false,
      },
    });
    expect(activation).toMatchObject({
      purpose: "VERIFICATION",
      marketplaceHistoryEligible: false,
      lifecycleState: "PREPARING",
      budgetBaseUnits: "1000000000",
      executionRequestId: null,
    });
    const activatedAgreement = await store.findAgreement(
      prepared.agreementId!,
      buyer,
    );
    expect(activatedAgreement).toMatchObject({ status: "ACTIVE" });
    expect(activatedAgreement?.operations).toHaveLength(1);
    const approval = activatedAgreement!.operations[0]!;
    expect(approval).toMatchObject({
      operationType: "APPROVE_TOKEN",
      state: "AWAITING_SIGNATURE",
      transactionHash: null,
    });
    expect(approval.evidence).toMatchObject({
      commerceValidation: true,
      transactionSubmitted: false,
    });
    expect(activatedAgreement?.movements).toHaveLength(0);
    expect(activatedAgreement?.settlements).toHaveLength(0);
    await expect(
      store.createCommerceValidationSession({
        offerId: offer!.id,
        sellerPrincipalId: buyer,
        handoffTokenHash: "c".repeat(64),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      }),
    ).rejects.toThrow(/owned by this seller/i);
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

  it("deduplicates operations, leases them once, and never records zero-value protocol transitions as money", async () => {
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
    const nextAttempt = await store.createOperation({
      agreementId: agreement!.id,
      operationType: "CREATE_JOB",
      idempotencyKey: "job-replacement-once",
      state: "CREATED",
    });
    expect(first.attempt).toBe(1);
    expect(nextAttempt.attempt).toBe(2);
    expect(
      (
        await store.createOperation({
          agreementId: agreement!.id,
          operationType: "CREATE_JOB",
          idempotencyKey: "job-replacement-once",
          state: "CREATED",
        })
      ).id,
    ).toBe(nextAttempt.id);
    const [left, right] = await Promise.all([
      store.leaseOperations({ workerId: "left", limit: 1, leaseSeconds: 60 }),
      store.leaseOperations({ workerId: "right", limit: 1, leaseSeconds: 60 }),
    ]);
    expect(left.length + right.length).toBe(1);
    const firstLease = left[0] ?? right[0];
    const firstWorker = left.length === 1 ? "left" : "right";
    expect(firstLease).toBeDefined();
    await store.transitionOperation({
      id: String(firstLease!.id),
      workerId: firstWorker,
      from: ["READY"],
      to: "CONFIRMED",
      transactionHash: `0x${"cd".repeat(32)}`,
      blockNumber: 100n,
      blockHash: `0x${"ef".repeat(32)}`,
      confirmationCount: 5,
      finalityState: "CONFIRMED",
      nextAttemptAt: new Date(Date.now() - 1_000),
    });
    const confirmedLease = await store.leaseOperations({
      workerId: "finality-worker",
      operationId: String(firstLease!.id),
      limit: 1,
      leaseSeconds: 60,
    });
    expect(confirmedLease).toHaveLength(1);
    expect(confirmedLease[0]).toMatchObject({ state: "CONFIRMED" });
    const zeroMovement = {
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
    await expect(store.recordValueMovement(zeroMovement)).rejects.toThrow(
      /must be positive/i,
    );
    const movement = { ...zeroMovement, amountBaseUnits: "1" };
    expect(await store.recordValueMovement(movement)).not.toBeNull();
    expect(await store.recordValueMovement(movement)).toBeNull();
  });

  it("records one wallet hash atomically and rejects a competing hash", async () => {
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
    const preparedPayloadHash = `0x${"12".repeat(32)}`;
    const operation = await store.createOperation({
      agreementId: agreement!.id,
      operationType: "REGISTER_JOB",
      idempotencyKey: "register-job-once",
      state: "AWAITING_SIGNATURE",
      preparedPayloadHash,
    });
    const transactionHash = `0x${"34".repeat(32)}`;
    const input = {
      operationId: operation.id,
      agreementId: agreement!.id,
      principalId: buyer,
      signerAddress: buyerAddress,
      preparedPayloadHash,
      transactionHash,
      nonce: 7n,
    };
    await expect(
      store.recordWalletSubmittedOperation(input),
    ).resolves.toMatchObject({
      operationType: "REGISTER_JOB",
      state: "SUBMITTED",
      transactionHash,
      signerAddress: buyerAddress,
      nonce: 7n,
    });
    await expect(
      store.recordWalletSubmittedOperation(input),
    ).resolves.toMatchObject({ transactionHash });
    await expect(
      store.recordWalletSubmittedOperation({
        ...input,
        transactionHash: `0x${"56".repeat(32)}`,
      }),
    ).rejects.toThrow(/different transaction hash/i);
    const persisted = await store.findAgreement(agreement!.id, buyer);
    expect(persisted?.operations[0]).toMatchObject({
      nonce: "7",
      blockNumber: null,
    });
    expect(() => JSON.stringify(persisted)).not.toThrow();
  });

  it("records one SET_BUDGET wallet hash atomically", async () => {
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
    const preparedPayloadHash = `0x${"78".repeat(32)}`;
    const operation = await store.createOperation({
      agreementId: agreement!.id,
      operationType: "SET_BUDGET",
      idempotencyKey: "set-zero-budget-once",
      state: "AWAITING_SIGNATURE",
      preparedPayloadHash,
    });
    const transactionHash = `0x${"90".repeat(32)}`;
    const input = {
      operationId: operation.id,
      agreementId: agreement!.id,
      principalId: buyer,
      signerAddress: buyerAddress,
      preparedPayloadHash,
      transactionHash,
      nonce: 2n,
    };
    await expect(
      store.recordWalletSubmittedOperation(input),
    ).resolves.toMatchObject({
      operationType: "SET_BUDGET",
      state: "SUBMITTED",
      transactionHash,
      signerAddress: buyerAddress,
      nonce: 2n,
    });
    await expect(
      store.recordWalletSubmittedOperation(input),
    ).resolves.toMatchObject({ transactionHash });
    await expect(
      store.recordWalletSubmittedOperation({
        ...input,
        transactionHash: `0x${"91".repeat(32)}`,
      }),
    ).rejects.toThrow(/different transaction hash/i);
  });

  it("records one FUND wallet hash atomically", async () => {
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
    const preparedPayloadHash = `0x${"79".repeat(32)}`;
    const operation = await store.createOperation({
      agreementId: agreement!.id,
      operationType: "FUND",
      idempotencyKey: "fund-zero-budget-once",
      state: "AWAITING_SIGNATURE",
      preparedPayloadHash,
    });
    const transactionHash = `0x${"92".repeat(32)}`;
    const input = {
      operationId: operation.id,
      agreementId: agreement!.id,
      principalId: buyer,
      signerAddress: buyerAddress,
      preparedPayloadHash,
      transactionHash,
      nonce: 3n,
    };
    await expect(
      store.recordWalletSubmittedOperation(input),
    ).resolves.toMatchObject({
      operationType: "FUND",
      state: "SUBMITTED",
      transactionHash,
      signerAddress: buyerAddress,
      nonce: 3n,
    });
    await expect(
      store.recordWalletSubmittedOperation(input),
    ).resolves.toMatchObject({ transactionHash });
    await expect(
      store.recordWalletSubmittedOperation({
        ...input,
        transactionHash: `0x${"93".repeat(32)}`,
      }),
    ).rejects.toThrow(/different transaction hash/i);
  });

  it("projects finalized zero-value FUND into an active activation without economic movement", async () => {
    const fixture = await authorizedExecution();
    const activation = await store.createUserCommerceActivation({
      agreementId: fixture.agreement.id,
      executionRequestId: fixture.executionId,
      authorizationId: fixture.authorizationId,
      commerceAddress: "0x5555555555555555555555555555555555555555",
      clientAddress: buyerAddress,
      evaluatorAddress: "0x6666666666666666666666666666666666666666",
    });
    await store.transitionCommerceActivation({
      activationId: activation.id,
      from: "PREPARING",
      to: "ONCHAIN_CREATED",
      externalJobId: "647",
      reconciliationState: "CURRENT",
      evidence: { source: "test-create-job" },
    });
    const transactionHash = `0x${"94".repeat(32)}`;
    const operation = await store.createOperation({
      agreementId: fixture.agreement.id,
      activationId: activation.id,
      executionRequestId: fixture.executionId,
      operationType: "FUND",
      idempotencyKey: `activation:${activation.id}:fund:647`,
      state: "AWAITING_SIGNATURE",
      preparedPayloadHash: `0x${"95".repeat(32)}`,
      evidence: { budgetBaseUnits: "0", fundsMoved: false },
    });
    await store.recordWalletSubmittedOperation({
      operationId: operation.id,
      agreementId: fixture.agreement.id,
      principalId: buyer,
      signerAddress: buyerAddress,
      preparedPayloadHash: operation.preparedPayloadHash!,
      transactionHash,
      nonce: 14n,
    });
    await store.leaseOperations({
      workerId: "fund-finality-worker",
      operationId: operation.id,
      limit: 1,
      leaseSeconds: 60,
    });
    await store.finalizeSetupOperation({
      id: operation.id,
      workerId: "fund-finality-worker",
      from: ["SUBMITTED"],
      transactionHash,
      blockNumber: 127178300n,
      blockHash: `0x${"96".repeat(32)}`,
      confirmationCount: 15,
      evidence: { receiptStatus: "success" },
    });
    expect(
      await store.walletOperationActivation({
        activationId: activation.id,
        agreementId: fixture.agreement.id,
        principalId: buyer,
      }),
    ).toMatchObject({
      lifecycleState: "ACTIVE",
      status: "FUNDED",
      reconciliationState: "CURRENT",
      budget: "0",
      failure: null,
    });
    const persisted = await store.findAgreement(fixture.agreement.id, buyer);
    expect(persisted).toMatchObject({ status: "ACTIVE" });
    expect(persisted?.movements).toHaveLength(0);
    expect(persisted?.settlements).toHaveLength(0);
  });

  it("persists one immutable provider delivery and one unsubmitted provider operation", async () => {
    const fixture = await authorizedExecution();
    const activation = await store.createUserCommerceActivation({
      agreementId: fixture.agreement.id,
      executionRequestId: fixture.executionId,
      authorizationId: fixture.authorizationId,
      commerceAddress: "0x5555555555555555555555555555555555555555",
      clientAddress: buyerAddress,
      evaluatorAddress: "0x6666666666666666666666666666666666666666",
    });
    await database.exec(`
      update activations
      set lifecycle_state = 'ACTIVE', status = 'FUNDED', reconciliation_state = 'CURRENT',
          external_job_id = '647', provider_address = '${owner}'
      where id = '${activation.id}';
      update commerce_agreements set status = 'ACTIVE'
      where id = '${fixture.agreement.id}';
    `);
    const input = {
      agreementId: fixture.agreement.id,
      activationId: activation.id,
      executionRequestId: fixture.executionId,
      externalJobId: "647",
      providerAddress: owner,
      idempotencyKey: `activation:${activation.id}:submit-delivery:647`,
      manifestHash: `0x${"61".repeat(32)}`,
      manifestReference: "https://example.invalid/erc8183/job/647/response",
      manifest: {
        version: 1,
        job_id: 647,
        response: { riskLevel: "critical" },
      },
      observedAt: new Date("2026-08-25T12:00:00.000Z"),
      preparedPayloadHash: `0x${"62".repeat(32)}`,
      operationEvidence: {
        contract: "0x5555555555555555555555555555555555555555",
        functionName: "submit",
      },
    };
    const prepared = await store.prepareProviderDelivery(input);
    const replay = await store.prepareProviderDelivery(input);
    expect(replay.artifact.id).toBe(prepared.artifact.id);
    expect(replay.operation.id).toBe(prepared.operation.id);
    expect(prepared.artifact).toMatchObject({
      artifactType: "DELIVERY",
      contentHash: input.manifestHash,
      provenance: "independently_observed",
    });
    expect(prepared.operation).toMatchObject({
      operationType: "SUBMIT_DELIVERY",
      state: "AWAITING_SIGNATURE",
      signerAddress: owner,
      transactionHash: null,
    });
    const agreement = await store.findAgreement(fixture.agreement.id, buyer);
    expect(agreement?.movements).toHaveLength(0);
    expect(agreement?.settlements).toHaveLength(0);
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

  it("binds one idempotent USER_COMMERCE activation to the buyer agreement, mandate, execution, and authorization", async () => {
    const fixture = await authorizedExecution();
    const input = {
      agreementId: fixture.agreement.id,
      executionRequestId: fixture.executionId,
      authorizationId: fixture.authorizationId,
      commerceAddress: "0x5555555555555555555555555555555555555555",
      clientAddress: buyerAddress,
      evaluatorAddress: "0x6666666666666666666666666666666666666666",
    };
    const activation = await store.createUserCommerceActivation(input);
    const replay = await store.createUserCommerceActivation(input);
    expect(replay.id).toBe(activation.id);
    expect(activation).toMatchObject({
      purpose: "USER_COMMERCE",
      marketplaceHistoryEligible: true,
      commerceAgreementId: fixture.agreement.id,
      executionRequestId: fixture.executionId,
      mandateId,
      mandateVersion: 1,
      principalId: buyer,
      authorizationId: fixture.authorizationId,
      clientAddress: buyerAddress,
      providerAddress: owner,
      budgetBaseUnits: "0",
    });
    const persisted = await store.findAgreement(fixture.agreement.id, buyer);
    expect(persisted!.operations).toHaveLength(1);
    expect(persisted!.operations[0]).toMatchObject({
      operationType: "PREPARE_JOB",
      state: "CREATED",
      executionRequestId: fixture.executionId,
    });
  });

  it("atomically finalizes CREATE_JOB and projects its activation without losing evidence", async () => {
    const fixture = await authorizedExecution();
    const activation = await store.createUserCommerceActivation({
      agreementId: fixture.agreement.id,
      executionRequestId: fixture.executionId,
      authorizationId: fixture.authorizationId,
      commerceAddress: "0x5555555555555555555555555555555555555555",
      clientAddress: buyerAddress,
      evaluatorAddress: "0x6666666666666666666666666666666666666666",
    });
    const preparedPayloadHash = `0x${"12".repeat(32)}`;
    const transactionHash = `0x${"34".repeat(32)}`;
    const operation = await store.createOperation({
      agreementId: fixture.agreement.id,
      activationId: activation.id,
      executionRequestId: fixture.executionId,
      operationType: "CREATE_JOB",
      idempotencyKey: `activation:${activation.id}:create-job`,
      state: "AWAITING_SIGNATURE",
      preparedPayloadHash,
      evidence: { preparationProvenance: "preserved" },
    });
    await store.recordWalletSubmittedOperation({
      operationId: operation.id,
      agreementId: fixture.agreement.id,
      principalId: buyer,
      signerAddress: buyerAddress,
      preparedPayloadHash,
      transactionHash,
      nonce: 2n,
    });
    const [leased] = await store.leaseOperations({
      workerId: "create-finality-worker",
      operationId: operation.id,
      limit: 1,
      leaseSeconds: 60,
    });
    expect(leased).toBeDefined();
    const finalized = await store.finalizeCreateJobOperation({
      id: operation.id,
      workerId: "create-finality-worker",
      from: ["SUBMITTED"],
      transactionHash,
      blockNumber: 127035676n,
      blockHash: `0x${"56".repeat(32)}`,
      confirmationCount: 15,
      externalJobId: "618",
      evidence: { receiptStatus: "success" },
      nextOperation: {
        operationType: "REGISTER_JOB",
        idempotencyKey: `activation:${activation.id}:register-job:618`,
        state: "AWAITING_SIGNATURE",
        preparedPayloadHash: `0x${"78".repeat(32)}`,
        evidence: {
          setupSession: true,
          quoteExpiresAt: 1_787_632_200,
        },
      },
    });
    expect(finalized?.operation).toMatchObject({
      state: "FINALIZED",
      finalityState: "FINALIZED",
      transactionHash,
      confirmationCount: 15,
      evidence: {
        preparationProvenance: "preserved",
        receiptStatus: "success",
        externalJobId: "618",
      },
    });
    expect(finalized?.activation).toMatchObject({
      lifecycleState: "ONCHAIN_CREATED",
      reconciliationState: "CURRENT",
      externalJobId: "618",
    });
    const persisted = await store.findAgreement(fixture.agreement.id, buyer);
    const registerOperation = persisted?.operations.find(
      ({ operationType }) => operationType === "REGISTER_JOB",
    );
    expect(registerOperation).toMatchObject({
      state: "AWAITING_SIGNATURE",
      transactionHash: null,
      evidence: { setupSession: true },
    });
    await store.recordWalletSubmittedOperation({
      operationId: registerOperation!.id,
      agreementId: fixture.agreement.id,
      principalId: buyer,
      signerAddress: buyerAddress,
      preparedPayloadHash: registerOperation!.preparedPayloadHash!,
      transactionHash: `0x${"9a".repeat(32)}`,
      nonce: 3n,
    });
    await store.leaseOperations({
      workerId: "setup-finality-worker",
      operationId: registerOperation!.id,
      limit: 1,
      leaseSeconds: 60,
    });
    await store.finalizeSetupOperation({
      id: registerOperation!.id,
      workerId: "setup-finality-worker",
      from: ["SUBMITTED"],
      transactionHash: `0x${"9a".repeat(32)}`,
      blockNumber: 127035691n,
      blockHash: `0x${"bc".repeat(32)}`,
      confirmationCount: 15,
      evidence: { receiptStatus: "success" },
      nextOperation: {
        operationType: "SET_BUDGET",
        idempotencyKey: `activation:${activation.id}:set-budget:618`,
        state: "AWAITING_SIGNATURE",
        preparedPayloadHash: `0x${"de".repeat(32)}`,
        evidence: { setupSession: true, quoteExpiresAt: 1_787_632_200 },
      },
    });
    const afterRegister = await store.findAgreement(
      fixture.agreement.id,
      buyer,
    );
    expect(
      afterRegister?.operations.find(
        ({ operationType }) => operationType === "SET_BUDGET",
      ),
    ).toMatchObject({ state: "AWAITING_SIGNATURE", transactionHash: null });
    const setBudgetOperation = afterRegister?.operations.find(
      ({ operationType }) => operationType === "SET_BUDGET",
    );
    await store.recordWalletSubmittedOperation({
      operationId: setBudgetOperation!.id,
      agreementId: fixture.agreement.id,
      principalId: buyer,
      signerAddress: buyerAddress,
      preparedPayloadHash: setBudgetOperation!.preparedPayloadHash!,
      transactionHash: `0x${"12".repeat(32)}`,
      nonce: 4n,
    });
    await store.leaseOperations({
      workerId: "expired-fund-window-worker",
      operationId: setBudgetOperation!.id,
      limit: 1,
      leaseSeconds: 60,
    });
    await store.finalizeSetupOperation({
      id: setBudgetOperation!.id,
      workerId: "expired-fund-window-worker",
      from: ["SUBMITTED"],
      transactionHash: `0x${"12".repeat(32)}`,
      blockNumber: 127035706n,
      blockHash: `0x${"34".repeat(32)}`,
      confirmationCount: 15,
      evidence: { receiptStatus: "success" },
      nextOperation: {
        operationType: "FUND",
        idempotencyKey: `activation:${activation.id}:fund:618`,
        state: "CANCELLED",
        preparedPayloadHash: `0x${"56".repeat(32)}`,
        failure: {
          code: "SIGNED_QUOTE_WINDOW_UNSAFE",
          remainingSeconds: 30,
          requiredSeconds: 120,
        },
        evidence: { setupSession: true, quoteExpiresAt: 1_787_632_200 },
      },
    });
    const failedActivation = await store.walletOperationActivation({
      activationId: activation.id,
      agreementId: fixture.agreement.id,
      principalId: buyer,
    });
    expect(failedActivation).toMatchObject({
      lifecycleState: "FAILED",
      reconciliationState: "FAILED",
      failure: {
        code: "SIGNED_QUOTE_WINDOW_UNSAFE",
        failedAfterOperation: "SET_BUDGET",
        fundsMoved: false,
        settlementCreated: false,
      },
    });
    const afterExpiry = await store.findAgreement(fixture.agreement.id, buyer);
    expect(afterExpiry).toMatchObject({ status: "ACTIVE" });
    expect(
      afterExpiry?.operations.find(
        ({ operationType }) => operationType === "FUND",
      ),
    ).toMatchObject({ state: "CANCELLED", transactionHash: null });
    expect(persisted?.movements).toHaveLength(0);
    expect(persisted?.settlements).toHaveLength(0);
  });

  it("closes an expired onchain attempt without failing its reusable agreement or inventing movement", async () => {
    const fixture = await authorizedExecution();
    const activation = await store.createUserCommerceActivation({
      agreementId: fixture.agreement.id,
      executionRequestId: fixture.executionId,
      authorizationId: fixture.authorizationId,
      commerceAddress: "0x5555555555555555555555555555555555555555",
      clientAddress: buyerAddress,
      evaluatorAddress: "0x6666666666666666666666666666666666666666",
    });
    await store.transitionCommerceActivation({
      activationId: activation.id,
      from: "PREPARING",
      to: "ONCHAIN_CREATED",
      externalJobId: "608",
      reconciliationState: "CURRENT",
      evidence: { source: "test-create-job" },
    });
    const operation = await store.createOperation({
      agreementId: fixture.agreement.id,
      activationId: activation.id,
      executionRequestId: fixture.executionId,
      operationType: "SET_BUDGET",
      idempotencyKey: `activation:${activation.id}:set-budget:608`,
      state: "AWAITING_SIGNATURE",
      preparedPayloadHash: `0x${"12".repeat(32)}`,
      evidence: { jobId: "608", transactionSubmitted: false },
    });
    const observedAt = new Date("2026-08-24T21:47:05.000Z");
    const input = {
      activationId: activation.id,
      operationId: operation.id,
      externalJobId: "608",
      observedAt,
      observedBlock: 127025736n,
      observedBlockHash: `0x${"34".repeat(32)}`,
      jobExpiry: new Date("2026-08-24T19:22:55.000Z"),
      evidence: {
        jobState: "OPEN",
        policyRegistered: true,
        budgetBaseUnits: "0",
        jobHasBudget: false,
        funded: false,
        submittedAt: "0",
      },
    };
    const closed = await store.expireUnsubmittedCommerceAttempt(input);
    const replay = await store.expireUnsubmittedCommerceAttempt(input);
    expect(closed.activation).toMatchObject({
      lifecycleState: "FAILED",
      reconciliationState: "FAILED",
      externalJobId: "608",
    });
    expect(closed.operation).toMatchObject({
      state: "CANCELLED",
      transactionHash: null,
    });
    expect(replay.operation.id).toBe(operation.id);
    const persisted = await store.findAgreement(fixture.agreement.id, buyer);
    expect(persisted).toMatchObject({ status: "ACTIVE" });
    expect(persisted!.movements).toHaveLength(0);
    expect(persisted!.settlements).toHaveLength(0);
    expect(
      persisted!.operations.find((item) => item.id === operation.id),
    ).toMatchObject({ state: "CANCELLED", transactionHash: null });

    const replacementExecutionId = "01945b1e-7e80-7000-8000-000000000322";
    const replacementHash = `0x${"ef".repeat(32)}` as const;
    await database.exec(`
      insert into execution_requests
        (id, mandate_id, mandate_version, agent_id, principal_id, chain_id,
         idempotency_key, raw_request, normalized_action, normalized_hash,
         status, decision, decision_reasons, deadline)
        values
        ('${replacementExecutionId}', '${mandateId}', 1, '${agentId}', '${buyer}', 97,
         'expired-job-replacement', '{}',
         '{"parameters":{"account":"0x2A1317EC5fb5557A4cAd0B97fd851630aD8EDA87"}}',
         '${replacementHash.slice(2)}', 'SUCCEEDED', 'ALLOW', '[]',
         now() + interval '30 minutes');
    `);
    const authorization = await store.recordAuthorization({
      principalId: buyer,
      signerAddress: buyerAddress,
      authorization: {
        agreementId: fixture.agreement.id,
        principal: buyerAddress,
        agentId,
        mandateId,
        mandateVersion: 1,
        offerVersionId: fixture.agreement.offerVersionId,
        termsHash: fixture.agreement.termsHash,
        actionHash: replacementHash,
        tokenAddress: "0x0000000000000000000000000000000000000000",
        amountBaseUnits: "0",
        chainId: 97,
        nonce: "expired-job-replacement-nonce",
        expiresAt: String(Math.floor(Date.now() / 1_000) + 3_600),
      },
      signature: "0x01",
      messageHash: `0x${"ab".repeat(32)}`,
      nonceHash: "expired-job-replacement-nonce-hash",
      evidenceReference: { source: "test-expired-job-recovery" },
    });
    const replacement = await store.createUserCommerceActivation({
      agreementId: fixture.agreement.id,
      executionRequestId: replacementExecutionId,
      authorizationId: authorization.artifactId,
      commerceAddress: "0x5555555555555555555555555555555555555555",
      clientAddress: buyerAddress,
      evaluatorAddress: "0x6666666666666666666666666666666666666666",
    });
    expect(replacement.id).not.toBe(activation.id);
    const recovered = await store.findAgreement(fixture.agreement.id, buyer);
    expect(recovered).toMatchObject({ status: "ACTIVE" });
    expect(
      recovered!.operations.find(
        (item) =>
          item.activationId === replacement.id &&
          item.operationType === "CREATE_JOB",
      ),
    ).toMatchObject({
      state: "AWAITING_SIGNATURE",
      transactionHash: null,
      executionRequestId: replacementExecutionId,
    });
  });

  it("records exact wallet approval for a completed read-only action without rewriting execution history", async () => {
    const fixture = await authorizedExecution();
    const actionHash = `0x${"cd".repeat(32)}` as const;
    const authorization = {
      agreementId: fixture.agreement.id,
      principal: buyerAddress,
      agentId,
      mandateId,
      mandateVersion: 1,
      offerVersionId: fixture.agreement.offerVersionId,
      termsHash: fixture.agreement.termsHash,
      actionHash,
      tokenAddress: "0x0000000000000000000000000000000000000000" as const,
      amountBaseUnits: "0",
      chainId: 97 as const,
      nonce: "completed-read-only-action-nonce",
      expiresAt: String(Math.floor(Date.now() / 1_000) + 600),
    };
    const recorded = await store.recordAuthorization({
      principalId: buyer,
      signerAddress: buyerAddress,
      authorization,
      signature: "0x01",
      messageHash: `0x${"ef".repeat(32)}`,
      nonceHash: "completed-read-only-action-nonce-hash",
      evidenceReference: { source: "test-eip712-recovery" },
    });
    expect(recorded.artifactId).toBeTruthy();
    const execution = await database.query(
      `select status from execution_requests where id = '${fixture.executionId}'`,
    );
    expect(execution.rows[0]).toMatchObject({ status: "SUCCEEDED" });
    const refreshed = await store.recordAuthorization({
      principalId: buyer,
      signerAddress: buyerAddress,
      authorization: {
        ...authorization,
        nonce: "completed-read-only-action-refresh-nonce",
      },
      signature: "0x01",
      messageHash: `0x${"aa".repeat(32)}`,
      nonceHash: "completed-read-only-action-refresh-nonce-hash",
      evidenceReference: { source: "test-authorization-refresh" },
    });
    expect(refreshed.artifactId).not.toBe(recorded.artifactId);
    const approvals = await database.query(
      `select id from execution_approvals where execution_request_id = '${fixture.executionId}'`,
    );
    expect(approvals.rows).toHaveLength(1);
  });

  it("fails a funded attempt outside its signed quote window without rewriting observed provider work", async () => {
    const fixture = await authorizedExecution();
    const activation = await store.createUserCommerceActivation({
      agreementId: fixture.agreement.id,
      executionRequestId: fixture.executionId,
      authorizationId: fixture.authorizationId,
      commerceAddress: "0x5555555555555555555555555555555555555555",
      clientAddress: buyerAddress,
      evaluatorAddress: "0x6666666666666666666666666666666666666666",
    });
    await store.transitionCommerceActivation({
      activationId: activation.id,
      from: "PREPARING",
      to: "ONCHAIN_CREATED",
      externalJobId: "618",
      reconciliationState: "CURRENT",
      evidence: { source: "test-create-job" },
    });
    await store.createOperation({
      agreementId: fixture.agreement.id,
      activationId: activation.id,
      executionRequestId: fixture.executionId,
      operationType: "FUND",
      idempotencyKey: `activation:${activation.id}:fund:618`,
      state: "FINALIZED",
      preparedPayloadHash: `0x${"34".repeat(32)}`,
      evidence: { budgetBaseUnits: "0", fundsMoved: false },
    });
    const providerArtifactId = "01945b1e-7e80-7000-8000-000000000324";
    const providerArtifactHash = `0x${"56".repeat(32)}`;
    await database.exec(`
      insert into commerce_artifacts
        (id, agreement_id, activation_id, execution_request_id, artifact_type,
         source, content_hash, safe_content, provenance)
      values
        ('${providerArtifactId}', '${fixture.agreement.id}', '${activation.id}',
         '${fixture.executionId}', 'DELIVERY', 'test-real-observation',
         '${providerArtifactHash}', '{"riskLevel":"critical"}',
         'independently_observed');
    `);
    const input = {
      activationId: activation.id,
      externalJobId: "618",
      providerArtifactId,
      negotiatedAt: new Date("2026-08-25T00:00:00.000Z"),
      quoteExpiresAt: new Date("2026-08-25T00:15:00.000Z"),
      fundedAt: new Date("2026-08-25T03:00:00.000Z"),
      observedAt: new Date("2026-08-25T03:05:00.000Z"),
      observedBlock: 127066486n,
      observedBlockHash: `0x${"78".repeat(32)}`,
      evidence: {
        onchainJobState: "FUNDED",
        budgetBaseUnits: "0",
        jobHasBudget: true,
      },
    };
    const failed = await store.failFundedCommerceAttemptForQuoteWindow(input);
    const replay = await store.failFundedCommerceAttemptForQuoteWindow(input);
    expect(failed.activation).toMatchObject({
      lifecycleState: "FAILED",
      reconciliationState: "FAILED",
      failure: { code: "SIGNED_QUOTE_WINDOW_EXPIRED" },
    });
    expect(replay.providerArtifact).toMatchObject({
      id: providerArtifactId,
      contentHash: providerArtifactHash,
      source: "test-real-observation",
    });
    const persisted = await store.findAgreement(fixture.agreement.id, buyer);
    expect(persisted).toMatchObject({ status: "ACTIVE" });
    expect(persisted!.movements).toHaveLength(0);
    expect(persisted!.settlements).toHaveLength(0);
    expect(
      persisted!.artifacts.find(({ id }) => id === providerArtifactId),
    ).toMatchObject({
      contentHash: providerArtifactHash,
      source: "test-real-observation",
    });
  });

  it("rejects Development principals and seller-as-buyer activation", async () => {
    const development = await authorizedExecution();
    await database.exec(
      `update mandates set principal_type = 'DEVELOPMENT_SESSION' where id = '${mandateId}'`,
    );
    await expect(
      store.createUserCommerceActivation({
        agreementId: development.agreement.id,
        executionRequestId: development.executionId,
        authorizationId: development.authorizationId,
        commerceAddress: "0x5555555555555555555555555555555555555555",
        clientAddress: buyerAddress,
        evaluatorAddress: "0x6666666666666666666666666666666666666666",
      }),
    ).rejects.toThrow(/Development principals/i);

    await database.exec(`
      update mandates set principal_type = 'WALLET' where id = '${mandateId}';
      update authorization_artifacts set signer_address = '${owner}'
        where id = '${development.authorizationId}';
    `);
    await expect(
      store.createUserCommerceActivation({
        agreementId: development.agreement.id,
        executionRequestId: development.executionId,
        authorizationId: development.authorizationId,
        commerceAddress: "0x5555555555555555555555555555555555555555",
        clientAddress: owner,
        evaluatorAddress: "0x6666666666666666666666666666666666666666",
      }),
    ).rejects.toThrow(/seller wallet/i);
  });

  it("allows one verified review in each direction for a completed marketplace job", async () => {
    const fixture = await completedMarketplaceActivation();
    const buyerEligibility = await store.marketplaceReviewEligibility({
      activationId: fixture.activation.id,
      principalId: buyer,
      walletAddress: buyerAddress,
      reviewerRole: "BUYER",
    });
    expect(buyerEligibility).toMatchObject({
      eligible: true,
      subjectType: "AGENT",
      agentId,
    });
    if (!buyerEligibility.eligible) throw new Error("Fixture must be eligible");
    const buyerReview = await store.createMarketplaceReview({
      activationId: buyerEligibility.activationId,
      agreementId: buyerEligibility.agreementId,
      reviewerPrincipalId: buyer,
      reviewerRole: "BUYER",
      subjectType: "AGENT",
      subjectAgentId: agentId,
      subjectPrincipalId: null,
      sentiment: "GOOD",
      tags: ["accurate-result"],
      message: "The result was clear.",
      eligibilityProvenance: { rule: "completed_user_commerce_v1" },
    });
    expect(buyerReview).toMatchObject({
      sentiment: "GOOD",
      subjectType: "AGENT",
    });
    await expect(
      store.createMarketplaceReview({
        activationId: buyerEligibility.activationId,
        agreementId: buyerEligibility.agreementId,
        reviewerPrincipalId: buyer,
        reviewerRole: "BUYER",
        subjectType: "AGENT",
        subjectAgentId: agentId,
        subjectPrincipalId: null,
        sentiment: "BAD",
        tags: ["service-issue"],
        message: null,
        eligibilityProvenance: { rule: "completed_user_commerce_v1" },
      }),
    ).rejects.toThrow(/already been reviewed/i);
    const agentEligibility = await store.marketplaceReviewEligibility({
      activationId: fixture.activation.id,
      principalId: operator,
      walletAddress: owner,
      reviewerRole: "AGENT",
    });
    expect(agentEligibility).toMatchObject({
      eligible: true,
      subjectType: "BUYER",
    });
    if (!agentEligibility.eligible) throw new Error("Fixture must be eligible");
    await expect(
      store.createMarketplaceReview({
        activationId: agentEligibility.activationId,
        agreementId: agentEligibility.agreementId,
        reviewerPrincipalId: operator,
        reviewerRole: "AGENT",
        subjectType: "BUYER",
        subjectAgentId: null,
        subjectPrincipalId: buyer,
        sentiment: "GOOD",
        tags: [],
        message: null,
        eligibilityProvenance: { rule: "completed_user_commerce_v1" },
      }),
    ).resolves.toMatchObject({ reviewerRole: "AGENT", subjectType: "BUYER" });
    await expect(
      store.marketplaceReviewEligibility({
        activationId: fixture.activation.id,
        principalId: operator,
        walletAddress: owner,
        reviewerRole: "AGENT",
      }),
    ).resolves.toMatchObject({ eligible: false, reason: "already_reviewed" });
  });

  it("rejects internal, incomplete, unrelated, and already-reviewed review eligibility", async () => {
    const fixture = await completedMarketplaceActivation();
    await expect(
      store.marketplaceReviewEligibility({
        activationId: fixture.activation.id,
        principalId: "01945b1e-7e80-7000-8000-000000000399",
        walletAddress: "0x9999999999999999999999999999999999999999",
        reviewerRole: "BUYER",
      }),
    ).resolves.toMatchObject({
      eligible: false,
      reason: "reviewer_not_a_party",
    });
    await expect(
      store.marketplaceReviewEligibility({
        activationId: fixture.activation.id,
        principalId: operator,
        walletAddress: "0x9999999999999999999999999999999999999999",
        reviewerRole: "AGENT",
      }),
    ).resolves.toMatchObject({
      eligible: false,
      reason: "reviewer_not_a_party",
    });
    await database.exec(
      `update activations set marketplace_history_eligible = false where id = '${fixture.activation.id}'`,
    );
    await expect(
      store.marketplaceReviewEligibility({
        activationId: fixture.activation.id,
        principalId: buyer,
        walletAddress: buyerAddress,
        reviewerRole: "BUYER",
      }),
    ).resolves.toMatchObject({
      eligible: false,
      reason: "not_marketplace_work",
    });
    await database.exec(
      `update activations set marketplace_history_eligible = true, lifecycle_state = 'ACTIVE', status = 'FUNDED' where id = '${fixture.activation.id}'`,
    );
    await expect(
      store.marketplaceReviewEligibility({
        activationId: fixture.activation.id,
        principalId: buyer,
        walletAddress: buyerAddress,
        reviewerRole: "BUYER",
      }),
    ).resolves.toMatchObject({ eligible: false, reason: "job_not_completed" });
    await database.exec(
      `update activations set lifecycle_state = 'COMPLETED', status = 'COMPLETED' where id = '${fixture.activation.id}';
       update marketplace_outcomes set commerce_successful = false where activation_id = '${fixture.activation.id}'`,
    );
    await expect(
      store.marketplaceReviewEligibility({
        activationId: fixture.activation.id,
        principalId: buyer,
        walletAddress: buyerAddress,
        reviewerRole: "BUYER",
      }),
    ).resolves.toMatchObject({ eligible: false, reason: "job_not_completed" });
  });

  it("persists a sentiment-only Bad review with optional fields empty", async () => {
    const fixture = await completedMarketplaceActivation();
    const eligibility = await store.marketplaceReviewEligibility({
      activationId: fixture.activation.id,
      principalId: buyer,
      walletAddress: buyerAddress,
      reviewerRole: "BUYER",
    });
    if (!eligibility.eligible) throw new Error("Fixture must be eligible");
    await expect(
      store.createMarketplaceReview({
        activationId: eligibility.activationId,
        agreementId: eligibility.agreementId,
        reviewerPrincipalId: buyer,
        reviewerRole: "BUYER",
        subjectType: "AGENT",
        subjectAgentId: agentId,
        subjectPrincipalId: null,
        sentiment: "BAD",
        tags: [],
        message: null,
        eligibilityProvenance: { rule: "completed_user_commerce_v1" },
      }),
    ).resolves.toMatchObject({ sentiment: "BAD", tags: [], message: null });
  });
});
