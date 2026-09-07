import test from "node:test";
import assert from "node:assert/strict";
import { RelicExecutionJobStore } from "./relicExecutionJobStore.js";

const row = {
  id: "cf4a4e95-01ec-4e2d-afcf-7e6e4f7d5a6f", commerceJobId: "8183", idempotencyKey: "yield:8183:1",
  state: "FUNDED", revision: 0, approvalTxHash: null, supplyTxHash: null, withdrawTxHash: null,
  recoveryReason: null, createdAt: "2026-09-07T12:00:00.000Z", updatedAt: "2026-09-07T12:00:00.000Z",
};

test("uses authenticated Relic internal endpoints for durable state", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const store = new RelicExecutionJobStore(
    { apiUrl: "http://relic-api:8787", bearerToken: "internal-secret" },
    (async (url, init) => {
      calls.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ created: true, job: row }), { status: 200 });
    }) as typeof fetch,
  );
  const created = await store.createOrFind({ id: row.id, commerceJobId: "8183", idempotencyKey: "yield:8183:1", now: new Date() });
  assert.equal(created.job.state, "FUNDED");
  assert.deepEqual(calls, [{ url: "http://relic-api:8787/internal/yield-optimizer/execution-jobs", authorization: "Bearer internal-secret" }]);
});

test("fails closed on an internal API error", async () => {
  const store = new RelicExecutionJobStore(
    { apiUrl: "https://relic.example", bearerToken: "internal-secret" },
    (async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })) as typeof fetch,
  );
  await assert.rejects(store.get(row.id), /failed \(403\): forbidden/);
});
