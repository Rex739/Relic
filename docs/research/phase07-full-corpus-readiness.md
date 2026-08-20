# Phase 07: full BSC corpus readiness

Phase 07 prepares Relic to ingest the complete current BSC ERC-8004 corpus
without claiming that the import has already happened. The complimentary
8004scan Pro credential is still pending, so development retains the Phase 03
sample and uses anonymous access only for a single bounded smoke page.

## Official API contract

The source of truth is the 8004scan
[Builder Hub](https://8004scan.io/developers) and its linked
[OpenAPI document](https://8004scan.io/api/v1/public/docs/openapi.json).
Authentication is optional and uses the `X-API-Key` header. The official API
does not define an environment-variable name, so Relic retains its existing
application variable:

```text
8004SCAN_API_KEY
```

Relic does not accept `EIGHT004SCAN_API_KEY`. Anonymous limits are 10 requests
per minute and 100 per day. The documented Pro limits are 500 requests per
minute and 100,000 per day.

## Operational modes

- `anonymous`: no key is configured. Intended only for small smoke batches.
- `authenticated`: a key is configured, but the observed response limit has
  not established Pro access.
- `pro_authenticated`: a configured key receives an observed rate limit of at
  least 500 requests per minute.
- `rate_limited_degraded`: the API returned HTTP 429. Relic records the rate
  headers, performs no automatic 429 retry, leaves the last completed page as
  the checkpoint, and exits for a later resume.

Full-corpus mode fails closed unless it observes `pro_authenticated` on the
first response. API keys are never logged or persisted.

## Durable ingestion

The existing idempotent Phase 03 model remains authoritative:

- `corpus_source_records` retains one source row per 8004scan record;
- chain identity uniqueness prevents duplicate canonical agents;
- `corpus_import_checkpoints` resumes at the first uncommitted page;
- checkpoint advancement happens only after every record on a page is
  persisted or explicitly recorded as malformed;
- `corpus_import_runs` stores page bounds, counters, access mode, operational
  mode, request budget/count, rate headers, degradation reason, and failure;
- replaying a committed page updates the same source records and does not move
  an implicit-resume checkpoint;
- a page-size change during implicit resume is rejected to prevent gaps or
  overlap.

The existing Phase 03 checkpoint uses page size 25 and must retain that size
for the full resume. A larger page size would require a separately reviewed
checkpoint conversion and is intentionally not inferred.

## Classification and verification

Rule `bsc-corpus-v2` classifies only explicit structured declarations or
explicit name/description/capability terms. It supports current `services`,
legacy `endpoints`, and ERC-8183 declarations. It does not infer a marketplace
category from popularity or owner identity.

Existing payloads can be reclassified without contacting 8004scan:

```sh
pnpm corpus:reclassify -- --limit=1000
```

Every imported identity is inserted into the existing prioritized verification
queue. Direct BSC verification is read-only, bounded to 100 agents per run,
and resumes deterministically from queued status/priority:

```sh
pnpm corpus:verify -- --limit=100
```

Failures retain observations and receive a retry time; verified or partial
records retain the direct facts and mismatch evidence. Full secondary import
does not imply that every identity has already been directly verified.

## Command after Pro access arrives

Configure the credential in the server-side environment, then run:

```sh
pnpm corpus:bootstrap -- --full-corpus --page-size=100 --request-budget=100000 --concurrency=1
```

Do not place the literal key in shell history in production; inject it through
the deployment secret manager. The inline form above names the exact required
variable unambiguously.

The command safely maps the stored size-25 offset to the containing size-100
page and deliberately overlaps records rather than creating a gap. If it is
interrupted, rerun the same command: the last fully committed page is retained,
and the next run starts at the following page. A 429 or upstream failure does
not advance the failed page.

The Phase 07 smoke reported 265,789 agents. Phase 07.1 maps the current page 10
at size 25 to page 3 at size 100, so approximately 2,656 list requests remain.
The Pro daily allowance is sufficient. Discovery is now page-batched and
classification is offline; the measured and projected performance is recorded
in [the Phase 07.1 report](./phase07.1-corpus-ingestion-performance.md).

## Phase 07 bounded validation

On **2026-08-20**, Relic first reclassified all 236 previously persisted real
8004scan records under `bsc-corpus-v2`: 236 updated, zero rejected, and zero
network requests. It then performed one anonymous request with page size 25,
request budget 1, concurrency 3, and zero retries.

- start page: 9
- committed page: 9
- next page: 10
- seen/imported/rejected: 25/25/0
- source total: 265,789
- access/operational mode: `anonymous` / `anonymous`
- observed rate limit/remaining: 10 / 9
- persisted unique BSC source records after the run: 261
- full ingestion complete: no

A separate bounded BSC RPC verification pass processed five queued records
without using 8004scan. All five verified successfully, leaving 64 verified
and 197 unverified persisted records with none pending.

No website scraping, undocumented endpoint, blockchain write, payment, or
fund expenditure occurred.

## Current completion boundary

Before the key arrives Relic can complete migrations, offline reclassification,
direct-RPC verification batches, APIs, analytics, and small anonymous smoke
imports. The only blocked work is the full 8004scan page traversal and the
resulting complete secondary corpus. Phase 07 must not be reported as a
completed full-corpus ingestion until the checkpoint reaches the final page
under authenticated Pro access.
