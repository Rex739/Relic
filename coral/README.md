# Relic CoralOS Governance Proof

CoralOS is used as a local governance and observability layer for Relic’s review workflow. It scopes agent responsibilities, records handoffs, and prevents agents from issuing human release approval.

This folder contains a contained local CoralOS extension for Relic. It is not a marketplace feature, not a payment feature, not a Solana escrow flow, and not a replacement for Relic's existing Fetch.ai Review Agent and Verification Agent.

## What CoralOS Adds

Relic's existing product story remains unchanged:

Risky legacy-system change -> dependency mapping -> regression verification -> human release accountability -> Kaspa release-control state after a blocked finding.

The CoralOS proof adds a local governance plane around that workflow:

User request -> Coral-governed Review Governor -> isolated Meridian Grid review thread -> Verification Bridge -> Release Policy Guard -> deterministic governance conclusion.

The adapters in this folder do not replace:

- `relic-review-agent` on Fetch/Agentverse
- `relic-verification-agent` on Fetch/Agentverse
- the Kaspa Release Commitment prototype
- Conduct Legacy Knowledge
- the Relic review engine or API

## Agents

- `relic-review-governor`: creates the Coral review thread, delegates evidence verification, and requests policy evaluation.
- `relic-verification-bridge`: calls Relic's existing deterministic public review capability at `POST https://relic-brown.vercel.app/api/review/run`.
- `relic-release-policy-guard`: turns verified evidence into a constrained result. For Meridian Grid, the result must be `REMEDIATION_REQUIRED`.

No agent may issue a release approval, set `RELEASE_READY`, acknowledge for Finance or Billing, modify Relic findings, call a wallet, or submit a blockchain transaction.

## Requirements

The local demo follows current CoralOS guidance:

- Coral Server is cloned outside this repo.
- Coral Server is started with its Gradle wrapper.
- Agents are linked with `npx @coral-protocol/coralizer@latest link .`.
- Agents use the executable runtime.
- Each agent receives `CORAL_CONNECTION_URL` dynamically from Coral Server.

Recommended external checkout:

```bash
git clone https://github.com/Coral-Protocol/coral-server /tmp/relic-coral-server
```

Do not vendor Coral Server into this repository.

## Check Prerequisites

```bash
bash coral/scripts/checkPrerequisites.sh
```

The script checks Java, Git, Python, Node, the external Coral Server checkout, the Coral Server Gradle wrapper, and local agent manifests. It does not install anything.

## Start Coral Server

```bash
CORAL_AUTH_KEY=dev-local-only bash coral/scripts/startCoralServer.sh
```

Defaults:

- Coral Server checkout: `/tmp/relic-coral-server`
- Coral API: `http://localhost:5555`
- Coral Console: `http://localhost:5555/ui/console`

Use a local-only auth key. Do not commit credentials or expose this development server publicly.

## Link Agents

```bash
bash coral/scripts/linkAgents.sh
```

This uses the current Coralizer workflow and links:

- `coral/agents/review-governor`
- `coral/agents/verification-bridge`
- `coral/agents/release-policy-guard`

## Run the Meridian Grid Demo

```bash
CORAL_AUTH_KEY=dev-local-only bash coral/scripts/runMeridianGovernanceDemo.sh
```

The script creates a local Coral session with all three agents and supplies the canonical request:

```text
Review Meridian Grid’s proposed 7% regulatory surcharge for commercial customers above 10,000 kWh. Check for billing and ledger regression risk.
```

The script must not claim a final governance result unless Coral Server creates and runs the real session. It waits briefly for the real `GOVERNANCE_POLICY_RESULT`; after success, it prints the final deterministic result and writes the extended Coral session report under `coral/artifacts/`. Inspect the session in Coral Console to verify agents, thread messages, and handoffs.

## Inspect a Run

```bash
CORAL_AUTH_KEY=dev-local-only bash coral/scripts/inspectGovernanceRun.sh <session-id>
```

This calls the local Coral Server API for available non-secret session/thread state. It does not fabricate output and writes no artifact.

Only create files under `coral/artifacts/` after a real local Coral session has completed successfully.

## Troubleshooting

- Missing Java: install a JDK compatible with the current Coral Server Gradle build. This repository will not install Java automatically.
- Missing Git: install Git before cloning Coral Server externally.
- Missing Python: Python is checked because some Coral examples and future adapters may need it, but the first deterministic adapters run on Node.
- Missing Node or npx: install Node locally before linking agents or running the scripts.
- Missing Docker: Docker is not required for this first executable-runtime demo. Docker may be useful later for portable packaging.
- Missing Coral Server checkout: clone `https://github.com/Coral-Protocol/coral-server` outside this repo.
- Coralizer unavailable: `linkAgents.sh` uses `npx @coral-protocol/coralizer@latest link .`; network or npm policy may block it.
- Coral Console unavailable: confirm Coral Server is running and open `http://localhost:5555/ui/console`.

## Non-Goals

This local proof does not create wallets, seed phrases, private keys, faucet requests, marketplace rentals, payments, Solana transactions, Kaspa transactions, fake screenshots, fake runtime logs, or production deployments.
