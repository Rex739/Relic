# Relic Yield Optimizer — handoff

## Objective

Build a real, actionable **BSC Testnet** yield optimizer for the Relic
marketplace. V1 must move small real testnet funds safely; it is not a
read-only scout and has no mainnet switch.

The first proof is deliberately one venue, Venus Core Pool:

`buyer-mandated job → exact USDT approval → Venus supply → receipt/balance check → Venus withdrawal → receipt/balance check`

Only after that succeeds should a second protocol be added for a true
cross-venue migration.

## Architecture

- **Layer B — public gateway**: A2A card and `POST /apex`; it has no wallet
  and forwards only `negotiate` and `notify_funded` to Layer A.
- **Layer A — private executor**: the sole session signer and protocol caller;
  bearer-authenticated inside Northflank and never public.
- **Relic Postgres**: durable execution job ledger, idempotency, transaction
  hashes, revision locks, and recovery state.

## Safety invariants

- Chain is hard-locked to BSC Testnet (`97`).
- Runtime contract addresses and RPC URL are injected; none has a source-code
  default.
- Readiness fails if live RPC/bytecode/token/vToken/Comptroller checks fail.
- Only exact USDT approval, Venus `mint(uint256)`, and
  `redeemUnderlying(uint256)` calldata can be constructed.
- No native BNB value transfer, arbitrary target, wrong account/chain,
  insufficient gas reserve, or failed simulation can broadcast.
- A stale worker cannot overwrite a newer state or duplicate a job.
- Ambiguous transaction outcomes require recovery; they are never blindly
  retried.

## Completed checkpoints

| Commit | What it added |
| --- | --- |
| `3991971` | Initial executable optimizer scaffold and public gateway |
| `70c7ab4` | Live Venus deployment verifier and guarded job state model |
| `7d1b486` | Durable Postgres execution-job migration/repository |
| `2149ee5` | Final bounded-session signing boundary |
| `e8f157f` | Fixed Venus approval/supply/withdrawal calldata adapter |
| `0f9bf74` | Private Layer A runtime, bearer enforcement, Dockerfile |
| `36fc22f` | Funded per-job session materialization and in-memory Altana signer |
| `e0bfb37` | Canonical funded-job relay through Layer B |
| `1ef8f30` | Buyer checkout, constrained Yield Optimizer session, and Venus approval flow |
| `f45ec79` | Packages the private executor's production runtime dependencies |
| `e8ebced` | Enforces the configured per-job USDT cap before a session is released |

The live preflight was run read-only against the official Venus BSC Testnet
USDT market. It confirmed that its USDT uses **6 decimals**. The runtime still
requires all values be supplied through environment configuration at deploy
time and validates them again.

## Current state

- Layer B is public on Northflank and serves a valid agent card whose `url`
  advertises the executable `https://…/apex` endpoint. Layer A is private on
  port 9000 and is healthy after Venus readiness verification.
- The verified BSC Testnet Venus configuration is injected through deployment
  environment only. Testnet USDT is **6 decimals**, and the initial strict
  cap is **100000 base units = 0.1 test USDT**. The API enforces that cap
  before releasing a session and Layer A enforces it again before execution.
- The Relic API and web ECS deployments are live with the required Yield
  Optimizer environment values. The API holds only the session-encryption key
  and transfer public key; Layer A holds the matching transfer private key.
  No seller owner key or persistent seller Altana session is deployed.
- A fresh local owner wallet has been imported and funded for ERC-8004
  registration. Its bounded Studio session is local only.
- ERC-8004 registration is currently blocked upstream: the 8004scan
  `GET /api/v1/agents` indexer returns HTTP 500 for both BSC Testnet (97) and
  BSC Mainnet (56). The Studio CLI calls this indexer before broadcasting, so
  no registration transaction or gas spend has occurred.
- Unrelated unstaged work must be preserved, including the LP Rebalancer,
  Health Guard, API, and web changes outside this agent directory.

## Exact next task

When 8004scan recovers, register the fresh seller owner wallet with the public
agent-card URL, import the resulting identity into Relic, and set the **Relic
listing UUID** (not the ERC-8004 token ID) as
`RELIC_YIELD_OPTIMIZER_AGENT_ID` in the Relic API deployment. Then verify and
activate the marketplace offer before funding a deliberately tiny 0.1-USDT
testnet job.

## Later phases — do not skip

1. Register/import/verify the marketplace identity and offer when the upstream
   ERC-8004 indexer is available.
2. Perform a deliberately small real-testnet USDT supply-and-withdraw proof
   and retain transaction receipts.
3. Add a second independently verified venue for cross-venue migration.
4. Treat mainnet as a separate release: new identity, wallet/session, verified
   contract configuration, canary limits, monitoring, and explicit enablement.
