# Relic mandates and activation

## Product principle

Relic never turns a vague request such as “manage my money” into authority. An
activation creates a human-readable, machine-enforceable mandate whose exact
network, capabilities, protocols, assets, limits, duration, approval mode, risk
constraints, and stop conditions are stored as structured data.

The interface can help a person configure this structure. It is not the policy
engine. Runtime authorization must evaluate the approved deterministic mandate.

## Canonical schema

Phase 09 adds four server-side tables through additive migration
`0011_lean_nebula.sql`:

- `mandates` — stable relationship, principal, agent, network, current status,
  current/active version, attention state, and authorization boundary.
- `mandate_versions` — immutable versioned objectives, allow/deny capability
  sets, assets, protocols/contracts, amount limits, rate limits, times, approval
  mode, risk constraints, and stop conditions.
- `mandate_evidence_bindings` — the ERC-8004 identity, marketplace service,
  Actionable tier, verification time, network, verified capability set, and
  exact evidence snapshot relied on for that version.
- `mandate_events` — timestamped activity and security audit records with
  evidence references. The event vocabulary already covers invocation,
  recommendation, execution request/approval/rejection, result, and completion
  or failure for the future Execution Room. Phase 09 does not fabricate these
  later events.

All four tables have RLS enabled and no anonymous or authenticated Data API
policy. Direct server-side Postgres remains the application boundary.

## Approval modes

- `OBSERVE_ONLY`: inspect state and produce results; no transaction submission.
- `ASK_BEFORE_EXECUTION`: prepare an action, but require approval for each
  execution.
- `PRE_AUTHORIZED`: execute only inside deterministic constraints.

An agent can use only modes supported by its independently verified capability
profile. The Health Factor Monitor currently supports `OBSERVE_ONLY` only.

## Lifecycle

`DRAFT → REVIEWED → ACTIVE → PAUSED → ACTIVE` is the normal path. Terminal or
exception states are `REVOKED`, `EXPIRED`, `FAILED_ACTIVATION`, and
`SUPERSEDED`.

Every security-sensitive transition is atomic with an audit event. Activation
requires explicit approval after review. Pause blocks authorization. Resume
reruns current eligibility and evidence checks. Revoke is permanent and a
revoked mandate never passes execution preflight.

## Preflight and capability enforcement

The server, rather than the browser, verifies:

1. the agent still satisfies the existing public Actionable definition;
2. its service evidence is current and available;
3. the service and network match the evidence-bound version;
4. requested approval mode and capabilities are verified;
5. assets, protocols, and contract addresses are within the verified profile;
6. per-action and aggregate limits are coherent;
7. start and expiry times are valid; and
8. observe-only policy contains no transaction authority.

Execution preflight additionally rejects inactive, paused, revoked, expired,
superseded, stale, or attention-required authorization and checks capability,
asset, per-action, and aggregate limits.

Mandate API writes require a short-lived HMAC-authenticated server-to-server
request using `MANDATE_API_SECRET`. Production refuses to enable mandate writes
without the secret. The current UI uses a configured development principal via
`RELIC_DEVELOPMENT_PRINCIPAL_ID`; this is explicitly not wallet authorization.

## Evidence binding and stale-agent safety

Each version preserves the exact ERC-8004 identity, registry, service endpoint,
verification tier/time, capability set, and supporting fact snapshot used when
the person approved it. Later evidence changes do not rewrite history.

Active and paused relationships are rechecked when read or before a sensitive
transition. If the agent falls below public eligibility, becomes stale, changes
service/network, or cannot be verified, Relic marks the mandate as needing
attention, pauses an active relationship, blocks new execution, and preserves
all prior activity.

## Editing, pause, and revoke

Editing produces a new `DRAFT` version, supersedes the prior version, clears the
active version, and requires review plus explicit approval again. Previous rows
and their evidence remain immutable history. Pause is reversible only after a
fresh safety check. Revoke is permanent.

## Health Factor Monitor template

The conservative monitoring template authorizes only:

- position observation;
- health-factor calculation;
- alert generation; and optionally
- recommendation generation.

It binds to BNB Chain Testnet and Venus, defaults to a 1.30 alert threshold and
seven-day duration, and explicitly denies transfer, borrow, repay, swap,
approval, and transaction-submission capabilities. It grants no asset spending
authority and stores no private key.

## Mandates versus ERC-8183

A mandate is a standing Relic policy. An ERC-8183 job is a specific commercial
engagement. A mandate may later permit one or many jobs, but Phase 09 activation
does not create a job, invoke a paid service, or submit a transaction.

The database field `authorization_boundary` distinguishes `POLICY_ONLY` from a
future `WALLET_AUTHORIZED` state. Phase 09 produces `POLICY_ONLY` mandates only.

## Future wallet and delegated authorization boundary

The seller's encrypted testnet signing wallet is infrastructure for the seller;
it is never treated as the user's authorization wallet. No raw private key is
requested or stored. A future account, wallet, session-key, or custody adapter
must authenticate the principal and attach a separate wallet-authorization
artifact without changing the mandate's deterministic policy semantics.

Before the Execution Room can submit work, Relic still needs production user
accounts/wallet sessions, delegated authorization integration, execution/rate
accounting, approval UX for `ASK_BEFORE_EXECUTION`, and continuously evaluated
stop conditions.
