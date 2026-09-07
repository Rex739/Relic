# Yield Optimizer implementation plan

This checklist is intentionally ordered. A later phase cannot be enabled while
an earlier phase is incomplete.

| Phase | Deliverable | Exit gate | Status |
| --- | --- | --- | --- |
| 0 | Scope and safety contract | V1 is USDT + Venus, supply/withdraw only | Complete |
| 1 | Network configuration and deterministic policy | No address defaults; invalid intent cannot reach signing | Complete |
| 2 | Live deployment verification | `verify-deployment` validates chain, bytecode, token, vToken and Comptroller relation against the injected runtime configuration | Ready for operator validation |
| 3 | Durable job state | Idempotency state machine and atomic Postgres repository/migration are implemented; Layer A must inject this store before it may enable readiness | Ready for runtime wiring |
| 4 | Bounded-session signer integration | Code-only signing boundary validates mandate, session account, chain, target, gas reserve, and simulation before broadcast; runtime adapter remains to be connected to the scoped session | In progress |
| 5 | Venus transaction adapter | Fixed calldata builders for exact approval, `mint(uint256)`, and `redeemUnderlying(uint256)` are implemented; receipt and balance reconciliation will be wired in the private runtime | In progress |
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
