# Yield Optimizer implementation plan

This checklist is intentionally ordered. A later phase cannot be enabled while
an earlier phase is incomplete.

| Phase | Deliverable | Exit gate | Status |
| --- | --- | --- | --- |
| 0 | Scope and safety contract | V1 is USDT + Venus, supply/withdraw only | Complete |
| 1 | Network configuration and deterministic policy | No address defaults; invalid intent cannot reach signing | Complete |
| 2 | Live deployment verification | `verify-deployment` validates chain, bytecode, token, vToken and Comptroller relation against the injected runtime configuration | Ready for operator validation |
| 3 | Durable job state | Idempotency and receipt state-machine contract is implemented and tested; production adapter must use an atomic Postgres-backed store before Layer A is enabled | In progress |
| 4 | Bounded-session signer integration | Signer cannot exceed Relic buyer mandate | Not started |
| 5 | Venus transaction adapter | Simulate, approve exact amount, supply, withdraw, reconcile | Not started |
| 6 | Private Layer A runtime | Bearer-only routes, `/health`, `/readiness`, readiness runs phases 1–2 | Not started |
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
