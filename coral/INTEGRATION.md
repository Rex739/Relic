# Relic CoralOS Integration

## Architecture

Existing public agent workflow:

```text
ASI:One
  -> existing Fetch Review Agent
  -> existing Fetch Verification Agent
  -> existing Relic review API
```

Local CoralOS governance demonstration:

```text
CoralOS local governance demonstration
  -> Review Governor
  -> Verification Bridge
  -> Release Policy Guard
  -> real Relic review API
```

Kaspa release-control prototype:

```text
Kaspa
  -> separate release-commitment prototype
  -> BLOCKED cannot become RELEASE_READY
```

## Responsibility Boundaries

The CoralOS adapters are governance adapters around the existing Relic workflow.

Review Governor:

- Accepts only the canonical Meridian Grid review request.
- Creates a dedicated Coral review thread.
- Delegates evidence verification to Verification Bridge.
- Sends verified evidence to Release Policy Guard.
- Produces a final governance summary.

Verification Bridge:

- Calls the real deterministic Relic review endpoint.
- Uses `POST https://relic-brown.vercel.app/api/review/run`.
- Returns review id, verdict, impacted components, critical paths, failed regression count, affected accounts, evidence digest, required sign-offs, and workspace URL.
- Does not mutate the review result.

Release Policy Guard:

- Receives verified evidence.
- Emits `REMEDIATION_REQUIRED` for the blocked Meridian Grid result.
- Includes: "This blocked review cannot be released by an agent. A separate clean review is required after remediation."
- Does not emit `RELEASE_READY` for a blocked result.

## Endpoint Contract

The existing Relic endpoint is:

```text
POST /api/review/run
```

Public deployment target:

```text
https://relic-brown.vercel.app/api/review/run
```

Request body: none.

Expected deterministic Meridian Grid result:

- `reviewId`: `REL-MER-2026-0701-001`
- `decision`: `BLOCKED`
- impacted components: `8`
- critical paths: `5`
- failed regression tests: `1`
- affected commercial accounts: `842`
- required human sign-offs: `Finance Systems Owner`, `Billing Policy Lead`

## Coral Runtime Model

Each adapter has a `coral-agent.toml` file with `edition = 3` and an executable runtime.

The agents must receive Coral runtime details from Coral Server:

- `CORAL_CONNECTION_URL`
- `CORAL_AGENT_ID`
- `CORAL_SESSION_ID`
- `CORAL_API_URL`

The agents must not hardcode `CORAL_CONNECTION_URL` and must not load `.env` overrides when running under Coral orchestration.

## Honesty Section

The CoralOS demo is a local governance adapter layer. It demonstrates scoped coordination and observability over Relic review capabilities. It does not replace the deployed Fetch.ai agents or claim remote Coral execution.

No payments, marketplace rental, wallet, Solana transaction, Kaspa transaction, or production deployment is involved.

## Official References

- CoralOS quickstart: https://docs.coralos.ai/guides/quickstart
- Writing Coral agents: https://docs.coralos.ai/guides/writing-agents
- Agent configuration: https://docs.coralos.ai/reference/agent
- Executable runtime: https://docs.coralos.ai/reference/agent/tables/runtimes/executable
- Coral Server repository: https://github.com/Coral-Protocol/coral-server

