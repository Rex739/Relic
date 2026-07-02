# Relic

Relic helps teams understand what a proposed change will cause in a legacy enterprise system before it reaches production.

## Problem

Critical enterprise systems often contain old business rules, undocumented dependencies, and financial side effects that are difficult to reason about during ordinary implementation planning. Relic turns a proposed change into a deterministic review surface: dependency impact, adversarial findings, regression results, and a receipt of the evidence used to make the decision.

## Demo Scenario

Meridian Grid wants to apply a 7% regulatory surcharge only to commercial customers with monthly consumption above 10,000 kWh. Relic discovers that the new `RegulatorySurchargeRule` interacts with `LegacyVolumeDiscount`, creating a duplicate-charge condition for 842 historical commercial accounts. The review verdict is `BLOCKED`.

## Conduct Track: Make Legacy Move

Relic addresses legacy-system change impact assessment and release-risk review: the slow enterprise process teams must complete before altering critical business systems.

This process usually takes weeks because the relevant knowledge is fragmented across undocumented code, historical business rules, uncertain dependencies, limited specialists, and manually planned regression tests.

Relic turns a legacy-system change request into a traceable evidence chain: code dependency mapping, recovered business-rule context, adversarial review, deterministic regression tests, and a human-controlled release recommendation.

The workflow compresses the path from change request to decision: change request → dependency mapping → institutional knowledge → adversarial review → deterministic tests → human-controlled recommendation.

Users stay in control because Relic does not deploy changes. It produces evidence, highlights risk, and requires named human sign-off before a release recommendation can be treated as ready.

This MVP uses a simulated Meridian Grid billing environment and deterministic analysis. It does not claim live production-system, SAP, or Conduct platform access.

## Fetch.ai Agent Layer

Relic includes a two-agent uAgents workflow:
- Relic Review Agent receives a user’s enterprise change-review request.
- Relic Verification Agent runs the deterministic Relic review through the app API.
- The Review Agent returns an evidence-backed decision while preserving human release authority.

See [agents/README.md](agents/README.md) for local setup, mailbox connection notes, and ASI:One testing status.

## Product Architecture

- Next.js App Router, TypeScript, Tailwind CSS, and local fixture data.
- `/api/review/run` executes the review engine and returns typed JSON.
- `src/lib/relic` contains the deterministic domain logic.
- `src/components/relic` contains the workspace and review UI.

## Deterministic Review Engine

The review engine composes dependency analysis, regression-test results, staged agent findings, and certificate generation. The final decision is derived from failed tests and risk thresholds, not hard-coded in the visual components.

## Dependency Analysis

`dependencyAnalyzer.ts` performs deterministic graph traversal from the proposed change surface. It returns direct and indirect impact, critical components, critical paths, and a blast-radius score for UI and certificate use.

## Regression Suite

`regressionSuite.ts` evaluates five structured scenarios for the billing policy change. Four pass and one critical test fails: commercial volume-discount accounts can emit duplicate ledger charge entries.

## Cryptographic Review Receipt

`receipt.ts` creates a stable certificate payload and hashes it with SHA-256 using Node crypto. Identical payloads produce identical hashes, while changed payloads produce different hashes.

## Design Direction

Relic uses a light editorial industrial-tech interface: warm mineral canvas, thin borders, confident typography, local system-map visuals, and restrained status color.

## Local Setup

```bash
npm install
npm run dev
npm test
npm run build
```

## Commands

- `npm install`
- `npm run dev`
- `npm run lint`
- `npm test`
- `npm run build`

This MVP uses a simulated enterprise system and deterministic analysis. It does not claim live production-system access or external verification.
