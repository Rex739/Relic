# Northflank reference runtime

This document prepares Relic's reference-agent runtime for Northflank. It does
not authorize a deployment, wallet upload, secret creation, identity update, or
onchain transaction.

## Northflank build and process

- Repository: `Rex739/Relic`
- Branch: `main`
- Service type: combined service
- Service name: `relic-reference-runtime`
- Build context: repository root `/`
- Dockerfile: `/Dockerfile`
- Container command: `node dist/service.js`
- Listen address: `0.0.0.0`
- Listen port: runtime `PORT`, with image fallback `8003`
- Liveness path: `GET /health`
- Readiness path: `GET /ready`

The multi-stage image pins Node `22.22.0` by image-index digest and pnpm
`11.16.0`, installs only the
health-factor seller's dependency closure, compiles its production TypeScript,
deploys production dependencies, and runs as the image's unprivileged `node`
user. `.dockerignore` excludes environment files, `.studio`, wallets,
`.agent-data`, tests, build output, and repository metadata from the build
context.

The process does not open its HTTP port until environment validation, exact
keystore discovery, Postgres artifact-table verification, signer decryption,
ERC-8183 client creation, and payment-token resolution succeed. Missing or
invalid production configuration causes startup to fail; it never exposes a
false-ready seller. `/health` is a cheap process/HTTP liveness check. `/ready`
reports HTTP 200 only while all mounted agent modules are initialized and the
runtime is accepting requests. Neither route performs RPC calls or writes.

Before the first runtime start, apply repository database migrations through
the existing controlled migration process. Migration `0007_woozy_magma.sql`
creates the durable `reference_agent_artifacts` table.

## Runtime configuration

Non-secret values:

| Variable                        | Required value or meaning                              |
| ------------------------------- | ------------------------------------------------------ |
| `NODE_ENV`                      | `production` (set by the image)                        |
| `NETWORK`                       | Exactly `bsc-testnet`                                  |
| `PORT`                          | Northflank-injected port; defaults to `8003`           |
| `WALLET_ADDRESS`                | Public address matching the injected keystore filename |
| `WALLET_KEYSTORE_DIR`           | Directory containing the injected secret file          |
| `ERC8183_SERVICE_PRICE`         | Exactly `0`                                            |
| `ERC8183_AGENT_URL`             | Final public HTTPS URL ending in `/erc8183`            |
| `ERC8183_POLICY_ADDRESS`        | Current official BSC Testnet policy address            |
| `ERC8183_FUNDED_POLL_INTERVAL`  | Poll interval in seconds; defaults to `15`             |
| `VENUS_BSC_TESTNET_COMPTROLLER` | Pinned Venus Core testnet Comptroller                  |

Secret environment values:

| Variable              | Reason                                                          |
| --------------------- | --------------------------------------------------------------- |
| `WALLET_PASSWORD`     | Decrypts the injected Keystore V3 file                          |
| `DATABASE_URL`        | Supabase Session Pooler connection string; includes credentials |
| `BSC_TESTNET_RPC_URL` | Treat as secret when the provider URL embeds a key              |
| `RPC_URL_BSC_TESTNET` | Treat as secret when the provider URL embeds a key              |

Required secret file:

```text
${WALLET_KEYSTORE_DIR}/${WALLET_ADDRESS}.json
```

The filename must use the same checksummed address configured in
`WALLET_ADDRESS`. Inject the existing encrypted Keystore V3 JSON as a
Northflank secret file only after the human custody checkpoint. Mount its
directory read-only where possible. Do not commit the keystore, place it in a
Docker build argument, encode it into source, or paste its contents into logs.

`PRIVATE_KEY` is explicitly forbidden at runtime. This prevents first-run key
import and, together with the exact keystore check, prevents the SDK's fallback
wallet-creation behavior. No private key, password, connection string, or
keystore is present in the image.

## Persistence and marketplace truth

The old `.agent-data` directory was SDK-local deliverable storage. It is not
durable on a stateless container and is not used by the production runtime.
ERC-8183 deliverable manifests are now stored in the existing Postgres/Supabase
database, keyed by agent slug and job ID. This allows the public response route
to recover a deliverable after a restart without paid filesystem storage.

This artifact table is runtime transport storage. Canonical activation,
transition, outcome, and reconciliation evidence remains in Relic's existing
marketplace tables. Historical `.agent-data` files are supplementary local
evidence and are neither copied into the image nor required for production
correctness.

## HTTP and agent layout

The current mounted module is `health-factor-monitor`. Its existing ERC-8183
surface remains:

- `GET /erc8183/health`
- `GET /erc8183/status`
- `POST /erc8183/negotiate`
- `GET /erc8183/job/:jobId`
- `GET /erc8183/job/:jobId/response`

The shared host is implemented as a registry of independently initialized
agent mounts. Future rebalancing, grid-trading, and yield-optimisation modules
must be added to that registry with unique route prefixes, separate ERC-8004
identity/service metadata, separate wallet address/password/secret file, and a
separate artifact `agent_slug`. Sharing the process does not authorize sharing
an identity, signer, service record, or evidence stream.

## Shutdown behavior

`SIGTERM` and `SIGINT` first make readiness fail, stop accepting HTTP traffic,
abort the funded-job polling loop, wait for the loop to finish, and close the
Postgres connection pool. Northflank can therefore restart the container
without leaving a polling timer or database pool running.

## Local verification without secrets

The production entrypoint intentionally cannot advertise readiness without the
real encrypted keystore and database. Safe secret-free verification consists
of building the image and confirming that startup fails before listening when
required configuration is absent. Full `/health` and `/ready` verification
belongs after the human-approved secret-file and environment provisioning
checkpoint; do not substitute dummy custody or report a preflight container as
operational.
