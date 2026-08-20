# Phase 07.1 — Full-Corpus Ingestion Performance

**Profile date:** 2026-08-20  
**Scope:** BNB Chain mainnet discovery using offline fixtures and persisted data  
**8004scan corpus/API requests made:** 0

Phase 07.1 does not perform or claim a full corpus crawl. It removes Relic's
per-agent database bottleneck so the Pro-backed crawl can run after the
credential arrives.

## Finding

The legacy persistence path was the bottleneck. One representative agent
opened one database transaction and executed approximately 19 SQL statements
for one service, capability and category. Including `BEGIN` and `COMMIT`, this
is approximately 21 database protocol round trips per agent, or 2,100 per 100
agents. It repeatedly queried identity, taxonomy, metadata-history and
verification-queue state.

The previous real bounded run achieved approximately 0.30 agents/second end to
end. A disposable local PostgreSQL-compatible benchmark measured the legacy
path at 161.9 agents/second; the difference demonstrates the old design's
sensitivity to remote database latency.

## Staged pipeline

### Discovery ingest

Each page is parsed and validated, then persisted in one transaction using one
existing-identity lookup and batched agent, identity and raw-source upserts.
Malformed observations are inserted in the same transaction when present. The
source JSON, content hash, source timestamps, owner and chain identity remain
durable. A checkpoint is committed only after the entire page transaction
succeeds.

For a normal 100-agent page this is four discovery statements, two checkpoint
statements and one request-ledger statement. Including transaction boundaries,
the critical path is approximately 11 database protocol round trips per 100
agents, down from approximately 2,100.

### Offline enrichment

`corpus:enrich` reads durable records without the current rule version and
batches 100 agents per transaction. It persists fact provenance, services,
normalized capabilities, classification evidence, taxonomy links, quality,
reputation and verification priority. Changed source content clears its
enrichment marker; unchanged idempotent replays retain it.

Discovery therefore does not wait for classification, service materialization,
metadata-history lookups or verification ranking.

The identity and source uniqueness indexes were retained: they are required for
idempotent upserts and replay safety. No index was dropped. Their write cost is
small after batching compared with the removed transaction and lookup N+1s.
Provenance is deduplicated at the raw source-record boundary by provider/source
ID and content hash; enrichment replaces its source-scoped derived evidence in
bulk rather than appending duplicates. Bootstrap performs no metadata URI
resolution.

### Selective verification

Direct RPC and endpoint verification remain separate bounded operations over
the prioritized queue. Discovery performs no blockchain write and does not
wait for verification.

## Measurements

All fixture measurements used deterministic records and zero network requests. The
database benchmark applied the real migrations to a disposable PGlite
database. PGlite's large WebAssembly baseline is not representative of the
production Node process, so incremental RSS is reported.

| Measurement                                               |                      Result |
| --------------------------------------------------------- | --------------------------: |
| Legacy persistence, 100 agents                            |              161.9 agents/s |
| Batched discovery, 1,000 agents                           |            3,983.0 agents/s |
| Batched discovery, 10,000 agents                          |            3,924.4 agents/s |
| Batched offline enrichment, 1,000 agents                  |            1,309.3 agents/s |
| Real development DB enrichment, 261 persisted agents      |          14.6–17.3 agents/s |
| Discovery SQL statements / 100 agents                     |                           4 |
| Discovery transaction protocol round trips / 100 agents   |                           2 |
| Full bootstrap DB protocol round trips / 100-agent page   |            approximately 11 |
| Discovery database growth / 1,000 agents                  |  2,224,947 bytes (2.12 MiB) |
| 10,000-agent discovery incremental peak RSS               | 58,998,784 bytes (56.3 MiB) |
| 1,000-agent discovery incremental peak RSS                |   2,834,432 bytes (2.7 MiB) |
| JSON parse, 10,000 agents / 4.85 MB                       |                     21.7 ms |
| Zod normalization, 10,000 agents                          |                     30.6 ms |
| Classification/service/priority derivation, 10,000 agents |                     60.3 ms |
| CPU benchmark incremental RSS                             | 35,127,296 bytes (33.5 MiB) |

The real development pass enriched all 261 previously persisted records with
zero external requests and zero rejected records. It used 43 SQL statements in
three transactions and spent 17.93 seconds in persistence. This remote-database
measurement, followed by a 15.08-second idempotent replay after the taxonomy
mapping correction, is the conservative basis for the production estimate;
the local fixture rates demonstrate algorithmic capacity rather than WAN
performance.

Production is page-bounded at 100 agents and does not retain a 10,000-agent
fixture corpus. The 10,000-agent RSS number is a conservative benchmark
high-water mark.

The provider now reports fetch, JSON parsing and response-validation time
separately. Bootstrap reports normalization, discovery persistence, checkpoint
time, statement count and transaction count. No anonymous request was made
merely to sample fetch latency; the next authorized normal page request will
produce that measurement.

## Page size and concurrency

The official 8004scan OpenAPI declares a maximum list-page size of 100. Relic
uses 100 in Pro full-corpus mode. Discovery concurrency is 1 because durability
is one ordered page transaction; the former concurrency of 3 only ran three
expensive per-agent transactions concurrently. A sequential request stream is
well below the official Pro limit of 500 requests/minute and avoids
out-of-order checkpoint complexity.

When the persisted checkpoint changes from page size 25 to 100, Relic computes
the processed offset and resumes from the containing 100-agent page. The
current page 10 at size 25 maps to page 3 at size 100, intentionally replaying
25 records and never creating a gap.

At the previously observed 265,789 agents, size 100 requires 2,658 pages.
Starting at the safely overlapped page 3 requires approximately 2,656
requests. The 100,000-request budget leaves substantial retry room. Based on
the remote enrichment calibration and round-trip reduction, discovery should
take approximately 3–5 hours rather than 8–12 days. Offline enrichment is
estimated at another 4–6 hours and can run independently or between discovery
runs.

## Commands after Pro access arrives

Store the credential as `8004SCAN_API_KEY`, then run discovery:

```bash
pnpm corpus:bootstrap -- --full-corpus --page-size=100 --concurrency=1 --request-budget=100000
```

Run offline enrichment independently and repeat it until no records await the
current rule version:

```bash
pnpm corpus:enrich -- --limit=10000
```

The reproducible offline benchmarks are:

```bash
pnpm corpus:benchmark
pnpm corpus:benchmark:cpu
```
