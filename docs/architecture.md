# Relic architecture

## Scope

This document covers the Marketplace Kernel and durable BSC indexing. It establishes production boundaries for identity, profile, classification, services, provenance, history, reconciliation, performance, reputation, and availability without implementing ranking or commerce.

## System shape

Relic is a modular monolith with independent ingestion workers:

- `web` is a Next.js App Router foundation. It owns presentation only.
- `api` is a transport adapter over a domain read repository. Routes are Hono/OpenAPI declarations and Zod validates public output.
- `indexer` orchestrates safe-head scans, persisted checkpoints, normalization, reorg recovery, refresh, reconciliation, and structured run logs.
- `worker` defines Cloudflare Queue/Cron-compatible message and scheduling ports. It contains no vendor provisioning or continuously running process.
- domain packages contain no HTTP framework or database dependency.

This shape keeps deployment cheap while allowing the indexer or worker to scale separately later.

## Canonical Agent Model

`CanonicalAgent` is the internal write model. Its stable root is:

```text
CanonicalAgent
├── id (Relic UUID)
├── identity (ERC-8004 / eip155 chain identity)
├── profile (sourced values)
├── taxonomy[] (category, capability, tag, protocol, asset, chain)
├── services[]
├── metrics[]
├── reputation[]
├── availability[]
└── createdAt / updatedAt
```

Identity uniqueness is the tuple `(namespace, chainId, registryAddress, agentId)`, not token ID alone. Addresses are normalized by viem. External numeric identifiers and block numbers are strings in the domain so JavaScript number precision cannot corrupt them; PostgreSQL stores blocks as `bigint`.

Profile values use `{ value, evidence[] }`. Identity uses `fieldEvidence`, and every taxonomy assignment, service, metric, reputation signal, and availability observation carries its own evidence. This makes it possible for a verified owner address, developer-declared name, independently observed latency, and agent-reported performance value to coexist without collapsing trust into one agent-level label.

Each evidence record contains:

- provenance class: `onchain_verified`, `independently_observed`, `agent_reported`, or `developer_declared`;
- source and optional URI/content hash;
- observation time;
- optional chain, transaction, and block evidence;
- optional structured source details.

Corpus enrichment additionally permits `secondary_unverified` for third-party indexed facts that have not been established by direct chain or independent observation. Secondary raw records, import checkpoints/runs, verification queue/observations, normalized declarations, quality facts, classification evidence, endpoint observations, duplicate signals, and reputation inventory are separate tables so no derived assessment overwrites source evidence.

The database materializes current profile values for fast reads and stores evidence in `fact_evidence`. Raw provider payloads remain in `ingestion_records`; decoded logs remain in `raw_chain_events`; `metadata_history` and `ownership_history` preserve changes. Refresh can replace current children without deleting upstream audit/history.

## Extensibility decisions

### Classification

Categories are data in `taxonomy_terms`, not a PostgreSQL enum. The four initial core rows are seeded by migration. The `taxonomy_kind` enum describes the stable relationship kind; adding a category is data-only.

### Services

Service identity and discoverability fields are relational. Input/output schema, pricing, and SLA remain JSONB because their standards are not stable and vary by protocol. Relic does not interpret them as verified facts without evidence.

### Performance and reputation

Metrics use a key, scalar value, optional unit/window, measured time, and evidence. This prevents trading, yield, and monitoring agents from forcing unrelated sparse columns into one table. Reputation is a stream of typed signals; no score is calculated in this milestone.

### Availability

Availability is an observation stream, not a mutable boolean. Status, heartbeat, last successful contact, latency, uptime ratio, time, and evidence can later support windowed aggregates.

## Provider boundary

`AgentRegistryProvider` supplies current reads. `Erc8004EventScanner` separately discovers mutations directly through viem. `Scan8004Provider` is a secondary, authenticated-or-anonymous, rate-header-aware discovery/reconciliation adapter and never becomes the sole source of truth.

The direct adapter:

1. reads `Registered`, `URIUpdated`, `Transfer`, `MetadataSet`, and `MetadataUpdate` logs in bounded ranges;
2. reads/retains the chain identity and event evidence;
3. resolves `data:`, IPFS, or public HTTP(S) registration files;
4. validates the provider record;
5. validates the ERC-8004 registration-file subset;
6. normalizes it without manufacturing missing facts.

Malformed, empty, oversized, timed-out, invalid, or inaccessible registration files produce a resolution observation while the on-chain identity remains indexable. RPC and database failures surface and prevent checkpoint advancement.

## Indexing, checkpoints, and reorgs

Normal indexing calculates `safeHead = currentHead - confirmationDepth`; the default is 15 BSC blocks. Each successful batch persists raw logs, boundary block/hash evidence, and the checkpoint after all agent transactions succeed. Sync resumes at `indexedBlock + 1`.

Before continuing, the indexer compares the stored checkpoint hash with the canonical block. A mismatch walks retained boundary evidence backward (up to 100 entries), deletes affected raw/history/derived records from the fork point, refreshes affected current agents, and replays. If no common ancestor is retained, it fails closed for operator recovery.

Initial windows default to 2,000 blocks. Range-limit errors halve the window to a configurable floor; successful smaller ranges grow toward the configured maximum. Other transient RPC errors use bounded exponential retries.

## Persistence and transactions

The database package uses standard PostgreSQL through `postgres` and Drizzle; no Supabase-only feature is required. An agent refresh is one transaction:

1. locate the internal agent by chain identity;
2. upsert current profile and identity;
3. replace normalized child records and fact evidence;
4. append metadata/ownership and successful raw ingestion history.

Chain-identity and transaction/log unique indexes make replay idempotent. The batch checkpoint is written only after all agent refresh transactions complete.

## API contract

The API uses opaque UUID cursors today. List responses are `{ data, pagination }`; detail responses are `{ data }`; errors are `{ error: { code, message, details? } }`. This avoids nested envelopes while leaving pagination and errors extensible. Zod validates outgoing database projections, and `/openapi.json` is generated from the same route schemas.

The API repository is injected. Tests use an in-memory implementation; runtime uses Drizzle when `DATABASE_URL` is configured.

## Configuration and secrets

Only `packages/config` reads `process.env`. Chain clients receive validated URLs and IDs. The indexer requires an explicit registry address and start block so a deployment change cannot silently redirect ingestion. No write client or private-key configuration exists.

## Async and deployment direction

`apps/worker` defines vendor-neutral queue messages, acknowledgements, retries, and scheduled enqueue behavior. A future Cloudflare adapter can map Queue batches and Cron triggers onto these ports. That adapter is deferred until deployment is selected; no queue is required for a one-page ingestion CLI.

Likely free-tier direction:

- Next.js static/server rendering through a Cloudflare-compatible adapter;
- Hono on Cloudflare Workers or another scale-to-zero runtime;
- Supabase PostgreSQL;
- Cloudflare Queue/Cron for incremental scans;
- a dedicated free-tier BSC RPC for reliable bounded logs.

No component requires a permanently running VM.

## Corpus convergence

Broad discovery and direct indexing share the canonical identity tuple. An 8004scan-first row can later gain direct evidence without duplication; a direct-first row can later receive secondary profile enrichment without losing authoritative owner, registry, token, or metadata-pointer facts. Verification and bootstrap maintain independent resumable state.

Listing completeness and marketplace readiness are stored as explainable data-quality facts. Deterministic capability aliases and category matches retain raw values and rule versions. Endpoint reachability and duplicate fingerprints remain observations/signals rather than canonical truth or enforcement decisions.

## Decisions deferred

- deployment adapter and environments;
- developer/publisher organization identity;
- reputation aggregation and Relic Agent Score;
- ERC-8183 commerce, mandates, payments, and execution monitoring;
- public marketplace API stability guarantees.
