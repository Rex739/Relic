# Phase 05 — supply onboarding and first verified commerce

Observed 2026-08-14. Real persisted evidence is explicitly separated from
deterministic fixtures below.

## Current BNB tooling audit

- `bnbagent-studio==0.0.5` was installed in an isolated temporary Python
  environment. Exact output: `bag 0.0.5`.
- `bag init --help` in 0.0.5 offers only `--framework {adk}` and generates the
  Python/ADK layout. It has no language or TypeScript scaffold flag. The
  public docs still describe Python `main.py`/`service.py` and older `bag
0.0.1` examples. The announced TypeScript direction is therefore not yet
  exposed by the public CLI inspected here.
- `bnb-chain/bnbagent-sdk` inspected commit:
  `7c8636ee3a90971ec57d18e99a9fc1252a9773d1` (2026-08-06).
- Stable npm package pinned in this repository: `@bnbagent/sdk@0.5.0`
  (published 2026-08-06). `0.5.1-alpha.1` existed, but an alpha was not used.
- Current TypeScript provider and zero-price examples are first-class in the
  SDK repository. The reference seller follows `ERC8183Config`,
  `ERC8183JobOps`, `NegotiationHandler`, and `fundedJobWatcher` primitives.
- Verified BSC testnet deployment configuration:
  - Identity registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
  - Commerce: `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de`
  - Router: `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25`
  - Policy: `0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6`
  - Payment token: `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`

Primary references:

- <https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/>
- <https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/>
- <https://docs.bnbchain.org/developer-kit/bnbchain-studio/security/>
- <https://github.com/bnb-chain/bnbagent-sdk>
- <https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks/>
- <https://docs-v4.venus.io/technical-reference/reference-isolated-pools/comptroller/comptroller>
- <https://docs-v4.venus.io/guides/liquidation>

## Reference seller architecture

`agents/health-factor-monitor` is an isolated TypeScript workspace package. It
is explicitly `relic_reference`, zero-price, BSC-testnet-only, and read-only for
the lending account. Its production reader calls Venus Core
`getAccountLiquidity`, `getAssetsIn`, and each entered vToken's
`getAccountSnapshot` at one observed block. It reports Venus's authoritative
liquidity/shortfall equivalent rather than inventing a ratio called “health
factor.” A configurable comptroller is required so a stale address is never
silently baked into seller code.

Fixture tests inject a `PositionReader` and return `source: fixture`. Production
returns `source: onchain`, chain ID, comptroller, and block. Fixture output is
never described as live.

The seller cannot transfer, approve, repay, supply, or sign DeFi calls. Its
wallet signs only protocol negotiation/submission through the SDK's encrypted
keystore workflow. Startup refuses non-testnet networks, nonzero price, and a
missing human-provided password.

## Onboarding and ownership

Migration `0006_sticky_darkstar.sql` adds additive submission, ownership,
stable activation-lifecycle, and marketplace-outcome records. It also adds the
factual `third_party | partner | relic_reference` supply classification to the
existing candidate model.

The public API creates only `third_party` submissions. Ownership challenges are
random, identity-bound, expire after ten minutes, are consumed atomically, and
verify the current canonical owner with EIP-191 recovery. Relic stores a nonce
hash and signature digest, not a private key, password, or raw signature.

The bounded `supply:onboard` command uses the direct ERC-8004 registry provider,
canonical normalizer/writer, existing candidate model, and existing Phase 04
service materializer. It does not create a parallel agent/service record.

## Zero-price semantics

SDK 0.5.0's real flow remains:

`createJob → registerJob → setBudget(0) → fund(0) → provider submit → dispute window → settle → COMPLETED`

For amount zero, `fund(0)` skips ERC-20 allowance approval and transfers no
payment token. The create/register/budget/fund/submit/settle writes still occur.
BSC testnet is in the SDK paymaster allowlist; the SDK may fall back to self-pay
if sponsorship is unavailable, so “zero price” is not falsely described as a
guarantee of zero gas under every infrastructure failure.

## Real persisted database evidence

Migration 0006 was successfully applied to the configured Supabase Session
Pooler database. Query at `2026-08-14T20:28:37.260Z` returned:

| Real persisted record            | Count |
| -------------------------------- | ----: |
| Agent submissions                |     0 |
| Ownership challenges             |     0 |
| Activation lifecycle transitions |     0 |
| Marketplace outcomes             |     0 |
| Relic reference candidates       |     0 |
| Third-party candidates           |     0 |
| Partner candidates               |     0 |

These zeros are real production-database facts, not fixtures. Database tests do
persist fixture submissions, ownership digests, activations, transitions, and
outcomes in isolated PGlite; those records never enter Supabase.

## Current live boundary

No reference wallet, ERC-8004 agent ID, seller deployment URL, or suitable
controlled Venus testnet position was supplied. No wallet was auto-generated
and no private key/password was requested or stored. Consequently:

- ERC-8004 identity evidence: not yet available.
- Reference service verification: not yet run against a deployed endpoint.
- Real ERC-8183 job ID/transaction hashes/deliverable/settlement: not yet
  available.
- Reference candidate `ACTIONABLE`: not reached; the normal evidence chain is
  missing identity, endpoint, invocation, and commerce proof.
- Real money spent: **$0**.

The optional live command is implemented and checkpointed, but intentionally
stops before any wallet access until the human supplies the encrypted-keystore
password locally. Nothing above claims a live completion.
