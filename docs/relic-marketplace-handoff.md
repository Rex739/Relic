# Relic marketplace — project handoff

## What we are building

**Relic** is a seller-controlled marketplace for actionable on-chain agents on
BNB Chain Testnet. A seller registers an ERC-8004 agent identity, points Relic
to a verified public agent service, configures a marketplace offer, and buyers
hire the agent under explicit, constrained terms.

Relic is not an agent host and must never receive a seller's private key. It
verifies public services, displays offers, creates buyer agreements/jobs, and
retains auditable marketplace and execution records.

## Core universal seller flow

This flow must work for every future agent category, not just grid trading or
yield optimization.

1. Seller creates or connects an **agent-owned wallet**. The seller retains
   control; Relic does not request a private key.
2. Seller grants a bounded runtime session to the agent wallet and funds it
   with a small BNB Testnet gas balance.
3. Seller deploys the agent as two Northflank services:
   - **Layer A private executor**: session signer, protocol logic, private
     health/readiness endpoints.
   - **Layer B public gateway**: public agent card and `/apex`; no wallet or
     signing authority.
4. Layer B exposes `/.well-known/agent-card.json`. The card advertises its
   actual executable endpoint (normally `<public-origin>/apex`), not the card
   URL itself.
5. Seller registers/imports the ERC-8004 identity in Relic and proves current
   wallet ownership by signature only.
6. Relic fetches the public card, derives the executable endpoint and category
   from skills/tags, and pre-fills the seller profile. The seller may review
   the endpoint but should not need to discover it manually.
7. Relic verifies the endpoint and advertised capability. Verification is
   asynchronous but compact: it provides an obvious pending/success/failure
   status, a retry action, and useful technical detail without blocking normal
   profile editing.
8. Once verified, seller creates an offer draft, sets price, buyer deliverable,
   and limitations, then activates it. Activation re-checks the exact live
   provider/service card before an offer can become live.
9. Buyer discovers the live offer, agrees to explicit constraints, funds a
   job, and receives execution/settlement evidence.

## Endpoint and category rules

- The **identity endpoint** may be the public card URL.
- The **marketplace service endpoint** must be the executable URL derived from
  the card's `url` field, for example `/apex`.
- Relic should derive category from the entire card: skill IDs/names,
  capability metadata, tags, and description. Tags are useful evidence, not
  the sole source of truth.
- Never assume all services use `/apex`; Relic should use the executable URL
  that the valid card advertises.

## Existing product behavior and UI decisions

- Seller profile image is user-selected from their device, stored by Relic as
  profile data, and must reject files above **2 MB** before upload.
- “Request verification” triggers a safe provider check; a change to the
  service endpoint triggers a fresh verification.
- Offer activation failures must remain in a draft state and show actionable
  plain-language recovery guidance plus optional technical detail.
- Activation/deactivation uses the Relic toast system in the existing warm
  red/dark visual theme.
- Offer editor design:
  - collapsed by default;
  - status is a badge, not plain text;
  - activation sits beside “Save changes”;
  - use a secondary button for activation;
  - “Discard draft” is an underlined subtle hover action at the bottom;
  - mobile spacing matches the profile editor.
- Do not present stale verification timestamps as a production blocker unless
  a real check is actually required.

## Known agents and deployment pattern

Existing marketplace agents include the BNB Grid Trader and LP Range
Rebalancer. Their public gateways provide the reference pattern for new agents.

Northflank conventions:

- Layer A: private, usually port `9000`, `GET /health` + `GET /readiness`.
- Layer B: public, usually port `8003`, `GET /health` + `GET /ready`, public
  card plus `POST /apex`.
- Both layers share `PRIVATE_AGENT_BEARER_TOKEN`.
- Layer B uses Layer A's internal `.local:<port>` Northflank address and may
  use internal HTTP only there. Public traffic uses the Northflank HTTPS domain.
- Layer A secrets include `ALTANA_SESSION`, RPC configuration, and any
  protocol-specific values. Never place secrets in build arguments or source.

## Current Yield Optimizer work

The Yield Optimizer is a new actionable marketplace agent, not a replacement
for the read-only Yield Scout. Its own technical handoff is at:

`agents/RelicYieldOptimizer/docs/handoff.md`

V1 is BSC Testnet USDT + Venus supply/withdraw only. It has a public gateway,
private executor skeleton, live deployment verification, bounded-signing
guard, fixed Venus call builder, and durable job-ledger migration. It is not
yet enabled to broadcast; the remaining bridge is intentional fail-closed
work, not a deployed trading claim.

## Current implementation priorities

1. Finish the Yield Optimizer private execution bridge and real Testnet proof.
2. Deploy its two services to Northflank, register/verify it, and make a live
   offer through the same universal seller flow.
3. Keep improving the marketplace only in ways that generalize to all future
   agents: endpoint discovery, category classification, verification recovery,
   profiles, offers, buyer agreements, and job evidence.
4. Mainnet is a later explicit release: new deployment values, new identity and
   wallet/session, canary limits, monitoring, and a full security review.

## Non-negotiable constraints

- Do not make an agent look executable until its public card, private executor,
  signing boundary, and verification checks are all working.
- Do not host or upload a seller-selected image on their behalf unless they
  explicitly ask; the normal product flow is user selects then Relic stores it.
- Do not spend/transfer/sign on behalf of a wallet without explicit user
  authorization for that concrete action.
- Preserve unrelated working-tree edits, especially
  `agents/RelicLpRangeRebalancer/app/agent/studio.toml`.
