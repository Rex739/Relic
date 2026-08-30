# Relic Yield Scout — read-only Venus yield agent

Relic Yield Scout observes the Venus Core Pool on BSC Testnet at a pinned
block, ranks supply markets by their estimated APY, and reports raw liquidity
and utilization evidence. The APY estimate uses the market's on-chain
`supplyRatePerBlock` and the recently observed BSC block interval.

The observation path is deterministic and does not use an LLM. It cannot move
funds, approve tokens, rebalance a position, or submit a DeFi transaction.
ERC-8183 quote and delivery writes remain isolated in the Studio-generated
fixed signing boundary.

The valuable Agent and **SOLE key-holder/signer** for the Relic Yield Scout
seller is configured for a self-owned AWS AgentCore deployment. It serves an
A2A agent card at `/.well-known/agent-card.json` plus JSON-RPC `message/send`
on port 9000. Delivery is deterministic: the TypeScript runtime observes
Venus at one pinned BSC Testnet block and returns canonical JSON. Every
signing operation remains fixed entrypoint code and is never exposed as an
agent-callable tool.

## What's here

- `src/unifiedMain.ts` — the supported AgentCore A2A entrypoint.
- `src/yieldReader.ts` — deterministic, read-only Venus observation.
- `src/signing.ts` — fixed commerce signing entrypoints.
- `studio.toml` — network, wallet, price bounds, storage, and deployment config.
- The earlier Python implementation remains alongside the TypeScript runtime
  as migration reference and is not part of the AgentCore entrypoint.
- `.env.local` — Agent secrets; on deploy they are sent to the **operator's**
  Secrets Manager (the scoped, consented commitment-#2 exception). Use a
  THROWAWAY testnet wallet — `(cd app/agent && bag wallet new)`.

## Run locally

`bag dev` from the workspace root runs the A2A server in-process (`python
main.py`, no Docker) on its contract port:

```bash
bag dev                                    # A2A on http://localhost:9000
```

It auto-loads `.studio/.env.local` (via python-dotenv; no need to `source` it).

## Deploy (self-owned AWS AgentCore)

```bash
export AWS_PROFILE=relic
export AWS_REGION=us-east-1
bag deploy prepare --provider aws
bag deploy --provider aws
```

`bag deploy` packages the CodeZip runtime, syncs the runtime secret bundle to
AWS Secrets Manager, and deploys into the operator-owned AWS account. This
path has no BNB managed-platform 48-hour expiry; normal AWS consumption
charges apply. Supply `WALLET_PASSWORD` only through the deployment shell and
never commit or print it.
