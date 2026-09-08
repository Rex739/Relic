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

The live preflight was run read-only against the official Venus BSC Testnet
USDT market. It confirmed that its USDT uses **6 decimals**. The runtime still
requires all values be supplied through environment configuration at deploy
time and validates them again.

## Current state

- Layer A has `/health` and `/readiness`, and runs only canonical, funded
  requests through the per-job signer and durable ledger.
- Buyer checkout creates a reviewed mandate, shows the exact USDT cap, one-run
  amount, fee cap, and expiry, then requests a buyer-owned bounded session.
- The live runtime remains fail-closed until every injected deployment value
  has passed the read-only Venus verifier.
- An unrelated user-owned change remains unstaged and must be preserved:
  `agents/RelicLpRangeRebalancer/app/agent/studio.toml`.

## Exact next task

Deploy the code to Northflank, inject the verified values into both Relic API
and Layer A, then run the read-only verifier and readiness checks. Only after
those gates pass should a buyer fund a deliberately tiny testnet job.

## Later phases — do not skip

1. Deploy both Layer A and Layer B to Northflank using the documented two-service
   configuration.
2. Run Northflank readiness and public agent-card checks.
3. Register/verify the marketplace offer.
4. Perform a deliberately small real-testnet USDT supply-and-withdraw proof
   and retain transaction receipts.
5. Add a second independently verified venue for cross-venue migration.
6. Treat mainnet as a separate release: new identity, wallet/session, verified
   contract configuration, canary limits, monitoring, and explicit enablement.
