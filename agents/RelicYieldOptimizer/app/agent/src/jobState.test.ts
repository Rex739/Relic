import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryYieldJobStore } from "./jobState.js";

const now = new Date("2026-09-07T15:00:00.000Z");
const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("deduplicates a funded job and prevents a stale transition from double-sending", async () => {
  const store = new InMemoryYieldJobStore();
  const first = await store.createOrFind({ id: "job-1", commerceJobId: "8183-7", idempotencyKey: "funded:8183-7", now });
  const duplicate = await store.createOrFind({ id: "job-2", commerceJobId: "8183-7", idempotencyKey: "funded:8183-7", now });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.job.id, "job-1");

  const accepted = await store.transition({ id: "job-1", expectedRevision: 0, to: "POLICY_ACCEPTED", now });
  assert.equal(accepted?.revision, 1);
  assert.equal(await store.transition({ id: "job-1", expectedRevision: 0, to: "POLICY_ACCEPTED", now }), null);
});

test("requires a receipt hash for a submitted transaction and a reason for recovery", async () => {
  const store = new InMemoryYieldJobStore();
  await store.createOrFind({ id: "job-1", commerceJobId: "8183-7", idempotencyKey: "funded:8183-7", now });
  await store.transition({ id: "job-1", expectedRevision: 0, to: "POLICY_ACCEPTED", now });
  await assert.rejects(
    store.transition({ id: "job-1", expectedRevision: 1, to: "APPROVAL_SUBMITTED", now }),
    /transaction hash/,
  );
  const submitted = await store.transition({ id: "job-1", expectedRevision: 1, to: "APPROVAL_SUBMITTED", transactionHash: hash, now });
  assert.equal(submitted?.approvalTxHash, hash);
  await assert.rejects(
    store.transition({ id: "job-1", expectedRevision: 2, to: "RECOVERY_REQUIRED", now }),
    /recovery requires a reason/,
  );
});
