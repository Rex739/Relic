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

The durable BSC Testnet seller endpoint is
`https://p01--relic--b28z25yb24gx.code.run/erc8183`. ERC-8004 agent `1840`
publishes this exact URI on chain. On **2026-08-20**, public checks of
`/health`, `/ready`, `/erc8183/health`, and `/erc8183/status` all returned HTTP
200; the status response reported chain ID `97`, the configured seller
address, zero service price, and read-only operation.

The endpoint-only metadata update confirmed in block `126223200` as
transaction
`0xf022a0706f439ed8c86efd535d564e75261ed73086f345ef86e3e38d00d1462a`.
Its effective gas price was zero. A registry read-back reproduced the complete
preserved identity metadata with only the expired Quick Tunnel URL replaced.

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
| `ERC8183_AGENT_URL`             | `https://p01--relic--b28z25yb24gx.code.run/erc8183`    |
| `ERC8183_POLICY_ADDRESS`        | `0xd6a4217588f6b1f5657a92a3e94e6422ad771cea`           |
| `ERC8183_FUNDED_POLL_INTERVAL`  | Poll interval in seconds; defaults to `15`             |
| `VENUS_BSC_TESTNET_COMPTROLLER` | `0x94d1820b2D1c7c7452A163983Dc888CEC546b77D`           |

### Pinned public deployment addresses

`VENUS_BSC_TESTNET_COMPTROLLER` is sourced from the official
[`VenusProtocol/venus-protocol-documentation`](https://github.com/VenusProtocol/venus-protocol-documentation/blob/main/deployed-contracts/markets.md)
repository at `deployed-contracts/markets.md` → `BNB Chain Testnet` →
`Core Pool` → `Comptroller`. It is not inferred from an SDK default.

Read-only verification recorded on **2026-08-19**:

| Field                            | Result                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| Network                          | BNB Chain Testnet, chain ID `97`                                |
| Address                          | `0x94d1820b2D1c7c7452A163983Dc888CEC546b77D`                    |
| Observed block                   | `125982308`                                                     |
| `eth_getCode`                    | Passed; `1508` bytes of deployed bytecode                       |
| `getAccountLiquidity(0x000…000)` | Passed and ABI-decoded; error `0`, liquidity `0`, shortfall `0` |
| `getAssetsIn(0x000…000)`         | Passed and ABI-decoded; empty address array                     |
| Transactions                     | None; verification used only `eth_getCode` and `eth_call`       |

These are the two Comptroller methods called by the production
health-factor monitor. Successful decoding and the protocol-level success code
confirm that the pinned contract exposes the required Venus Core Comptroller
surface at the observed block.

`ERC8183_POLICY_ADDRESS` is sourced from the official
[`bnb-chain/apex-contracts`](https://github.com/bnb-chain/apex-contracts/blob/main/scripts/addresses.ts)
repository at `scripts/addresses.ts` → `ADDRESSES.bscTestnet.policy`. Relic's
Phase 05 zero-price lifecycle also used this whitelisted policy successfully.

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
`WALLET_ADDRESS`. For the 256 MB BSC Testnet service, inject the testnet-only
deployment Keystore V3 described below as a Northflank secret file only after
the human custody checkpoint. Mount its directory read-only where possible. Do
not commit the keystore, place it in a Docker build argument, encode it into
source, or paste its contents into logs.

`PRIVATE_KEY` is explicitly forbidden at runtime. This prevents first-run key
import and, together with the exact keystore check, prevents the SDK's fallback
wallet-creation behavior. No private key, password, connection string, or
keystore is present in the image.

### Testnet-only deployment keystore

The original `.studio/wallets` V3 keystore retains its strong scrypt KDF and
must remain unchanged. Northflank's free 256 MB container cannot decrypt that
KDF without exceeding its memory limit. A one-time local utility can
re-encrypt the **same BSC Testnet key** with Geth-style light scrypt parameters
`N=4096`, `r=8`, and `p=6`:

```sh
pnpm --filter @relic/health-factor-monitor keystore:testnet-deployment
```

The utility accepts the password only through the existing `WALLET_PASSWORD`
environment or ignored local environment-file mechanism. It also requires the
public `WALLET_ADDRESS`, defaults `WALLET_KEYSTORE_DIR` to `.studio/wallets`,
and refuses to run if `PRIVATE_KEY` is present. It decrypts only in process
memory, uses fresh random salt, IV, and UUID, verifies both encrypted
representations resolve to the exact configured checksummed address, verifies
in-memory key equality, and writes once to:

```text
agents/health-factor-monitor/.deployment-secrets/wallets/${WALLET_ADDRESS}.json
```

Both `.studio` and `.deployment-secrets` are excluded from Git and the Docker
build context. The utility refuses to overwrite an existing deployment file.
The lighter-KDF file is a **BSC Testnet deployment-only secret**; it is not a
replacement for the original custody keystore and must not be used on BSC
Mainnet. Mainnet requires a strong memory-hard KDF with sufficient container
memory, or a dedicated remote signer/custody architecture. The runtime rule
forbidding `PRIVATE_KEY` remains unchanged.

The local conversion completed on **2026-08-20** for checksummed address
`0x323F064B777745703Fa8eB56109A763503AeE4Dd`. The persisted deployment file
was validated as V3, `aes-128-ctr`, scrypt `dklen=32/N=4096/r=8/p=6`, with a
fresh 32-byte salt, 16-byte IV, version-4 UUID, and file mode `0600`. Decrypting
both representations recovered the same address and identical in-memory key;
the utility verified the original encrypted file did not change.

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

## Startup memory diagnostics

`dist/service.js` is a lightweight bootstrap with no static runtime imports. It
emits a `[startup-memory]` JSON record before loading the orchestrator and after
each environment, viem, Postgres, keystore, ERC-8183, Venus, HTTP, and funded
polling stage. Values are bytes and include `rss`, `heapUsed`, `heapTotal`,
`external`, `arrayBuffers`, the RSS change from the prior stage, and the
process high-water RSS.

The original strong-KDF baseline below was measured read-only on
**2026-08-20** using an isolated temporary V3 keystore with the same SDK/KDF
behavior, the development database, and BSC Testnet RPC. It did not use the
production wallet or send a transaction:

| Stage                                | RSS (bytes) | RSS increase (bytes) |
| ------------------------------------ | ----------: | -------------------: |
| Process start                        |  40,796,160 |                    0 |
| Environment/config initialized       |  42,942,464 |              147,456 |
| viem/RPC imported                    |  73,203,712 |           30,261,248 |
| Postgres initialized                 |  77,185,024 |            2,768,896 |
| Keystore structurally validated      |  77,266,944 |               32,768 |
| BNB Agent SDK / ERC-8183 imported    |  85,393,408 |            8,126,464 |
| Keystore decrypted                   | 362,446,848 |          277,053,440 |
| BNB Agent SDK / ERC-8183 initialized | 386,613,248 |           24,166,400 |
| Venus initialized                    | 386,613,248 |                    0 |
| HTTP runtime initialized             | 386,711,552 |               98,304 |
| Funded-job polling initialized       | 386,809,856 |               98,304 |
| Idle steady state after 30 seconds   | 112,672,768 |         -277,512,192 |

The strong-KDF baseline process high-water mark was `400,113,664` bytes. The dominant
allocation is SDK `0.5.0` V3-keystore decryption: its scrypt parameters are
memory-hard and the temporary KDF buffers alone account for roughly 270 MB.
The buffers are reclaimed after startup, but a 256 MB cgroup can terminate the
process before reclamation. Consequently the original strong keystore is **not
safe on the Northflank 256 MB plan**, despite an expected idle footprint near
110–120 MB. It remains the unchanged custody representation. Only the
explicitly testnet-only deployment representation may use the documented light
KDF; this exception does not apply to Mainnet.

### Testnet deployment-keystore profile

A second read-only profile on **2026-08-20** used the deployment keystore for
the exact registered testnet address, the development database, and a local RPC
gate that permitted only read methods. The gate forwarded 18 BSC Testnet reads,
blocked no methods because the SDK attempted no write method, and observed no
pending funded job. No transaction, blockchain write, or fund expenditure
occurred.

| Stage                                | RSS (bytes) | RSS increase (bytes) |
| ------------------------------------ | ----------: | -------------------: |
| Process start                        |  40,714,240 |                    0 |
| Environment/config initialized       |  42,958,848 |            2,244,608 |
| viem/RPC imported                    |  72,974,336 |           30,015,488 |
| Postgres initialized                 |  76,333,056 |            3,358,720 |
| Keystore structurally validated      |  76,398,592 |               65,536 |
| BNB Agent SDK / ERC-8183 imported    |  83,656,704 |            7,258,112 |
| Deployment keystore decrypted        |  99,008,512 |           15,351,808 |
| BNB Agent SDK / ERC-8183 initialized |  92,160,000 |           -6,848,512 |
| Venus initialized                    |  92,274,688 |              114,688 |
| HTTP runtime initialized             |  92,536,832 |              262,144 |
| Funded-job polling initialized       |  92,602,368 |               65,536 |
| Initial funded-job scan, 5 seconds   | 123,944,960 |           31,342,592 |
| Idle steady state after 30 seconds   |  91,766,784 |          -32,178,176 |

The synchronous entrypoint high-water RSS was `104,448,000` bytes. Including
the initial funded-job scan, the conservative full-startup high-water RSS was
`124,731,392` bytes. The deployment-keystore decryption delta was only
`15,351,808` bytes, down from the strong-KDF baseline delta of `277,053,440`
bytes. The largest direct import jump is now viem/RPC at `30,015,488` bytes,
not keystore decryption.

Against a conservative decimal 256 MB limit (`256,000,000` bytes), the
observed high-water mark leaves `131,268,608` bytes (about `125.2 MiB`) of
operational headroom. The measured 30-second steady state was `91,766,784`
bytes; a realistic idle range remains approximately 90–120 MB. This exceeds
the required 40–60 MB startup margin, so the testnet runtime is realistically
memory-safe on Northflank `nf-compute-10`. A true local 256 MB cgroup run was
not available because the profiling host has no Docker runtime; the conclusion
therefore rests on process high-water RSS rather than a local cgroup kill test.
Continue monitoring Northflank RSS during real funded-job analysis, whose
analysis module remains intentionally lazy-loaded.

## Local verification without secrets

The production entrypoint intentionally cannot advertise readiness without the
real encrypted keystore and database. Safe secret-free verification consists
of building the image and confirming that startup fails before listening when
required configuration is absent. Full `/health` and `/ready` verification
belongs after the human-approved secret-file and environment provisioning
checkpoint; do not substitute dummy custody or report a preflight container as
operational.
