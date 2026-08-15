# ERC-8004 and BSC source investigation

Verified on 2026-08-14.

## Authoritative protocol and deployment sources

- [ERC-8004 draft](https://eips.ethereum.org/EIPS/eip-8004) defines an ERC-721 identity registry, registration files, fact-like reputation signals, and validation hooks. It remains a draft.
- [BNB Chain SDK network documentation](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks/) identifies BSC mainnet (`56`) and testnet (`97`) but delegates current registry addresses to its SDK repository.
- The [official BNB Agent SDK repository](https://github.com/bnb-chain/bnbagent-sdk) currently defines mainnet identity registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` and testnet `0x8004A818BFB912233c491871b3d84c89A494BD9e`.
- [BNB Chain's public RPC documentation](https://docs.bnbchain.org/bnb-smart-chain/developers/wallet-configuration/) provides public endpoints, but public nodes are not archive-grade ingestion infrastructure.

## Important tooling inconsistency

The official BNB repository now contains first-class `python/` and `typescript/` implementations. We inspected main commit `7c8636ee3a90971ec57d18e99a9fc1252a9773d1` dated 2026-08-06. `typescript/package.json` declares `@bnbagent/sdk` 0.5.0 while the latest repository tag is still `bnbagent-v0.4.2`, an upstream release-version inconsistency.

The TypeScript ERC-8004 implementation supplies current reads, register/update writes, wallet seams, MegaFuel/TWAK/Altana support, protected URI parsing, and an 8004scan list call. It does not supply Relic's durable checkpoint, history, reorg rollback, or reconciliation model. Relic retains direct viem indexing. The SDK is the future seam for sponsored writes, wallet integration, and ERC-8183—not a replacement for protocol-independent reads.

## Real BSC result

The implemented direct-chain adapter successfully read and normalized mainnet agent token `239826` on 2026-08-12:

- registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`;
- owner: `0x0d6aEDdB153973166541934fc9876de3595DAC28`;
- registration file: on-chain base64 data URI;
- declared name: `Ave.ai Trading Agent`;
- declared description: `AI-driven multi-chain trading agent with on-chain reputation.`;
- declared image: `https://www.iconaves.com/logo/pro.ave.ai.png`;
- declared services: none;
- Relic provenance: chain/registry/token/owner/URI are `onchain_verified`; name/description/image are `developer_declared`.

The direct `getAgent` path validates current state but does not discover the original event block. 8004scan independently reported block `112617793` and transaction `0xd02c7938f1c4f3c9e41546d72b588d1fc7c7e0227a0c263525818987a0e2e7d2` for this token. Those values were not inserted into the direct result because they did not come through the selected provider.

Agent `128767` was also checked. Its owner exists on-chain but its current token URI is empty, so Relic correctly cannot normalize a profile from it.

The original Supabase direct host was IPv6-only and returned `ENOTFOUND` from this runtime. Switching to the Supabase session pooler established connectivity and both committed migrations applied successfully. No fixture has been represented as production data.

## 8004scan

[8004scan's Builder Hub](https://8004scan.io/developers) now offers an anonymous public API (10 requests/minute and 100/day) and a documented OpenAPI schema. It is useful as:

- a second provider implementation;
- cross-checking registration blocks/transactions;
- filling indexed views when public RPC history is pruned.

It is not the first adapter because anonymous quotas are too small for a full marketplace backfill and its enriched fields combine on-chain, declared, observed, and computed data. Those fields would require explicit per-field source mapping before ingestion. Relic must also not import third-party scores as its own reputation.

The Phase 03 adapter supports optional `8004SCAN_API_KEY` authentication, reads the returned limit/remaining/reset headers, throttles at reset, retries bounded transient failures, paginates with a durable cursor, and validates individual rows so one malformed record does not discard its page. The controlled 200-row sample retained 8004scan reputation aggregates as secondary inventory only. A `/feedbacks?chainId=56&tokenId=1` probe returned other token IDs, so the observed filter behavior was not reliable enough for canonical per-agent feedback ingestion.

8004scan reports the earliest BSC token (`0`) at block `79094807`, transaction `0xdf12ce1124937e842a2802e174cdb4c0af9c0c86795b9e92123ace02af0a5c1b`. A direct BSC transaction-receipt read independently confirmed that successful transaction at block `79094807`, block hash `0xb520f87a9afff23dbd7d6319f98c67b922c549199bbe1960c1a73410cf712397`, with four registry logs. That establishes this deployment's operational start block.

## Metadata irregularities and limitations

- Registration files are mutable pointers and developer declarations, even when the pointer itself is on-chain.
- Some real agents omit `services`, `registrations`, images, or even the entire token URI.
- Legacy deployments have used malformed data URIs; normalization rejects malformed content rather than guessing.
- A current public BSC RPC returned `missing trie node` for a historical `eth_getCode` probe, confirming that public endpoints cannot be assumed to provide archive state.
- BNB's official RPC documentation states that `eth_getLogs` is disabled on its mainnet dataseed endpoints; they rejected even a one-block recent query with `limit exceeded`. `https://bsc.publicnode.com` supported the controlled recent scan, but required a personal archive token for the deployment-era range. Full backfill therefore still requires an archive-capable RPC.
- ERC-8004 payments are out of scope; commerce belongs to a separate protocol layer.

## NodeReal bounded archive check

[NodeReal pricing](https://nodereal.io/pricing) and [pricing documentation](https://docs.nodereal.io/docs/pricing) advertised a free, no-card tier with archive access, three keys, 10 million compute units, and 150 CUPS when checked on 2026-08-14. Its [BSC `eth_getLogs` documentation](https://docs.nodereal.io/reference/eth-getlogs-bnb-chain) states a 50,000-block maximum range and different response bounds above 100 blocks.

Using NodeReal's public documentation example endpoint, Relic successfully read the canonical deployment-era block, registration receipt, a two-block log range, and a 101-block log range around block 79,094,807. Both log requests returned the same four registry logs. This demonstrates bounded historical capability, not production reliability: the example credential's quota and stability are unspecified. `NODEREAL_BSC_RPC_URL` is optional and Relic remains provider-independent; production use requires an operator-owned free key and longer monitoring.

## Controlled persisted result

On 2026-08-14, Relic scanned finalized BSC blocks `115783000..115783499` in 50-block windows, then resumed through `115783549`. The range yielded five raw events (`Transfer`, `MetadataUpdate`, `Registered`, and two `MetadataSet`) for token `266548` in transaction `0x3bf788c7d3450eb9d04da39fd15d2a5e4e12d1a6e92fe4da56747810d2fc169a` at block `115783338`.

Persisted current state: declared name `Astro-Safe.agent`, declared description `Astro-Safe.agent on Termix Platform`, owner `0x4690AEDa84947A38B0f37A5ac4b64Ed9A023ECeb`, two declared services, and no evidence-backed Relic category. Metadata resolved without failure. Exact replay retained one normalized agent, five raw events, and one ownership change. A small 8004scan reconciliation returned five matches, zero mismatches, and one unverified-secondary absent image.
