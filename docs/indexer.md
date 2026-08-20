# Relic indexer operations

## Modes

```bash
pnpm db:migrate
pnpm indexer:backfill -- --max-blocks=1000 --dry-run
pnpm indexer:backfill -- --max-blocks=1000
pnpm indexer:sync
pnpm indexer:agent -- --id=0
pnpm indexer:reconcile -- --limit=5
pnpm indexer:quality
pnpm corpus:bootstrap -- --max-pages=1 --page-size=25
pnpm corpus:bootstrap -- --start-page=1 --max-pages=1 --page-size=25
pnpm corpus:reclassify -- --limit=1000
pnpm corpus:enrich -- --limit=10000
pnpm corpus:verify -- --limit=5
pnpm corpus:verify -- --limit=5 --retry-failed
pnpm corpus:observe -- --limit=5
pnpm corpus:report
pnpm corpus:status
```

`backfill` starts at `ERC8004_START_BLOCK`; `sync` resumes after the checkpoint; `agent` refreshes one current identity; `reconcile` compares persisted records with 8004scan; `quality` emits an internal summary. `--dry-run` avoids normalized/checkpoint/reconciliation mutations.

`corpus:bootstrap` uses the persisted 8004scan cursor unless `--start-page`
explicitly requests an idempotent replay. A page-size change maps the processed
offset to the containing new page and safely overlaps records rather than
creating a cursor gap. Each page records its run counters, source
total, access mode, operational mode, request budget/count, rate headers, raw
rows, failures, and successful cursor advancement. Anonymous runs default to a
one-request budget, have no transient retries, are capped at ten requests per
process, and are guarded by a local 100-request UTC-day ledger. HTTP 429 enters
`rate_limited_degraded` and stops without retrying.

`--full-corpus` requires `8004SCAN_API_KEY`, resumes the durable checkpoint,
and refuses to advance it unless the response headers identify the Pro tier.
The key is sent only through the official `X-API-Key` header and is never
logged. Discovery stores normalized identity and complete raw provenance in
one page transaction. `corpus:enrich` batches classification, services,
capabilities, quality and verification ranking offline. `corpus:reclassify`
reapplies the current deterministic rules to persisted 8004scan payloads with
zero network requests. `corpus:verify` drains
a deterministic priority queue through bounded direct BSC reads and is capped
at 100 candidates per run. `corpus:observe` is capped at 25 candidates and
performs only guarded HTTP(S) HEAD requests. `corpus:report` refreshes
analytical duplicate signals and emits aggregates from persisted rows.

Phase 07 readiness is available at
`GET /internal/corpus-status?chainId=56`. It reports persisted coverage,
checkpoint position, access/operational mode, rate state, latest run budget,
and verification-queue counts. It distinguishes pipeline readiness from
full-ingestion completion.

Phase 07.1 performance measurements and the optimized Pro command are in
[`phase07.1-corpus-ingestion-performance.md`](./research/phase07.1-corpus-ingestion-performance.md).

## Readiness and evidence

The corpus profiler stores 16 boolean listing facts and their deterministic percentage under rule `bsc-corpus-v1`. Readiness is explainable:

- `NOT_READY`: no name, meaningful description, or service declaration;
- `PARTIAL`: an identity/listing exists but lacks enough understandable capability evidence;
- `DISCOVERABLE`: meaningful name/description plus capability or service evidence;
- `ACTIONABLE`: discoverable plus resolved metadata, a declared concrete endpoint, a usable machine interface, and pricing/commercial evidence.

Readiness and completeness are usability measures, never trust or performance scores. Four-category classification uses only exact deterministic aliases in structured declarations or explicit name/description phrases; insufficient evidence remains uncategorized. Original strings and matched evidence are retained.

Direct and secondary ingestion converge on the case-insensitive registry/chain/token tuple. Secondary writes fill missing profile values but do not replace direct identity facts or direct evidence. Direct verification records current registry, token, owner, metadata pointer, block, timestamp, evidence, and mismatches before refreshing canonical state.

Endpoint observation rejects credentials, non-HTTP schemes, nonstandard ports, private/loopback/link-local DNS results (including IPv4-mapped forms), excess redirects, excess headers, and timeouts. It never sends POST requests or reads response bodies. A reachable host is not proof of functional agent behavior.

## Recovery

After interruption, rerun `indexer:sync`. Checkpoints advance only after successful persistence, and raw log uniqueness makes replay safe. Canonical hash mismatches trigger bounded rollback/replay.

To reset development indexing state, stop the indexer and target the exact development database. Delete in foreign-key-safe order only for the configured chain/registry: reconciliation rows for matching agents, metadata/ownership history, matching agents (cascade), raw events, indexed blocks, runs, then the one checkpoint. Never truncate the whole database or taxonomy. Prefer a reviewed SQL transaction and backup.

## Logs and limits

JSON logs include run ID, range, event/agent counts, metadata failures, duration, safe head, and checkpoint. The public 8004scan tier is 10 requests/minute and 100/day. BSC public nodes may prune archive state or reject historical logs; use an archive-capable RPC for backfill.

BNB dataseed endpoints disable `eth_getLogs`. The checked-in read default is currently `https://bsc.publicnode.com`, which supported controlled recent verification but not archive history without a provider token.
