# Execution Control and Execution Room

Phase 11 preserves this deterministic control plane and adds separate commerce
agreement and authorization boundaries. A policy decision is never a wallet
signature. Wallet-backed transactional approvals must use EIP-712 bound to the
exact canonical action hash; Development API approval is rejected for
wallet-backed mandates. See `docs/product/agent-commerce-marketplace.md`.

## Boundary audit

Phase 09 development requests are authenticated by a server-side HMAC. The
Next.js server derives it from `MANDATE_API_SECRET` and signs timestamp, method,
path and the configured `RELIC_DEVELOPMENT_PRINCIPAL_ID`. The API accepts only a
60-second clock window. This is internal development API authentication: it is
not a browser identity, wallet signature, mandate-approval signature, session
key, delegated authority or transaction signature. Request bodies are not
covered by that HMAC. Phase 10 therefore persists and hashes a canonical action,
uses idempotency keys, and binds any execution approval to that action hash.

## Policy pipeline

Every proposal follows a fixed pipeline:

1. Preserve the raw request.
2. Normalize the action and calculate a stable SHA-256 hash.
3. Load the exact active mandate version and current verified service.
4. Evaluate status, expiry, network, capabilities, protocol, contract, asset,
   limits, frequency, approval mode and stale-service state.
5. Persist `ALLOW`, `REQUIRE_APPROVAL` or `DENY` with structured reasons.
6. Reserve financial budget transactionally where applicable.
7. Execute only through a capability-specific adapter.
8. Persist independently observed evidence and a receipt.

No LLM output is an authorization decision.

## Canonical action

An action records its ID, idempotency key, mandate and version, agent, principal,
network, type, capability, protocol, target, asset, amount, destination,
parameters, request time, deadline, evidence source and normalized hash. The raw
agent payload remains separate from normalized policy input.

Lifecycle states are `REQUESTED`, `EVALUATING`, `APPROVAL_REQUIRED`, `APPROVED`,
`EXECUTING`, `SUCCEEDED`, `FAILED`, `DENIED`, `EXPIRED`, `CANCELLED` and
`BLOCKED_STALE_AGENT`. Transitions are conditional database updates.

## Approvals and signing

`OBSERVE_ONLY` permits verified non-transactional capabilities and rejects any
asset movement or contract write. `ASK_BEFORE_EXECUTION` produces an approval
record bound to the normalized action hash. Each execution accepts at most one
approval; changing amount, destination, network, protocol, contract, mandate
version or deadline changes the hash. `PRE_AUTHORIZED` means only that policy
constraints passed. It does not mean Relic can sign.

`AuthorizationProvider` and `ExecutionSigner` are deliberately separate. Their
interfaces can later support wallet confirmation, smart-account permissions,
session keys or remote custody. No provider is currently configured as a user
wallet signer, and the seller wallet is never used as user authority.

## Budget and replay safety

The database tracks committed, succeeded and released reservations. Mandate-row
locking and an aggregate-limit recheck prevent concurrent requests from
overcommitting a budget. Read-only observations create no reservation and cost
zero. A principal/idempotency-key uniqueness constraint prevents duplicate API
delivery; a principal/action-hash constraint prevents the same normalized action
from becoming a second execution.

## Freshness and evidence

The evaluator re-resolves the current Actionable marketplace profile. A stale,
unreachable, conflicted or changed service creates a structured denial,
`BLOCKED_STALE_AGENT`, and a mandate attention event without deleting history.
Policy decisions, approvals, invocation transitions, provider responses,
receipts and outcomes retain evidence references. Provider-reported success is
not promoted to independently verified success without observation.

## Health Factor execution

The initial runner is BSC Testnet-only and read-only. It verifies the durable
ERC-8183 service status, then independently calls the validated Venus Core Pool
Comptroller at a single observed block. It persists liquidity, shortfall,
entered-market count, empty-position state, service evidence and block evidence.
It never signs or submits a transaction. Transfers, approvals, borrowing,
repayment and swaps are denied by the existing observe-only mandate.

## ERC-8183 adapter boundary

The adapter can prepare negotiation, job creation, funding requirements,
provider submission and settlement reconciliation. Preparation is separate from
submission. Phase 10 does not create an ERC-8183 job or send a blockchain write.

## Execution Room

`/my-agents/[activationId]` combines the current mandate, state, expiry, approval
mode, controls and real execution activity. Each action shows what happened,
the deterministic reason, protocol, network, cost, action hash and receipt
evidence. `/my-agents` remains the relationship summary and now links into this
operating view.
