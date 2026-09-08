# Yield Optimizer implementation plan

This checklist is intentionally ordered. A later phase cannot be enabled while
an earlier phase is incomplete.

| Phase | Deliverable | Exit gate | Status |
| --- | --- | --- | --- |
| 0 | Scope and safety contract | V1 is USDT + Venus, supply/withdraw only | Complete |
| 1 | Network configuration and deterministic policy | No address defaults; invalid intent cannot reach signing | Complete |
| 2 | Live deployment verification | `verify-deployment` validates chain, bytecode, token, vToken and Comptroller relation against the injected runtime configuration | Ready for operator validation |
| 3 | Durable job state | Idempotency state machine, atomic Postgres repository/migration, authenticated Relic API endpoints, funded-session release, and canonical funded-job relay are implemented | Complete |
| 4 | Bounded-session signer integration | Layer A fetches an encrypted one-job session after funding, opens it only in memory, and constructs an Altana signer constrained to the mandate's exact contracts and spend cap | Complete |
| 5 | Venus transaction adapter | Fixed calldata builders, receipt polling, allowance reads, USDT/vToken balance reconciliation, and canonical `approve → supply → withdraw` durable transitions are implemented | Complete in code; live proof pending |
| 6 | Private Layer A runtime | Bearer-only HTTP service, `/health`, `/readiness`, Dockerfile, canonical relay, per-job signer, reader, and durable store are connected. It remains unavailable until verified deployment configuration is injected | Complete in code; deployment pending |
| 7 | Public Layer B gateway | `/apex`, agent card, skill allowlist, internal forwarding | Complete |
| 8 | Northflank deployment | Two-service deployment, secrets, external card and readiness checks | Not started |
| 9 | Marketplace and real-fund proof | Verified offer, small testnet USDT supply and withdrawal receipts | Not started |
| 10 | Second venue migration | Independent adapter and constrained cross-venue move | Not started |
| 11 | Mainnet readiness | Separate identity, contracts, signer, canary, monitoring and explicit enablement | Not started |

## Non-negotiable release gates

- There is no mainnet switch in this release.
- The runtime never sends a transaction without a Relic-bound buyer mandate.
- A failed or stale protocol verification makes Layer A not ready.
- A job may only use the exact USDT and Venus vToken verified at startup.
- A transaction receipt and balance reconciliation are required before a job advances.
- Layer A accepts only Relic's canonical funded-job relay; it must never infer funding from a public A2A request.
