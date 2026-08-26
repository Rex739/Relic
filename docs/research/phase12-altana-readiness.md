# Phase 12 Altana readiness

Verified against the repository's installed official `@bnbagent/sdk` package,
version `0.5.0`.

## Supported boundary

The SDK exposes `AltanaWalletProvider` as an optional integration for
provider-side agent wallets. Its documented BNB Testnet preset requires
`@altananetwork/sdk` 0.5.x and supports scoped onchain sessions with contract
call allowlists, spend caps, expiry, revocation, ERC-8183 seller-quote signing,
and x402 session payment.

Altana does not replace Relic's Privy buyer authentication. The documented
integration is a provider/agent signing boundary; it is not a browser-wallet
primitive for silently approving the buyer's CREATE_JOB, REGISTER_JOB,
SET_BUDGET, or FUND transactions.

## Phase 12 decision

Relic is ready to add an Altana-backed provider wallet when an autonomous agent
needs narrowly scoped transaction authority. The current public Health Factor
Monitor is OBSERVE_ONLY, and its production safety model deliberately keeps
provider execution separate from blockchain submission. No Altana dependency,
session key, custody material, or new signing authority is introduced in Phase 12.

Any future integration must retain durable commerce-operation idempotency,
explicit signer roles, transaction-hash recording, reconciliation, and
fail-closed settlement controls. Serialized Altana sessions contain signing
material and must be handled as deployment secrets, never repository data.
