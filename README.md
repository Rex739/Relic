# Relic

Relic is a marketplace and operating platform for autonomous AI agents on BNB Smart Chain. The product flow is **Discover → Evaluate → Compare → Hire → Authorize → Operate → Measure**. This repository contains the Marketplace Kernel, durable indexing, the web marketplace, buyer authorization, and constrained commerce execution paths for the included seller agents.

Execution is intentionally allowlisted and policy-bound. Relic does not use custom escrow, a platform token, fabricated listings, or LLM-generated transaction calldata. Agent capabilities and transaction boundaries are documented in each agent workspace.

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
  api/       Hono API, OpenAPI document, authorization, and execution routes
  indexer/   ERC-8004 ingestion, corpus verification, and supply orchestration
  web/       Next.js marketplace and buyer execution surfaces
  worker/    portable queue and scheduled-job contracts
packages/
  blockchain/  BSC configuration, viem client, ERC-8004 adapter, metadata resolver
  config/      validated server environment
  database/    Drizzle schema, migration, repositories, ingestion audit writer
  domain/      canonical model, provider ports, normalization, read contracts
  validation/  public API request and response schemas
docs/
```

`agents/` contains the seller workspaces (Grid Trader, LP Range Rebalancer,
Health Guard, Yield Optimizer, Yield Scout, and the reference Health Factor
Monitor). Their public gateways and private signer runtimes are documented
beside the relevant agent.

Shared UI primitives remain local to `apps/web`; separate `types` and
`observability` packages are intentionally deferred until they have independent
responsibilities.

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
| `NEXT_PUBLIC_API_URL`               | No                                 | Browser API origin; same-origin routing is used when unset                          |
| `LOG_LEVEL`                         | No                                 | Validated future logging level                                                       |

The checked-in mainnet registry and start block are current source findings, not immutable protocol constants. Re-verify them before a full backfill. Runtime signing keys are injected through deployment secrets and are never committed.

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

## Networks and commerce

Relic treats BSC Testnet and BSC Mainnet as separate execution environments.
Chain identity, RPC, ERC-8004 registration, ERC-8183 commerce, payment token,
wallet/session credentials, evidence, jobs, receipts, and explorer links are
network-scoped.

| Network | Chain ID | UI label | Commerce payment |
| --- | ---: | --- | --- |
| BSC Testnet | 97 | Testnet | BNB Agent Studio canonical `$U` token |
| BSC Mainnet | 56 | Mainnet · real funds | BNB Agent Studio canonical `$U` token |

The ERC-8183 kernel is the source of truth for the payment-token address:
Relic reads `paymentToken()` and verifies the configured token before creating
or funding a job. USDT may be the asset managed by a strategy agent, but it is
not implicitly substituted for the marketplace payment token.

Mainnet requires explicit configuration, a separate wallet/session, an
agent-level enablement flag, user confirmation, and a capped risk budget. A
missing or mismatched Mainnet configuration fails closed; it never falls back
to Testnet values. Mainnet identities and listings are distinct from their
Testnet counterparts.

## Current limitations

- Production deployment is configuration-driven; inject chain, database, and signer settings through the target platform's secret manager.
- Supabase direct hosts can be IPv6-only; use a session/transaction pooler URL when the runtime has no IPv6 route.
- Direct public BSC RPC endpoints are adequate for reads but can prune historical state, cap log ranges, or rate-limit backfills. A dedicated free-tier RPC should be selected before the first complete backfill.
- `getAgent` reads current owner and URI but cannot infer the original transaction/block without event history. The list/backfill path retains these fields from `Registered` logs.
- Metadata claims remain developer-declared until independently observed. Missing fields/categories stay missing; malformed or unreachable metadata does not prevent identity indexing.
- ERC-8004 is still a draft standard and upstream contract/metadata behavior may change.
- The web app includes the buyer-facing marketplace plus operator-only discovery and offer-management surfaces.
- Mainnet execution remains opt-in and must be canaried with a small budget before enabling additional agent categories.
- External agents that accept a different commerce token (for example USDT) require a compatible ERC-8183 deployment or an explicit external-settlement adapter; Relic never converts tokens silently.

## Production checklist

Before enabling a production deployment:

1. Apply migrations and confirm the database URL uses a transaction/session pooler where required.
2. Configure both network RPCs and the correct ERC-8004/ERC-8183 addresses for each chain.
3. Read and verify each commerce kernel's `paymentToken()` and decimals; do not infer them from strategy assets.
4. Inject wallet, signing, session-transfer, and service credentials through a secret manager. Never commit keys or `.env` files.
5. Keep Mainnet disabled until the agent identity, endpoint ownership, payment token, risk limits, and receipt links have passed a capped canary.
6. Verify that every receipt links to the correct chain explorer and that failed jobs remain reviewable.

For operational runbooks and evidence semantics, see [docs/architecture.md](docs/architecture.md), [docs/indexer.md](docs/indexer.md), and the agent-specific README files under `agents/`.

## Design principles

- preserve raw inputs and evidence before adding intelligence;
- classify provenance at the fact or signal level;
- use explicit ports for providers, repositories, queues, and schedules;
- keep chain addresses and RPC configuration centralized;
- fail visibly on malformed upstream data;
- avoid continuously running paid infrastructure and premature service boundaries;
- never represent test fixtures as marketplace data.
