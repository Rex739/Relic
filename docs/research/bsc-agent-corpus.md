# BSC agent corpus: controlled Phase 03 findings

Observed on 2026-08-14. These are development-database measurements from a bounded real run, not test fixtures and not estimates of the complete ecosystem.

## Scope and evidence boundaries

Relic imported the first eight 8004scan BSC pages at 25 rows per page. The persisted corpus contains 200 unique chain identities and the resume checkpoint is page 9. An explicit replay of page 1 changed neither the 200-row corpus nor the checkpoint. At the final import response, 8004scan reported 255,155 BSC agents, so this sample covers 0.0784%; that upstream total is live and can change.

- **8004scan secondary data:** discovery, names, descriptions, images, declared protocols, x402 flags, and indexed feedback counts. These remain `secondary_unverified` unless another source establishes them.
- **Direct BSC evidence:** registry, token ID, current owner, and current metadata pointer for five selected identities. Direct facts are `onchain_verified`; registration-file profile claims remain `developer_declared`.
- **Relic observations:** guarded endpoint HEAD results, normalization, completeness/readiness facts, classifications, and duplicate signals. Endpoint evidence is `independently_observed`.
- **Test fixtures:** realistic but synthetic records used only by automated tests. They are not included in any number below.

## Aggregate findings

| Dimension                           | Real persisted result                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Imported / upstream reported        | 200 / 255,155 (0.0784%)                                                                  |
| Directly verified                   | 5 / 200 (2.5%); 195 remain unverified                                                    |
| Unique owners                       | 71                                                                                       |
| Name                                | 175 present; 25 blank/missing                                                            |
| Description                         | 171 present; 29 blank/missing                                                            |
| Image                               | 116 present; 84 missing                                                                  |
| Directly proven resolvable metadata | 1; 199 not proven resolvable in this run                                                 |
| Broken direct metadata observations | 4                                                                                        |
| Empty/whitespace profiles           | 25                                                                                       |
| Service declarations                | 190 agents with declarations; 10 without                                                 |
| Multiple normalized interfaces      | 74 agents                                                                                |
| Readiness                           | 79 `PARTIAL`; 121 `DISCOVERABLE`; 0 `NOT_READY`; 0 `ACTIONABLE`                          |
| Required categories                 | 0 in each of rebalancing, grid-trading, yield-optimisation, and health-factor-monitoring |
| Uncategorized                       | 200                                                                                      |
| Feedback inventory                  | 199 with an 8004scan feedback count; 1 without                                           |
| Malformed imported rows             | 0                                                                                        |
| Direct/secondary identity conflicts | 0 agents, 0 mismatch observations                                                        |

The completeness percentage is a count of 16 listing facts. It is not trust, safety, performance, ranking, or an Agent Score. The strongest row measured 81%, but no sample qualified as `ACTIONABLE` because the persisted evidence did not jointly prove understandable profile, resolvable metadata, usable endpoint/interface, and commercial information.

### Interface distribution

| Normalized declaration | Agents |
| ---------------------- | -----: |
| x402                   |    185 |
| OASF                   |     71 |
| MCP                    |      7 |
| A2A                    |      4 |
| HTTP/API               |      3 |
| Email                  |      1 |
| Other normalized types |      0 |
| Malformed declarations |      0 |

These counts overlap: one agent can expose several types. An x402 flag is a commercial protocol declaration, not proof that a callable agent endpoint exists.

### Ownership concentration

Of 71 owners, 56 published one sampled agent. The sampled agents-per-owner distribution was: 56 owners with 1, 2 with 2, 6 with 3, 3 with 5, 2 with 6, one with 28, and one with 67. The two largest sampled publishers therefore account for 95 of 200 rows. This is a concentration observation, not a maliciousness label.

### Provenance inventory

The sample contained 1,112 `secondary_unverified`, 30 `onchain_verified`, four `developer_declared`, and one `independently_observed` evidence/observation records. There were no `agent_reported` facts in this run. Counts are evidence records, not unique agents, so they should not be added to infer corpus size.

## Representative records

- **Strongest measured listing:** token 14, `BTCAI`, was directly identity-verified, had OASF and x402 declarations, one indexed feedback, resolvable direct metadata, and 81% listing completeness. It is `DISCOVERABLE`, not an endorsement.
- **Incomplete listing:** token 2, `Agent #2`, had 19% completeness, no meaningful description, no image, and no service declaration. It remains `PARTIAL` and secondary-only.
- **Broken metadata:** tokens 10–13 (`ETHAI`, `BNBAI`, `LTCAI`, `BIGAI`) were directly identity-verified, while direct metadata resolution produced failed observations for their current compressed data URIs. Their secondary profile fields remain visible with explicit provenance.
- **Multi-service listing:** token 137, `EZCTO Deployer Agent`, declared four normalized types: A2A, HTTP/API, MCP, and x402. Its 63% completeness yields `DISCOVERABLE` only.
- **Required category match:** none was found. All 200 stay uncategorized rather than being forced into a category.
- **Unusual/duplicate behavior:** tokens 15, 98, and 103 shared an identical-description fingerprint; tokens 137, 138, and 143 shared an image. Whitespace-only profile text also occurred. These are structural review signals, not spam or fraud determinations.

## Endpoint availability

Relic made three bounded, credential-free, SSRF-guarded HEAD observations and stored no response bodies:

| Corpus scope                   | Agent        | Result                                                      |
| ------------------------------ | ------------ | ----------------------------------------------------------- |
| In the 200-agent sample        | token 14     | GitHub OASF URL responded HTTP 200 in 977 ms                |
| Existing Phase 02 direct agent | token 266548 | Termix A2A template URL responded HTTP 404 in 894 ms        |
| Existing Phase 02 direct agent | token 266548 | Termix services template URL responded HTTP 404 in 1,028 ms |

All three are transport-level `reachable` observations. A 200 response does not prove agent functionality, and a 404 from an unresolved `{agentId}` template does not prove the eventual concrete endpoint is unavailable. Only the first observation belongs to the 200-agent corpus aggregate.

## Reputation inventory

The agent list exposed `total_feedbacks`, `average_score`, `total_score`, `star_count`, and `health_score`; Relic retains these as raw/secondary inventory and does not turn them into a Relic score. A controlled `/feedbacks` request returned transaction hash, block number, reviewer/user address, agent registry and token, endpoint, tags, value, decimals, indexed score, parse status, and optional off-chain data. The response returned token IDs other than the requested `tokenId=1`, so filter behavior was not reliable enough to promote those records into canonical per-agent reputation. On-chain-identifiable fields and 8004scan-derived fields must be separated before deeper ingestion.

## Duplicate signals

Relic persists analytical signals without deleting or suppressing agents. The final run found 45 signal memberships: 20 across six repeated-description groups and three repeated-image groups, plus a 25-agent empty/whitespace-profile group. No repeated current metadata-pointer or declared-endpoint group occurred in this sample, but both are covered by the detector. Rerunning `corpus:report` refreshes the materialized signal set. Fingerprints preserve comparison utility without treating similarity as intent.

## NodeReal archive investigation

The public NodeReal BSC example endpoint, used only for this bounded experiment, successfully served:

- `eth_getLogs` for blocks 79,094,807–79,094,808: four registry logs;
- `eth_getLogs` for blocks 79,094,807–79,094,907: the same four logs;
- `eth_getBlockByNumber` for block 79,094,807, including hash `0xb520f87a9afff23dbd7d6319f98c67b922c549199bbe1960c1a73410cf712397`;
- `eth_getTransactionReceipt` for the canonical registration transaction, status 1 and four logs.

NodeReal's published free plan advertised $0, no card, three API keys, 10 million compute units, 150 CUPS, and archive access. Its BSC documentation limits `eth_getLogs` to 50,000 blocks and notes different response limits at ranges above 100 blocks. The public example credential has no production availability or quota guarantee. Relic therefore supports an optional `NODEREAL_BSC_RPC_URL` but does not depend on it; an operator-owned key still needs a longer reliability test.

## Product implications

The corpus strongly favors progressive disclosure: show evidence source and verification state next to identity facts; treat missing images as cosmetic; keep “listing completeness” separate from trust; distinguish a declared protocol from a callable endpoint; make uncategorized a normal state; and group repeated publisher/metadata patterns for analyst review rather than silently hiding records. The large gap between indexed profile availability and directly resolved metadata also argues for asynchronous verification states in every marketplace surface.

The one recommended next milestone is **a bounded continuous verification and freshness worker** that drains the priority queue, refreshes stale direct facts, safely re-observes concrete endpoints, and measures coverage over time before any public discovery UI is built.
