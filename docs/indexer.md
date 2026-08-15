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
pnpm corpus:verify -- --limit=5
pnpm corpus:verify -- --limit=5 --retry-failed
pnpm corpus:observe -- --limit=5
pnpm corpus:report
```

`backfill` starts at `ERC8004_START_BLOCK`; `sync` resumes after the checkpoint; `agent` refreshes one current identity; `reconcile` compares persisted records with 8004scan; `quality` emits an internal summary. `--dry-run` avoids normalized/checkpoint/reconciliation mutations.

`corpus:bootstrap` uses the persisted 8004scan cursor unless `--start-page` explicitly requests an idempotent replay. Implicit resume locks the prior page size to prevent cursor ambiguity. Each page records its run counters, source total, rate headers, raw rows, failures, and successful cursor advancement. `corpus:verify` drains a deterministic priority queue through the direct provider. `corpus:observe` is capped at 25 candidates and performs only guarded HTTP(S) HEAD requests. `corpus:report` refreshes analytical duplicate signals and emits aggregates from persisted rows.

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
