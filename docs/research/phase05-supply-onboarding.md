# Phase 05 — supply onboarding and first verified commerce

Observed through 2026-08-18. Real persisted evidence is explicitly separated from
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
  - Policy: `0xd6a4217588f6b1f5657a92a3e94e6422ad771cea`
    (`apex-contracts/scripts/addresses.ts`; SDK 0.5.0's older default is no
    longer whitelisted by the testnet router)
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
Pooler database. The final report at `2026-08-18T10:24:17.665Z` returned:

| Real persisted record            | Count |
| -------------------------------- | ----: |
| Agent submissions                |     1 |
| Ownership challenges             |     2 |
| Activation lifecycle transitions |     7 |
| Marketplace outcomes             |     1 |
| Relic reference candidates       |     1 |
| Third-party candidates           |     0 |
| Partner candidates               |     0 |

The one reference submission is `9e60fc3f-9102-41d8-933a-04c3428abf90` for
ERC-8004 agent `1840`; its canonical Relic agent is
`eef59aff-1922-41ce-8af5-ff02c9f31bb6`. Ownership was verified at
`2026-08-18T09:54:02.521Z`. The public service
`834ec638-cffd-4b7e-82a9-d729d259b7b9` is `COMMERCE_VERIFIED`, and candidate
`f762ba1e-11f0-4550-9d70-ac9e0604389b` and the submission are both
`ACTIONABLE`. The second declared service is a deliberately retained local
loopback declaration; SSRF protection correctly marks it unavailable and it
was not used for commerce.

These are real Supabase records, not fixtures. Database tests persist fixture
submissions, ownership digests, activations, transitions, and outcomes only in
isolated PGlite; those records never enter Supabase.

## Sponsored ERC-8004 identity evidence

The encrypted-keystore wallet is
`0x323F064B777745703Fa8eB56109A763503AeE4Dd`. It started and finished with
`0 tBNB` and `0 U`; it was never manually funded. All identity writes used the
supported BSC-testnet paymaster path and failed closed rather than falling back
to self-pay.

| Operation                    | Transaction                                                          |     Block | Block hash                                                           |
| ---------------------------- | -------------------------------------------------------------------- | --------: | -------------------------------------------------------------------- |
| Register agent `1840`        | `0x28f4452d3a2eb6b7a719b8245f328f3bb2ade85b8644b6492591cd443af7a259` | 125775362 | `0x36fbcc28069599321216c804da1f7074bfb8696d2c4ae17c7dc8f85908ee68e5` |
| Complete initial URI         | `0x068fa07ccdd43711c702c6c0480084c113c74f752e2ce7bed30aaf945ba53819` | 125776448 | `0x1a006bc39efe1c6b19e5438c25700af173fe3bcd3107043fce367442ce781758` |
| Publish service endpoint URI | `0xec84f69140292a87b5726e20b52abc9697dd0e776f5ac1c2e3ec2a67a521fae9` | 125777667 | `0xa916b6b2c7077262dc71e471ae009288d8f344213d61844d940555b0f55c734c` |

The registry owner read back as the same wallet. The initial URI transaction
timed out locally while waiting for its receipt, but the same transaction hash
later confirmed successfully; it was not replayed. Machine-readable evidence
is retained in
`agents/health-factor-monitor/.agent-data/phase05-erc8004-registration.json`.

## Real zero-price ERC-8183 lifecycle

Activation `b9cc41ee-8372-4d96-99a4-cb1499579701` completed as onchain job
`542`. The client and provider are the controlled reference wallet. Commerce is
`0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de`, the router is
`0xd7d36d66d2f1b608a0f943f722d27e3744f66f25`, and the whitelisted policy is
`0xd6a4217588f6b1f5657a92a3e94e6422ad771cea`.

| Operation       | Transaction                                                          |     Block | Block hash                                                           |
| --------------- | -------------------------------------------------------------------- | --------: | -------------------------------------------------------------------- |
| `createJob`     | `0xc40ec17af657f5e327edf8d131517bd94afcdcf0acef2ca0972dc87594891554` | 125778999 | `0xa7fd453ced5e905e5b3ced21866c8606ac8a6b5387384a93104e391176b82924` |
| `registerJob`   | `0xb836e6d061d9aa2493a7286121a5da733094dfe5f0ce4c4d00410dd633190827` | 125780238 | `0x74a75c7ea93f796a584700014e2b93fe5aa836746037940f6c56a4b94b5be8a4` |
| `setBudget(0)`  | `0x46a8069801d7fb2bb761a98697e4cc3bc8bccaa60d88b87e47d1b0f06214cfc6` | 125780247 | `0x20646861b0af24f244d434a5ce71f6d881996d802c05655ceb31e3e1afe38501` |
| `fund(0)`       | `0xd64fd68608aedda7c665ee841f24276a19cbeb57f0aba73c2094e06eda058d54` | 125780257 | `0xf1b2746442c7e3782b3c9801306aabfd8aa7d3f394da649d37051c99a6aaae6d` |
| Provider submit | `0x99fccb9b551a4385faf7ebe77d97133253ebebe731c6a86b7fdb816e854a960f` | 125780646 | `0xfe4b3d852012491e1a80f9a9838ab4e3acd0da9b9bb98da934aa593a786e1415` |
| Settle          | `0xf5b3346dd7512986bc3c764471fa1f6813439248d4f92a44b20533de6a0e4ed8` | 125782731 | `0x359896e834f05b08ae55581caff61514a4c3ae6a35f5f9c159eb1c64a94dd34a` |

The settlement receipt independently read back `status = 1`, gas used `85657`,
and effective gas price `0`. The budget, token transfer, observed cost, and
wallet balance delta were all zero. The lifecycle checkpoint was resumed after
job creation without creating a duplicate job, and settlement was resumed once
after the real 900-second dispute window.

The deliverable hash is
`0xf5b2492d6adbfe379a3abb38aea93ad9149f8751deed000e9ca6116e3c1abd68`.
Its retained JSON at
`agents/health-factor-monitor/.agent-data/erc8183-job-542.json` is a real
read-only Venus BSC-testnet observation at block `125780618`, not a fixture. The
controlled wallet had no entered collateral or borrowing, so Venus returned
zero liquidity and zero shortfall; the empty position was reported factually.

The public service check used an ephemeral Cloudflare Quick Tunnel. It was
sufficient for this controlled activation but carries no uptime guarantee and
is not a production-stable seller URL.

## Operational drift found during activation

- SDK 0.5.0's default policy was no longer whitelisted. The router reverted
  `registerJob` with `PolicyNotWhitelisted()` until the current policy from the
  official APEX deployment source was supplied explicitly.
- The SDK reads `RPC_URL_BSC_TESTNET`, not `BSC_TESTNET_RPC_URL`. Its built-in
  RPC also rejected the required unchunked log range, so the supported public
  RPC override was set explicitly.
- The `bag` CLI's local ERC-8004 precheck required a tBNB balance even though
  the underlying SDK paymaster can sponsor the write. A sponsorship-only helper
  used the same SDK executor and prohibited self-pay fallback.
- Real money spent: **$0**. Manual funding: **none**.

The final database path is `COMPLETED → COMMERCE_VERIFIED → ACTIONABLE`; no
commerce or settlement failures were recorded.
