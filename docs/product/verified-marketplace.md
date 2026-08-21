# Verified marketplace product rule

Relic's public marketplace is a curated operating surface, not an ERC-8004
directory. An identity being registered or discoverable does not make its
service safe or useful. Relic therefore maintains two deliberately separate
universes:

- the internal corpus contains every discovered identity and its evidence,
  including incomplete, malformed, unreachable, stale, and unverified records;
- the public marketplace contains only agents whose current service has passed
  Relic-controlled verification.

This separation is enforced by the server-side marketplace repository. The web
application never downloads the corpus and filters it in the browser.

## Public listing threshold

An agent is public-eligible only when all of the following are true:

- it has a valid ERC-8004 identity with an owner, supported chain, registry, and
  external agent ID;
- its name, description, and metadata URI are usable;
- a category candidate and matching marketplace service have reached
  `INVOCATION_VERIFIED` or `ACTIONABLE` / `COMMERCE_VERIFIED`;
- the service exposes a public HTTPS endpoint, is currently `available`, and
  has a successful Relic verification observation;
- the successful verification is within the configured freshness window
  (seven days by default);
- no latest reconciliation record reports an unresolved identity or service
  mismatch.

Registration, metadata, ownership, or a declared MCP, A2A, x402, b402, or
ERC-8183 interface is never sufficient by itself. Public detail and comparison
queries apply the same eligibility predicate as public search, so a hidden
corpus record cannot be recovered by guessing its ID.

## Human-facing tiers

### Working

Relic independently confirmed identity, endpoint reachability, the claimed
interface, and a successful controlled invocation or negotiation. This maps to
the current `INVOCATION_VERIFIED` state.

### Actionable

The agent satisfies Working and also has a successful recorded commerce or
execution lifecycle, with the candidate at `ACTIONABLE`. Examples include a
verified ERC-8183 job, provider response, execution result, and settlement
evidence. Working-only profiles explain that hiring is unavailable until this
path is independently verified.

### Proven

The product and filter reserve this tier for future repeated outcome evidence.
No agent becomes Proven merely because Relic operates it, and the current
implementation intentionally returns no Proven inventory. A future policy may
consider repeated executions, reliability, latency, cost, credible external
feedback, and failure rate, but it must remain evidence-backed and explainable.

## Freshness and stale handling

Current operability is part of eligibility. A service falls out of normal
public search when its verification expires, its availability becomes degraded
or unavailable, or its latest reconciliation exposes an unresolved conflict.
Historical observations and outcomes remain in the internal corpus. They are
not deleted to make the current marketplace look clean.

## Ranking

Public results rank Actionable agents before Working agents, then use the
freshness of successful verification, name, and stable identity ordering. Relic
operator status does not boost rank. Future ranking may incorporate category
relevance, repeated outcomes, service completeness, and credible reputation,
provided each signal is visible and explainable. Registration age, owner
popularity, self-declared claims, and arbitrary AI scores are not quality
signals.

## Provenance and evidence

Agent Intelligence profiles retain field-level provenance and translate stored
labels into user-facing language:

- `onchain_verified` → Onchain verified;
- `independently_observed` → Independently observed;
- `agent_reported` → Agent reported;
- `developer_declared` → Developer declared;
- `secondary_unverified` → Secondary / unverified.

Verification badges describe the checks that support them. Classification
explanations come from stored matching evidence, never generated claims.
Advanced identity details remain secondary to capability and operational
evidence.

## Categories and network behavior

Rebalancing, Grid Trading, Yield Optimisation, and Health Factor Monitoring are
first-class categories. Their public counts are calculated from currently
eligible supply, with Actionable shown as a subset of workable agents. An empty
category says that no agent has passed verification; it never backfills the
page with internal candidates.

Chain ID 56 is labeled BNB Chain and chain ID 97 is labeled BNB Chain Testnet.
Testnet reference sellers receive a visible network indicator and must never be
presented as Mainnet inventory. The model is not hardcoded to make testnet the
production default.

## Neutral supply

Third-party, partner, and Relic-operated reference sellers use the same listing
predicate and ranking. Operator provenance is labeled because it helps users
interpret evidence, not because it grants preferential treatment. Reference
sellers prove missing ecosystem capabilities and commerce paths; they do not
stand in for a neutral marketplace.

## 8004scan boundary

8004scan is an optional discovery source for the internal corpus. It is not
called from the browser and is not Relic's public trust authority. Corpus
discovery flows through offline enrichment, selective verification, and the
public threshold before an identity can appear in the marketplace. Direct
onchain evidence and Relic-controlled observations remain stronger sources.
The marketplace automatically incorporates newly verified supply when the
corpus grows; it does not depend on a full Pro crawl to operate.

## Product boundary

Phase 08 ends at evidence-backed discovery, profiles, and comparison. An
Actionable profile prepares the transition to activation, while Working-only
profiles explain why commerce remains unavailable. Mandate preview, spending
limits, permissions, pause/edit/revoke, My Agents, and the Execution Room belong
to the activation phase and must not be simulated before those controls exist.
