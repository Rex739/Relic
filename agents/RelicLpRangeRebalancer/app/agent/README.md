# RelicLpRangeRebalancer — A2A + X402 seller agent

The valuable Agent and the **SOLE key-holder/signer** for the RelicLpRangeRebalancer seller.
Runs as the private Layer A signer behind the Northflank public gateway. Every
signing op (quote-clamp-sign / submit / settle) is fixed entrypoint code in
`src/signing.ts` — never an LLM-callable tool.

## What's here

- `src/unifiedMain.ts` — unified serving entrypoint (A2A on port 9000 + Foundry invocations on 8088).
- `src/executor.ts` — the SellerAgentExecutor: the negotiate + notify_funded A2A skills.
- `src/agentCard.ts` — the discoverable AgentCard (+ OAuth2/Cognito scheme).
- `src/signing.ts` — protocol-neutral signing entrypoints. ALL on-chain writes
  go through these functions — never an LLM-callable tool.
- `src/model.ts` — provider adapter (e.g. the Pieverse managed model with
  budget-gated LLM-credit auto-renew).
- `src/tools.ts` — read-only chain tools.
- `studio.toml` — Agent's own config (wallet, LLM, price bounds, budget).
- the wallet key material lives OUTSIDE this sub-project so deploy packaging can
  never bundle it: an evm-local keystore at the WORKSPACE root `.studio/wallets/`,
  or the twak mnemonic in the project's twak home (gitignored either way).

## Set up

```bash
# from the workspace root — installs the agent package too (pnpm workspace):
pnpm install
```

## Run locally

Run the Agent with `bag dev` from the workspace root — it auto-loads
`.studio/.env.local` and runs the agent in-process (`tsx src/unifiedMain.ts`, no
Docker). Use `bag dev --container` to run it via `agentcore dev` in Docker
for image parity.

```bash
bag dev                                    # A2A + X402 on http://localhost:9000
```

## Deploy

Build this package into the private Northflank Layer A service using
`../../Dockerfile.private-agent`. The service must remain private and receive
`ALTANA_SESSION` and `PRIVATE_AGENT_BEARER_TOKEN` as runtime secrets. See
[`../../docs/northflank-public-gateway.md`](../../docs/northflank-public-gateway.md)
for the full two-layer configuration.
