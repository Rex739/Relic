# Relic

> Make legacy systems legible.

Relic helps enterprise teams understand what a proposed change will cause in a legacy system before it reaches production. The demo focuses on Meridian Grid, where a proposed 7% regulatory surcharge for commercial customers above 10,000 kWh is reviewed through dependency mapping, deterministic regression evidence, agent-assisted verification, and human release-control safeguards.

- Live application: https://relic-brown.vercel.app
- Sample review: https://relic-brown.vercel.app/review/meridian-billing
- Fetch public agent: `@relic-review`

## 1. The Problem

Legacy enterprise systems are full of change risk that is hard to see before release:

- undocumented dependencies
- old business rules
- policy sequencing assumptions
- hidden billing and ledger interactions
- institutional knowledge held by a few people
- release processes that rely on trust instead of traceable evidence

Teams still need to make high-risk changes quickly. They also need to avoid exposing raw operational data, relying on vague approvals, or discovering critical side effects only after production has moved.

## 2. The Solution

Relic turns a change request into a traceable review chain:

```text
Map dependencies
-> Challenge assumptions
-> Test evidence
-> Decide with required human sign-off
```

For the Meridian Grid scenario, Relic finds that the new surcharge can be evaluated before a legacy volume-discount reconciliation path is resolved. For affected commercial accounts, both paths can emit a ledger entry, causing a duplicate-charge condition.

Deterministic outcome:

| Result | Value |
| --- | --- |
| Verdict | `BLOCKED` |
| Finding | Duplicate-charge condition detected |
| Impacted components | `8` |
| Critical paths | `5` |
| Failed regression tests | `1` |
| Potentially affected commercial accounts | `842` |
| Required sign-offs | Finance Systems Owner, Billing Policy Lead |

## 3. Demo Walkthrough

Use these routes for the fastest judge demo:

| Route | What to show |
| --- | --- |
| `/` | Product story, method, and workspace entry points |
| `/review/new` | The Meridian Grid change request setup |
| `/review/meridian-billing` | Completed deterministic review with `BLOCKED` outcome |
| `/review/meridian-billing?tab=evidence` | Deep-linked evidence panel |
| `/systems` | Meridian Grid system registry view |
| `/settings` | Read-only simulation workspace settings |

The review workspace includes:

- Overview
- Impact Map
- Evidence
- Commitment
- Certificate

The workspace top bar includes a non-interactive `SIMULATION` status badge and a real command palette for navigation and workspace sidebar controls.

## 4. Architecture

```text
Relic web app
  -> Next.js App Router UI
  -> POST /api/review/run
  -> deterministic review engine
  -> dependency analyzer
  -> regression suite
  -> evidence receipt
```

```text
ASI:One / Agentverse
  -> @relic-review
  -> relic-verification-agent
  -> Relic public review API
  -> evidence-backed decision
```

```text
Kaspa release-control prototype
  -> blocked review commitment
  -> Finance acknowledgement
  -> Billing Policy acknowledgement
  -> remediation required
  -> separate clean review required before release readiness
```

```text
CoralOS local governance proof
  -> Review Governor
  -> Verification Bridge
  -> Release Policy Guard
  -> REMEDIATION_REQUIRED, releaseReady: false
```

## 5. What Is Implemented

| Area | Implementation | Status |
| --- | --- | --- |
| Web product | Next.js, TypeScript, Tailwind CSS, Framer Motion, GSAP | Implemented |
| Review API | `POST /api/review/run` | Implemented |
| Review engine | Deterministic Meridian Grid fixture and findings | Implemented |
| Dependency graph | Deterministic graph traversal from change surface | Implemented |
| Regression suite | Five structured tests; one critical duplicate-charge failure | Implemented |
| Evidence receipt | Stable SHA-256 review certificate payload | Implemented |
| Fetch.ai layer | Review Agent and Verification Agent under `agents/` | Implemented |
| Kaspa layer | Testnet 12 Silverscript covenant prototype | Compiled locally, static verification completed, not deployed |
| CoralOS layer | Local governance adapter session under `coral/` | Local proof only |

## 6. Core Scenario

Meridian Grid proposes:

```text
Apply a 7% regulatory surcharge only to commercial customers
with monthly consumption above 10,000 kWh.
```

Relic maps the proposed change from `RegulatorySurchargeRule` through the billing policy resolver, commercial invoice service, legacy volume-discount path, and invoice ledger writer.

The blocking condition appears when surcharge evaluation happens before legacy volume-discount reconciliation. Standard eligible accounts receive one surcharge, but volume-discount commercial accounts can produce two ledger entries: one from the surcharge-adjusted invoice path and one from the legacy reconciliation path.

## 7. Human Release Authority

Relic does not deploy code or approve releases automatically.

For the blocked Meridian Grid review, release authority stays with named owners:

- Finance Systems Owner
- Billing Policy Lead

The product produces evidence, impact analysis, regression results, and a certificate. Human sign-off and remediation remain required before a separate clean review can become release-ready.

## 8. Fetch.ai Agents

Relic includes a two-agent Fetch/uAgents workflow:

- `relic-review-agent`: public-facing review agent for the user-facing change request.
- `relic-verification-agent`: internal verification agent that calls the deterministic Relic review API.

The Review Agent delegates typed review work to the Verification Agent. The Verification Agent calls:

```text
POST {RELIC_API_BASE_URL}/api/review/run
```

The agent layer returns an evidence-backed result while preserving human release authority.

Agent source, local setup, and Render environment notes live in [`agents/README.md`](agents/README.md) and [`agents/RENDER_ENVIRONMENT.md`](agents/RENDER_ENVIRONMENT.md).

## 9. Kaspa Release Commitment

Relic includes a Kaspa Testnet 12 release-control prototype under [`kaspa/`](kaspa/).

The implemented safety property is narrow and explicit:

```text
A blocked commitment cannot transition directly to RELEASE_READY.
```

Current status:

| Claim | Status |
| --- | --- |
| Network target | Kaspa Testnet 12 |
| Covenant source | `kaspa/contracts/ReleaseCommitment.sil` |
| Artifact | `kaspa/artifacts/ReleaseCommitment.json` |
| Compilation | Completed locally |
| Static verification | Completed |
| Deployment | Not deployed |
| Transaction | None |
| Mainnet claim | None |

No wallet, private key, seed phrase, funds, transaction ID, explorer link, or mainnet deployment is part of this repository.

## 10. CoralOS Governance Proof

Relic includes a contained local CoralOS governance extension under [`coral/`](coral/).

CoralOS is used as a local governance and observability layer for Relic's review workflow. It scopes agent responsibilities, records handoffs, and prevents agents from issuing human release approval.

The local Coral proof uses three deterministic adapters:

- Review Governor
- Verification Bridge
- Release Policy Guard

The recorded local governance result is:

| Field | Value |
| --- | --- |
| Result | `REMEDIATION_REQUIRED` |
| `releaseReady` | `false` |
| Scope | Local Coral Server session |

This does not replace the Fetch.ai agents, does not claim remote Coral execution, and does not involve payments, marketplace rental, Solana transactions, or production deployment.

## 11. Conduct Track Fit

Relic fits the Conduct "Make Legacy Move" track by focusing on the review process that blocks real enterprise legacy-system change:

```text
change request
-> dependency mapping
-> recovered business-rule context
-> adversarial review
-> deterministic regression tests
-> evidence-backed human decision
```

The MVP uses a simulated Meridian Grid billing core and deterministic evidence. It does not claim live production-system, SAP, or private customer-system access.

## 12. Repository Map

| Path | Purpose |
| --- | --- |
| `src/app` | Next.js routes and API |
| `src/components/relic` | Product UI, workspace, review panels |
| `src/lib/relic` | Deterministic review logic, fixtures, receipt, Kaspa state machine |
| `src/tests` | TypeScript tests for review, receipt, dependency, staging, and commitment behavior |
| `agents` | Fetch/uAgents Review Agent and Verification Agent |
| `kaspa` | Kaspa Testnet 12 release-commitment prototype |
| `coral` | Local CoralOS governance proof |
| `public/brand` | Relic brand assets |

## 13. Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Run validation:

```bash
npm test
npm run lint
npm run build
```

Optional focused checks:

```bash
npm run kaspa:check
npm run kaspa:compile
npm run kaspa:verify
npm run coral:test
```

## 14. API

Relic exposes one deterministic review endpoint:

```text
POST /api/review/run
```

The endpoint returns the Meridian Grid review result used by the web UI and verification agents. It does not require secrets and does not mutate state.

## 15. Honesty Notes

Relic is demo-ready, but intentionally scoped:

- The Meridian Grid system is a deterministic simulation.
- The review result is deterministic and fixture-backed.
- The Fetch agents preserve human release authority.
- The Kaspa covenant prototype is compiled and statically verified locally, not deployed.
- The CoralOS proof is a local governance adapter session, not a remote Coral deployment.
- Relic does not create wallets, sign transactions, move funds, deploy code, or approve releases automatically.

## 16. License And Status

This repository is a hackathon MVP for the Relic demo.

Status: feature-complete and demo-ready.
