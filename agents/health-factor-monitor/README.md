# Relic health-factor monitor

This is the single Phase 05 **Relic-operated reference seller**. It is not
independent marketplace supply and its `relic_reference` classification is not
a trust score.

The TypeScript seller uses `@bnbagent/sdk@0.5.0`, advertises a zero raw-token
price, watches funded ERC-8183 jobs, reads a Venus Core position through
read-only RPC calls, and submits a structured deliverable. It cannot transfer,
repay, supply, approve, or sign arbitrary DeFi transactions.

Live startup is intentionally blocked unless a human provides the encrypted
keystore password and the exact existing keystore file. The runtime refuses
`PRIVATE_KEY` and refuses to let the SDK create a wallet when the configured
keystore is absent. Wallet files remain untracked. Production deliverable
manifests use the existing Postgres/Supabase backend rather than ephemeral
`.agent-data`. Deterministic tests inject a reader whose result is explicitly
labelled `fixture`; production uses `VenusCoreReader`, whose result is explicitly
labelled `onchain` with its observed block.

Agent Studio CLI `bag 0.0.5` does not expose a TypeScript scaffold flag. Its
self-hosted AgentCore scaffold is Python/ADK and uses a single `app/agent`
layer. Relic therefore keeps this TypeScript SDK implementation as the source
of truth and adds a minimal Studio launch adapter under `app/agent`; it does
not add an obsolete `app/service` layer.

## Agent Studio workspace

Run Studio commands from this directory or `app/agent`:

```text
health-factor-monitor/
├── .studio/                 # ignored local security state
│   └── wallets/             # empty until the human runs bag wallet new
├── app/
│   └── agent/
│       ├── main.py          # Studio-to-TypeScript launch adapter
│       ├── pyproject.toml
│       └── studio.toml
├── src/                     # canonical TypeScript seller implementation
└── test/
```

`app/agent/studio.toml` uses BSC Testnet, the official testnet U token, and
`price = min_price = max_price = "0"`; every negotiated service price is
therefore clamped to exactly zero. Studio 0.0.5 warns that a zero
`max_price` is "unset", although zero is intentional for this reference
seller.

There is no `agentcore/agentcore.json` yet. The native `agentcore` CLI creates
and owns that deployment descriptor, and it is not installed on this machine.
Local TypeScript tests and direct seller development do not require it.

No wallet, identity, endpoint, or transaction is created by this structure.
