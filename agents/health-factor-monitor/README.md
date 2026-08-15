# Relic health-factor monitor

This is the single Phase 05 **Relic-operated reference seller**. It is not
independent marketplace supply and its `relic_reference` classification is not
a trust score.

The TypeScript seller uses `@bnbagent/sdk@0.5.0`, advertises a zero raw-token
price, watches funded ERC-8183 jobs, reads a Venus Core position through
read-only RPC calls, and submits a structured deliverable. It cannot transfer,
repay, supply, approve, or sign arbitrary DeFi transactions.

Live startup is intentionally blocked unless a human provides the encrypted
keystore password locally. Wallet files (`.wallets/`) and deliverables
(`.agent-data/`) must remain untracked. Deterministic tests inject a reader whose
result is explicitly labelled `fixture`; production uses `VenusCoreReader`,
whose result is explicitly labelled `onchain` with its observed block.

Agent Studio CLI `bag 0.0.5` did not expose a TypeScript scaffold flag when
inspected on 2026-08-14, so this follows the current first-class TypeScript SDK
provider primitives rather than generating an obsolete Python/ADK service.
