# Agent Commerce Marketplace

## Production boundary

Phase 11 adds commercial terms, buyer identity, explicit authorization,
durable ERC-8183 operations, and settlement evidence without replacing Relic's
existing control plane:

- ERC-8004 is seller identity and provenance.
- `marketplace_services` is independently inspected supply, not a price or
  order ledger.
- versioned `agent_offers` publish operator-authored commercial terms.
- `mandates` remain standing user policy.
- `execution_requests` remain the deterministic decision and idempotency
  boundary.
- `commerce_agreements` bind a buyer, exact offer version, exact mandate
  version, accepted terms, network, and price snapshot.
- `activations` remain the ERC-8183 job spine. Existing jobs are explicitly
  `VERIFICATION`; user jobs are `USER_COMMERCE`.
- `marketplace_outcomes` remains a public projection, not settlement truth or
  a custody balance.

## Exact values

All money is stored and compared as non-negative integer base units. Every
snapshot includes chain, token address, decimals, and display symbol. Human
decimals use `parseBaseUnits`; excessive precision, exponential notation,
negatives, unsupported decimals, and unsafe conversions fail closed. Policy
limit checks use exact decimal comparison and addition, never floating point.

## Offers and hiring

An offer is eligible only when its ERC-8004 owner matches the authenticated
operator and the service is current, available, Actionable, and recently
verified. A change creates a new immutable version and pauses an active offer
until explicit activation. Existing agreements retain their historical offer
version.

The separated hiring flow is:

1. review an active verified offer;
2. create and activate a mandate;
3. create a draft agreement;
4. accept the exact immutable terms hash;
5. sign EIP-712 commerce authorization;
6. request an execution and receive a policy decision;
7. sign a domain-separated exact execution approval when required;
8. prepare a `USER_COMMERCE` activation and durable ERC-8183 operation;
9. sign any required blockchain transaction in the user's wallet;
10. reconcile receipt, finality, delivery, evaluation, and settlement/refund.

Terms acceptance never implies transaction authority. Policy `ALLOW` never
implies that a signer exists.

## Wallet authentication and authorization

Wallet login uses a short-lived, one-time EIP-191 challenge bound to domain,
URI, address, chain, nonce, issue time, and expiry. Relic recovers the signer,
atomically consumes the nonce, stores only a random session-token hash, and
places the opaque token in a secure HttpOnly same-site cookie. Logout revokes
the server session. Private keys are never stored.

The web client uses Privy as its external-wallet connection layer. The login
modal is restricted to Ethereum-compatible wallets and BSC Testnet, and offers
both detected browser wallets and WalletConnect/QR connections for mobile
wallets. Privy supplies the connected wallet's EIP-1193 provider, but it does
not replace Relic's authorization boundary: Relic still issues and verifies
its own EIP-191 login challenge, EIP-712 commerce authorization, exact-action
authorization, and explicit wallet transactions. Embedded-wallet creation is
disabled. Configure `NEXT_PUBLIC_PRIVY_APP_ID` and, when the Privy application
uses app clients, `NEXT_PUBLIC_PRIVY_CLIENT_ID`. Both identifiers are public;
no Privy secret belongs in the browser bundle.

Production authorization uses two EIP-712 domains:

- `Relic Agent Commerce` binds agreement, principal, agent, offer version,
  terms hash, mandate/version, token, amount, network, nonce, and expiry.
- `Relic Exact Execution` also binds the canonical action hash, which commits
  protocol, target, parameters/calldata, value, and network.

Changing terms, amount, token, chain, mandate version, or action invalidates the
signature. Nonces are consumed once. Authorization artifacts retain the safe
normalized payload, signature, hashes, signer, expiry, revocation state, and
evidence reference. Delegated authorization, session keys, and smart-account
permissions are schema capabilities only; Relic does not claim they exist.

The Development HMAC principal remains non-production only. Development API
approval is rejected for wallet-backed mandates. The seller wallet is also
explicitly rejected as a buyer for a user-commerce activation.

## ERC-8183 operations and lifecycle

The richer activation lifecycle is canonical. Legacy status is written in the
same transaction as a compatibility projection. Every transition adds
canonical lifecycle, legacy projection, agreement event, and immutable
artifact evidence.

Every ERC-8183 write is represented by `commerce_operations`, with an
agreement-scoped idempotency key, operation and attempt, prepared payload hash,
signer/nonce, transaction and block identity, confirmation/finality state,
replacement link, retry counters, lease, scheduling, and structured failure.
The worker uses `FOR UPDATE SKIP LOCKED`, bounded exponential backoff, and
lease expiry for crash recovery. It never submits buyer transactions. `READY`
work without a real signer becomes `AWAITING_SIGNATURE`.

Submitted operations reconcile against receipts. Changed receipt block hashes
become `REORGED`; reverts become `FAILED`; successful transactions advance
through `CONFIRMED` to `FINALIZED` only after configured confirmation depth.
The local `pnpm dev` workflow starts the continuous, read-only commerce
reconciler through the indexer package. Production must run
`pnpm --filter @relic/indexer commerce:operations:watch` as a dedicated worker
process (or invoke the bounded `commerce:operations` command from a scheduler);
starting only the API does not perform receipt reconciliation.
Commerce reconciliation uses an explicit BSC Testnet (chain 97) RPC client and
does not inherit the corpus indexer's independently configured canonical chain.

### Job 618 runtime-drift reconciliation

On 2026-08-25, Relic reconciled BSC Testnet `CREATE_JOB` transaction
`0xe3edcda2310e663c5db57e5635d30e529e39f21280bdd0f69f094795cdd2341e`
at block `127035676` into durable job `618`. The canonical receipt and
`JobCreated` event bind the buyer, provider, evaluator, hook, and actual job
expiry. The operation is `FINALIZED`; its activation is
`ONCHAIN_CREATED / CURRENT`; no value movement or settlement exists.

Job 618's authoritative onchain expiry is `2026-08-25T23:16:31Z`. It is not
rewritten. The one-day expiry was generated by a non-watch API process started
before the source changed to the current seven-day base lifetime. Local API
development now loads the repository root `.env.local`, runs under Node watch,
and logs the safe lifetime configuration (`604800` seconds plus the policy
dispute window) at startup.

### Signed-quote setup window

`@bnbagent/sdk@0.5.0` fixes the provider signature lifetime at a maximum of
900 seconds. The provider later accepts a funded job only when the FUND block
timestamp falls inside the immutable `negotiated_at` → `quote_expires_at`
window. A six-hour seller quote is therefore not compatible with this SDK and
Relic does not patch or bypass that check.

Relic requests the SDK maximum explicitly and requires staged remaining
headroom before exposing each buyer transaction: 12 minutes at CREATE_JOB,
8 minutes at REGISTER_JOB, 4 minutes at SET_BUDGET, and 2 minutes at FUND.
CREATE_JOB also requires the buyer's exact-action authorization to cover the
initial 12-minute setup window. The Execution Room shows the signed-quote
countdown separately from buyer-authorization, job, and mandate expiry. An
insufficient window fails closed and requires a fresh signed negotiation and
fresh commerce attempt; an existing signed quote is never extended.

## Value, settlement, artifacts, and reputation

`commerce_value_movements` is append-only evidence for funding, escrow
lock/release, payment, refund, and fees. Onchain events are unique by chain,
transaction hash, log index, and movement type. Budget reservation and expected
payment are never value movement, and Relic never describes this ledger as
custody or balance.

`settlement_records` are immutable final assertions with exact
expected/funded/settled/refunded/fee amounts. Settlement requires delivery and
evaluation evidence. `commerce_artifacts` retains hashed terms,
authorizations, job specifications, delivery, evaluation, settlement,
rejection, and refund evidence with explicit provenance. Provider-reported
delivery stays provider-reported until independently or onchain verified.

Raw `commerce_reputation_observations` remain separate from projections. Only
`USER_COMMERCE` activations contribute commerce reputation. Historical
verification job 542 cannot count as buyer success. No opaque composite score
is introduced.

## Seller and public marketplace

`/operator/offers` lets an authenticated ERC-8004 owner create, version,
activate, pause, and deactivate offers and inspect only their agreements, jobs,
and settlements. The same ownership rule applies to Relic and third parties.

Public inventory distinguishes Working, Actionable, and Hireable. Hireable
means Actionable plus a current active offer with matching network, terms,
payment snapshot, and fresh service evidence. Dead, expired, paused, stale,
unavailable, or conflicted offers are never Hireable.

## Database security and real validation

Migrations `0013_phase11_agent_commerce.sql` and
`0014_phase11_authorization_challenges.sql` are additive. All new public tables
have RLS enabled and no `anon` or `authenticated` table privileges. The
server-side `DATABASE_URL` path and hardened default privileges are preserved.
They were applied to the configured development database on 2026-08-22 and
verified by read-back.

Real persisted ERC-8004 agent 1840 remains owned by
`0x323F064B777745703Fa8eB56109A763503AeE4Dd` on BSC Testnet and has a current
available Health Factor Monitor service. The owner authenticated using the
existing encrypted keystore; no `PRIVATE_KEY` was used. Relic created active
offer `a885e88f-ba15-4ddc-8b62-72953bc9efaf` for read-only Venus health-factor
monitoring at exactly 0 base units per execution. It is BSC Testnet-only, has
no signing authority or custody, made no blockchain write, and moved no funds.

Buyer agreement, buyer mandate, buyer signature, read-only execution, and
`USER_COMMERCE` preparation require a distinct user-controlled wallet. Relic
will not substitute the seller wallet.

## Mainnet boundary

Mainnet requires explicit wallet-auth domain/URI, commerce authorizer,
ERC-8183 commerce/evaluator deployments, token allowlists and decimals,
confirmation policy, RPC/explorer evidence, monitoring, and a strong remote
signer/custody or smart-account design. The lightweight testnet deployment
keystore is forbidden for Mainnet. Phase 11 does not switch networks, deploy
contracts, or grant autonomous signing authority.
