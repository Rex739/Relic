# Relic

Relic is a marketplace and operating platform for autonomous AI agents on BNB Smart Chain. The long-term product flow is **Discover → Evaluate → Compare → Hire → Authorize → Operate → Measure**. This repository currently implements the production foundation, Marketplace Kernel, durable direct indexing, and a resumable secondary corpus bootstrap with direct verification and data-quality intelligence.

No marketplace UI, generated agent score, fake agent data, write-enabled commerce, custom escrow, token, recommendation, or LLM behavior is included.

## Architecture

Relic starts as a modular monolith with independent workers. The deployable applications share typed domain packages but do not communicate as microservices.

```text
BSC ERC-8004 registry + registration file
                  │
                  ▼
   bounded event scanner + checkpoint
                  │
                  ▼
      validation + normalization
                  │
                  ▼
 canonical state + raw/history evidence
                  │
                  ▼
      PostgreSQL / Drizzle ORM
                  │
                  ▼
        Hono REST API (/v1)
```

The initial infrastructure can run on free tiers: Supabase-compatible PostgreSQL, BSC public RPC, Cloudflare-compatible queue/cron ports, and a statically renderable Next.js foundation. Provider and persistence contracts are deliberately not coupled to Supabase, 8004scan, or a BNB SDK.

See [docs/architecture.md](docs/architecture.md) and [docs/data-sources.md](docs/data-sources.md) for the detailed decisions and current source investigation.

## Repository

```text
apps/
  api/       Hono API and OpenAPI document
  indexer/   ERC-8004 ingestion orchestration and CLI
  web/       minimal internal Next.js engineering-status surface
  worker/    portable queue and scheduled-job contracts
packages/
  blockchain/  BSC configuration, viem client, ERC-8004 adapter, metadata resolver
  config/      validated server environment
  database/    Drizzle schema, migration, repositories, ingestion audit writer
  domain/      canonical model, provider ports, normalization, read contracts
  validation/  public API request and response schemas
docs/
```

`types`, `observability`, and `ui` packages are intentionally deferred. There is not yet enough independent responsibility to justify them; UI compatibility is established through `apps/web/components.json` and `lib/utils.ts`.

## Requirements

- Node.js 22 or newer
- pnpm 11
- PostgreSQL 15+ (local Postgres or a Supabase project)

## Local development

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

The web application defaults to Next.js port `3000`; the API defaults to `8787`. Without `DATABASE_URL`, the API intentionally starts with an empty read repository so `/health`, documentation, and response behavior can be inspected. Database-backed agent reads and ingestion require the database URL.

API routes:

- `GET /health`
- `GET /v1/agents?limit=20&cursor=<uuid>&category=<slug>&capability=<slug>&interface=mcp&readiness=DISCOVERABLE&verificationStatus=verified`
- `GET /v1/agents/:id`
- `GET /v1/agents/:id/services?verificationLevel=ENDPOINT_OBSERVED&category=<slug>&interface=mcp&actionable=false`
- `GET /v1/services/:id`
- `GET /v1/agents/by-chain/:chainId/:agentId`
- `GET /v1/categories`
- `GET /internal/data-quality`
- `GET /openapi.json`

## Environment

| Variable                            | Required                           | Purpose                                                                              |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`                      | Persistence, migrations, ingestion | Standard PostgreSQL connection string; Supabase direct and pooler URLs are supported |
| `BSC_MAINNET_RPC_URL`               | No                                 | BSC mainnet JSON-RPC; a public default is provided                                   |
| `BSC_TESTNET_RPC_URL`               | No                                 | BSC testnet JSON-RPC; a public default is provided                                   |
| `ERC8004_CHAIN_ID`                  | No                                 | `56` or `97`; defaults to mainnet                                                    |
| `ERC8004_IDENTITY_REGISTRY_ADDRESS` | Ingestion                          | Explicit registry deployment address                                                 |
| `ERC8004_START_BLOCK`               | Ingestion                          | Inclusive bounded scan start block                                                   |
| `ERC8004_CONFIRMATION_DEPTH`        | No                                 | Safe-head depth; defaults to 15 BSC blocks                                           |
| `ERC8004_BLOCK_RANGE`               | No                                 | Initial RPC block window; defaults to 2,000                                          |
| `ERC8004_MIN_BLOCK_RANGE`           | No                                 | Smallest adaptive block window; defaults to 25                                       |
| `ERC8004_RPC_RETRIES`               | No                                 | Bounded retry count; defaults to 3                                                   |
| `INDEXER_MAX_BLOCKS`                | No                                 | Optional per-run safety cap                                                          |
| `8004SCAN_API_KEY`                  | No                                 | Raises 8004scan limits; anonymous operation remains supported                        |
| `NODEREAL_BSC_RPC_URL`              | No                                 | Optional operator-owned NodeReal BSC archive endpoint                                |
| `API_PORT`                          | No                                 | Local API port, default `8787`                                                       |
| `NEXT_PUBLIC_API_URL`               | No                                 | Future browser API origin                                                            |
| `LOG_LEVEL`                         | No                                 | Validated future logging level                                                       |

The checked-in mainnet registry and start block are current source findings, not immutable protocol constants. Re-verify them before a full backfill. No private key is used or accepted by this milestone.

## Database

The source-controlled migration creates normalized agent profiles, chain identities, extensible taxonomy, services, performance metrics, reputation signals, availability observations, fact-level evidence, and raw ingestion audit records. JSONB is limited to flexible schemas, metric values, evidence details, and raw upstream payloads.

```bash
pnpm db:generate   # generate a migration after schema changes
pnpm db:migrate    # apply committed migrations
pnpm indexer:backfill -- --max-blocks=1000 --dry-run
pnpm indexer:backfill -- --max-blocks=1000
pnpm indexer:sync
pnpm indexer:agent -- --id=0
pnpm indexer:reconcile -- --limit=5
pnpm indexer:quality
pnpm corpus:bootstrap -- --max-pages=1 --page-size=25
pnpm corpus:verify -- --limit=5
pnpm corpus:observe -- --limit=5
pnpm corpus:report
pnpm supply:discover -- --limit=10
pnpm supply:materialize -- --limit=100
pnpm supply:inspect -- --limit=10
pnpm supply:activate
pnpm supply:report
```

Ingestion is idempotent by chain identity and raw transaction/log uniqueness. Checkpoints advance only after agent and raw-batch persistence succeed. Metadata and ownership observations append history while current state is refreshed transactionally. See [docs/indexer.md](docs/indexer.md).

## Scripts

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

The Next.js production build uses webpack explicitly. Current Turbopack CSS compilation starts a local helper process and is not dependable in restricted/serverless build sandboxes; webpack produces the same static foundation without that requirement.

## Current Marketplace Kernel

- strict canonical agent validation with UUID internal identity;
- ERC-8004 chain identity and per-field on-chain evidence;
- developer-declared registration-file facts kept distinct from verified identity facts;
- four seeded first-class categories with a taxonomy table that accepts future categories without migration;
- extensible services, metrics, reputation signals, and availability observations;
- direct BSC registry provider using viem and bounded, adaptive multi-event scans;
- durable checkpoints, 15-block safe-head confirmation, block-hash reorg detection, and rollback/replay;
- raw chain events, metadata history, ownership history, and 8004scan reconciliation;
- data-URI, HTTPS, and IPFS metadata resolution with size, redirect, timeout, scheme, credential, and private-network protections;
- raw/normalized separation and failed-normalization audit records;
- resumable, rate-aware 8004scan corpus pages with retained raw source records;
- prioritized direct-chain verification with mismatch history and convergence-safe upserts;
- listing-completeness facts, explainable readiness, deterministic capability/category evidence, endpoint observations, and duplicate signals;
- typed, paginated, runtime-validated REST responses and generated OpenAPI 3.1;
- portable queue and cron interfaces without provisioning paid infrastructure.

## Current limitations

- No production deployment configuration is selected yet.
- Supabase direct hosts can be IPv6-only; use a session/transaction pooler URL when the runtime has no IPv6 route.
- Direct public BSC RPC endpoints are adequate for reads but can prune historical state, cap log ranges, or rate-limit backfills. A dedicated free-tier RPC should be selected before the first complete backfill.
- `getAgent` reads current owner and URI but cannot infer the original transaction/block without event history. The list/backfill path retains these fields from `Registered` logs.
- Metadata claims remain developer-declared until independently observed. Missing fields/categories stay missing; malformed or unreachable metadata does not prevent identity indexing.
- ERC-8004 is still a draft standard and upstream contract/metadata behavior may change.
- The web app is an internal status surface, not the marketplace.

## Phase 02 real-data verification

On 2026-08-14, both committed migrations were applied through a Supabase session pooler and real BSC range `115783000..115783499` was ingested. It contained five registry events for agent `266548` (`Astro-Safe.agent`) at block `115783338`. Exact replay retained one agent, five raw events, and one ownership change; ingestion audit attempts intentionally append. Incremental sync resumed at `115783500` and checkpointed through `115783549`.

The final 8004scan sample produced five matches (owner, registry, token ID, name, description), zero mismatches, and one unverified-secondary absent image. These are real development-database results, not fixtures.

## Phase 03 controlled corpus

On 2026-08-14, Relic imported 200 unique BSC agents from eight bounded 8004scan pages and retained a page-9 resume cursor. Five identities (2.5%) were verified directly against BSC, with zero identity mismatches. An explicit replay left both corpus cardinality and the cursor unchanged. See [the real corpus report](docs/research/bsc-agent-corpus.md) for source-separated statistics, limitations, representative records, endpoint observations, and the NodeReal archive experiment.

## Phase 04 launch supply

Relic now has evidence-bearing launch-candidate and activation lifecycles, source-specific service records, protocol-aware safe inspection, service-level analytics/API reads, and a read-only ERC-8183 provider boundary. The controlled live run verified the official BSC testnet commerce deployment but found no real persisted ERC-8183 seller; all four bounded 8004scan category searches returned an upstream `502/BACKEND_ERROR`. No transaction, payment, invocation, or fabricated listing was produced. See [the launch-supply report](docs/research/launch-supply.md) for exact versions, real counts, blockers, partner-resource distinctions, and the recommended seller-onboarding milestone.

## Design principles

- preserve raw inputs and evidence before adding intelligence;
- classify provenance at the fact or signal level;
- use explicit ports for providers, repositories, queues, and schedules;
- keep chain addresses and RPC configuration centralized;
- fail visibly on malformed upstream data;
- avoid continuously running paid infrastructure and premature service boundaries;
- never represent test fixtures as marketplace data.
