# Relic launch-supply research

## Phase 06 continuation — stopped at the zero-cost boundary

Live work on **2026-08-18** reused the Phase 04/05 canonical pipeline. It did
not create reference-agent rows or manually promote candidates. 8004scan's
semantic endpoint still returned `502/BACKEND_ERROR`, but its documented
paginated `/agents?search=...` keyword filter worked. Relic added that bounded
fallback and searched exact category terms before considering new reference
sellers.

The pass persisted 39 category candidates, directly verified their BSC
ERC-8004 identities, materialized their canonical registration-file services,
and inspected each declaration once under the existing SSRF, credential,
redirect, timeout, header, and body-size controls.

The quality-adjusted current inventory is:

| Category                 | Indexed candidates | Identity verified | Currently credible service | Invocation verified | Commerce verified | Actionable | Supply origin                    |
| ------------------------ | -----------------: | ----------------: | -------------------------: | ------------------: | ----------------: | ---------: | -------------------------------- |
| Rebalancing              |                  4 |                 4 |                          1 |                   1 |                 0 |          0 | 4 third-party                    |
| Grid trading             |                  7 |                 7 |                          1 |                   1 |                 0 |          0 | 7 third-party                    |
| Yield optimisation       |                 25 |                25 |                          1 |                   1 |                 0 |          0 | 25 third-party                   |
| Health-factor monitoring |                  3 |                 3 |                          1 |        1 historical |      1 historical |          0 | 2 third-party, 1 Relic reference |

“Currently credible service” is deliberately narrower than a successful HTTP
response. It requires explicit category capability, a protocol document that
matches the declaration, and a currently available endpoint. Generic trading,
lending, swap, market-data, and web pages are not counted. Historical Phase 05
commerce remains evidence, but the stopped Quick Tunnel is now persisted as
unavailable and its reference candidate is `STALE`, not falsely current.

### Real external services found

| Category                 | ERC-8004 agent                   | Interface                      | Endpoint                                                             | Real verification                                                           | Current blocker                                                     |
| ------------------------ | -------------------------------- | ------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Rebalancing              | BNB LP Range Rebalancer `265375` | A2A 0.3 + ERC-8183 negotiation | `https://bnb-lp.172-104-171-139.nip.io/`                             | Signed quote accepted; candidate/service `INVOCATION_VERIFIED`              | `0.1 U` mainnet price plus self-paid BNB gas                        |
| Grid trading             | BNB Grid Trader `269233`         | A2A 0.3 + ERC-8183 negotiation | `https://bnb-grid.172-104-171-139.nip.io/`                           | Signed quote accepted; candidate/service `INVOCATION_VERIFIED`              | `0.1 U` mainnet price plus self-paid BNB gas                        |
| Yield optimisation       | BNB Yield Optimizer `265876`     | ERC-8183 HTTP                  | `https://bnb-yield.172-104-171-139.nip.io/erc8183`                   | Status and matching quote accepted; candidate/service `INVOCATION_VERIFIED` | `1 U` mainnet price plus self-paid BNB gas                          |
| Health-factor monitoring | Health Factor Monitor `269228`   | A2A 0.3                        | `https://agents.chainhelix.io/healthmon/.well-known/agent-card.json` | Identity and schema understood; endpoint available                          | Card advertises a localhost task URL, so safe invocation is blocked |

The two A2A quotes include provider signatures, request/response hashes,
negotiation hashes, BSC mainnet chain ID, and the official mainnet commerce
address. Relic persists those selected fields and a response SHA-256 digest,
not arbitrary response bodies. The yield quote is matched against its public
status provider, price, token, network, and chain.

No job was created, no payment was sent, and no transaction was attempted for
any Phase 06 third-party seller. These services remain
`INVOCATION_VERIFIED`, not `COMMERCE_VERIFIED` or `ACTIONABLE`.

### Supply-quality findings

- 8004scan keyword filtering found useful agents that the earlier 200-row
  prefix sample could not reveal; the small sample was not representative.
- Most yield results were generic TermiX A2A declarations, research tools, or
  trading agents. A common template advertised literal `{agentId}` URLs. Those
  routes returned ordinary 4xx responses or lacked endpoints and are not
  counted as credible yield supply.
- A service-inspector defect treated ordinary 4xx responses as observable
  protocol success. The inspector now permits 402 only for x402/B402 payment
  challenges and treats other 4xx responses as failures. Historical
  observations remain append-only, while current availability prevents them
  entering the launch catalog.
- Discovery source (`8004scan-keyword-filter`) remains separate from supply
  origin (`third_party`). Direct registry reads, not 8004scan's verification
  badge, establish onchain identity facts.

### Stop boundary

Category parity cannot be completed within the authorized `$0` budget using
the external sellers found. BNB Agent SDK mainnet ERC-8183 writes are not
paymaster-sponsored. Completing any of the three quoted commerce lifecycles
requires both the quoted `$U` amount and native BNB for mainnet gas.

The free alternative is a Relic-operated BSC-testnet reference seller for each
remaining gap, but Phase 06 explicitly requires a wallet/custody decision and
human-created encrypted wallet password before that path starts. No new wallet,
password, reference seller, deployment, or mainnet write was created
automatically.

Phase 06 is therefore **not complete**. Real money spent during this
continuation: **$0**.

Research and controlled live run: **2026-08-14**. This report distinguishes real persisted records from deterministic test fixtures. The counts below are from the configured Supabase development database; test fixtures are excluded.

## Outcome

Relic cannot honestly launch any of the four required categories from currently discovered third-party supply. The controlled run found **zero credible category candidates**, so it produced zero verified identities, services, invocations, or commerce lifecycles. This is a supply result, not a search-UX result and not permission to fabricate listings.

The targeted 8004scan search implementation exists and ran for all four categories, but the live public endpoint returned `HTTP 502` with `BACKEND_ERROR` for every final bounded request. Eight failed discovery-run records exist because early diagnostic/interrupted attempts were recovered and retained as failures rather than deleted. A strict fallback check over the 200 real Phase 03 agents found no name/description match for the required category evidence. Those 200 agents contain 185 x402, 71 OASF, 7 MCP, 4 A2A, 3 HTTP API, and 1 email declarations, but **no ERC-8183 declaration**. A protocol declaration remains only a declaration.

## Current official BNB findings

- [BNB Agent Studio](https://www.bnbchain.org/en/bnb-agent-studio) is live and combines ERC-8004 identity, an ERC-8183 task interface, x402-funded services, a wallet, and a managed runtime. The [Studio announcement](https://www.bnbchain.org/en/blog/bnb-agent-studio-is-live-on-bnb-chain-ai-agents-from-one-prompt) describes AWS AgentCore deployment and on-chain registration.
- The current [Studio CLI reference](https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/) documents the `bag` CLI and the `erc8183 publish/list/status/buy/submit/fetch/settle` workflow. The [Studio demo](https://docs.bnbchain.org/developer-kit/bnbchain-studio/demo/) uses a two-layer seller with public service ingress and a private signer/LLM layer.
- The official [`bnb-chain/bnbagent-sdk`](https://github.com/bnb-chain/bnbagent-sdk) repository was inspected at commit `7c8636ee3a90971ec57d18e99a9fc1252a9773d1` dated 2026-08-06. The repository contains both Python and TypeScript implementations. The TypeScript package declares `@bnbagent/sdk` version **0.5.0**, published 2026-08-06; the root release marker refers to **0.4.2**, so consumers should pin the package version and commit rather than assuming the repository-wide version is uniform.
- The current SDK exposes an `ERC8183Client` facade and lower-level commerce/router/policy operations. The deployed job state mapping is `OPEN(0) → FUNDED(1) → SUBMITTED(2) → COMPLETED(3)`, with terminal `REJECTED(4)` and `EXPIRED(5)`. The [official SDK architecture](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/architecture/) documents create, budget, fund, submit, complete, reject, and refund behavior.
- The official APEX contracts were inspected at commit `b40b18011407ba13516661d3784bcb727a0c7794` dated 2026-08-06. Relic uses the published contracts through a provider boundary; it does not implement a custom escrow.
- The official BSC testnet deployment is active at commerce address `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de`. A real read on 2026-08-14 confirmed bytecode and returned payment token `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`, matching the SDK deployment table.
- Testnet protocol writes may be sponsored, but an ERC-20 approval may still self-pay. A buyer also needs test `$U`, a seller/provider, evaluator/hook configuration, and user-authorized signing. Relic does not create a wallet, import a private key, or request funds automatically.
- The exact “BNB Smart Money Era” page could not be located in current official pages. The ongoing [BNB Hack Online Edition](https://www.bnbchain.org/en/hackathons/bnb-ai-hack) and the 2026 [AI Trading Agents announcement](https://www.bnbchain.org/en/blog/build-and-compete-for-36-000-in-bnb-hack-ai-trading-agents-by-bnb-chain-coinmarketcap-and-trust-wallet) were inspected instead; this substitution is explicit rather than assumed.

## Agent Studio identification

No trustworthy on-chain marker uniquely identifies an ERC-8004 identity as Studio-created. ERC-8183 endpoints, x402, A2A agent cards, the two-layer route shape, and Studio-like metadata are supporting conventions, but any developer can reproduce them. Relic therefore does not expose an `isAgentStudioAgent` fact. A future signed Studio attestation or registry-specific verifiable field would be required for high-confidence detection.

## Category supply depth

| Category                 | Discovered | Identity verified | Service identified | Endpoint observed | Invocation verified | Commerce verified | Rejected/inactive | Gap to research target (3) | Launch today? |
| ------------------------ | ---------: | ----------------: | -----------------: | ----------------: | ------------------: | ----------------: | ----------------: | -------------------------: | ------------- |
| Rebalancing              |          0 |                 0 |                  0 |                 0 |                   0 |                 0 |                 0 |                          3 | No            |
| Grid trading             |          0 |                 0 |                  0 |                 0 |                   0 |                 0 |                 0 |                          3 | No            |
| Yield optimisation       |          0 |                 0 |                  0 |                 0 |                   0 |                 0 |                 0 |                          3 | No            |
| Health-factor monitoring |          0 |                 0 |                  0 |                 0 |                   0 |                 0 |                 0 |                          3 | No            |

There are no candidate rows to list as an “ecosystem candidate.” The preserved discovery evidence consists of the exact category query, source, status, and upstream error. No test fixture is included in this table.

## Partner/reference resources

Current official BNB material confirms that PancakeSwap, Venus, Lista, and Aave are live protocols, not that a callable third-party seller exists for Relic’s four jobs. The [BNB Chain skills guide](https://docs.bnbchain.org/developer-kit/mcp/skills/) points to generic MCP/chain/registration skills. The inspected `bnb-chain/bnbchain-skills` commit `4f6557b7…` (2026-03-04) did not provide production sellers for the four categories.

The [AI Trading Agent winners announcement](https://www.bnbchain.org/en/blog/meet-the-winners-of-bnb-hack-ai-trading-agent-edition) explicitly distinguishes autonomous agents, reusable strategy skills, and tools. A PancakeSwap swap/liquidity skill is not a grid trader or rebalancing agent; a Venus/Aave lending module is not a health-factor monitoring service; a Lista staking integration is not a yield optimizer. The [CMC/B402 Studio integration](https://www.bnbchain.org/en/blog/build-ai-agents-on-bnb-agent-studio-that-can-access-and-pay-for-coinmarketcap-data-via-binance-pays-b402) supplies paid market data, not one of the required sellers.

## Service and verification model

Relic now persists launch candidates separately from general agent readiness. Candidate transitions are evidence-bearing and cannot jump from discovery to actionable. One agent can have multiple source-specific service records with endpoint, interface, schemas, pricing, token/network, SLA, authentication, protocol support, provenance, availability, and a verification level.

The levels are `DECLARED`, `ENDPOINT_OBSERVED`, `SCHEMA_UNDERSTOOD`, `PAYMENT_UNDERSTOOD`, `INVOCATION_VERIFIED`, and `COMMERCE_VERIFIED`. Safe inspection uses:

- ERC-8183 status metadata with no job creation;
- A2A agent cards;
- MCP `initialize` only, never arbitrary tool calls;
- x402/B402 challenge discovery without credentials or payment;
- bounded generic metadata requests rather than assuming `HEAD` support.

DNS pinning, public-address enforcement, standard ports, credential refusal, redirect limits, POST-redirect refusal, timeouts, header limits, and a 64 KiB body cap remain enforced. Evidence stores status, latency, response size/digest, content type, and JSON field names—not arbitrary response bodies or secrets.

## Activation attempt

The maximum safe real portion completed was:

1. inspect the official current SDK/contracts and deployment addresses;
2. connect to BSC testnet chain 97;
3. confirm deployed bytecode at the official AgenticCommerce address;
4. call `paymentToken()` read-only and match the published `$U` token;
5. query real persisted launch services for an ERC-8183 seller;
6. stop with `BLOCKED` because no real persisted seller exists.

Result: **BLOCKED; no transaction attempted**. There is no job ID, transaction hash, funding, seller execution, deliverable, or settlement to report. No service-backed activation row was fabricated because that model requires a real agent and service foreign key. A separate durable preflight record (`31682f00-6a07-4ab4-b40e-ed6d02d17873`) stores the chain, official commerce/token reads, blocker, and explicit `transactionAttempted=false`. Once a real seller is verified, the service-backed model can persist `PREPARED`, `TERMS_RESOLVED`, `JOB_CREATED`, `FUNDED`, `SUBMITTED`, and terminal evidence.

## Seed-supply recommendation

Waiting alone is unlikely to produce enough launch depth. Relic should first pursue **Option B: onboard existing third-party developers**, using Studio as the standard seller packaging path. Sponsor at least three independently operated candidates per category and require public testnet ERC-8004 identity, ERC-8183/A2A service metadata, bounded test jobs, and operational ownership.

If onboarding does not reach two credible candidates per category within a fixed window, use **Option C selectively**, not as four unrelated portfolio projects:

| Category                 | Complexity                             | Protocol skills/dependencies                                                                | Safe testnet path                                                       | Ongoing operations                                                        |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Rebalancing              | High                                   | PancakeSwap v3 positions, range math, oracle/slippage/risk guards                           | fork/simulate first; tiny testnet LP only where official pools exist    | price monitoring, key policy, gas, pool/version upgrades                  |
| Grid trading             | High                                   | market data, execution venue, order-state strategy, risk/allowance limits                   | paper executor, then tiny testnet swaps with hard caps                  | 24/7 data, strategy drift, nonce/allowance and loss controls              |
| Yield optimisation       | High                                   | PancakeSwap/Lista/Venus/Aave adapters, APY normalization, exit/liquidity risk               | read-only ranking, then allowlisted testnet deposit/withdraw            | protocol upgrades, reward claims, insolvency/depeg monitoring             |
| Health-factor monitoring | Medium for alerts; high for protection | Venus/Aave position reads, oracle/liquidation math, notification; optional repay automation | read-only testnet positions and alert delivery before any authorization | dependable polling, alert delivery, oracle/market upgrades, response SLOs |

Option A—wait for official partner reference sellers—remains useful if BNB publishes verifiable endpoints, but none suitable was found in this research pass.

## Real data versus fixtures

- **Real persisted:** 200 Phase 03 BSC agents; their declaration counts; eight failed Phase 04 discovery runs; zero launch candidates/services/service-backed activations; one blocked activation preflight.
- **Real external reads:** live 8004scan `502/BACKEND_ERROR`; BSC testnet commerce bytecode and `paymentToken()` match.
- **Fixtures only:** unit-test agents, mock service responses, and PGlite activation rows used to prove validation/migration behavior. They are never returned as marketplace inventory or included in the live counts.

## Recommended next milestone

Run a **seller onboarding sprint**: obtain one developer-controlled BSC testnet ERC-8183 seller in a required category, verify its identity/card/status endpoint, execute one capped `$U` test job with an explicitly user-authorized test wallet, and preserve the full job/deliverable/settlement evidence. Do not start broader marketplace UX until that single commerce path succeeds.
