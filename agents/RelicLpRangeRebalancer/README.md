# Relic LP Range Rebalancer

A BNB Chain seller agent for one PancakeSwap V3 BNB/USDT liquidity position.
Its initial value layer is deterministic: it returns a signed-job deliverable
that says whether to **HOLD** or **REBALANCE**, proposes a new range, and
records the buyer's cap, duration, and one-hour cooldown.

It is deliberately **plan-only** today. A later execution adapter must verify
the buyer mandate immediately before touching either approved PancakeSwap V3
testnet contract. It must not turn an LLM response into a transaction.

## Buyer request contract

The paid job's `terms.rebalance` object must contain:

```json
{
  "positionTokenId": "123",
  "capitalCap": "25",
  "currentPrice": "700",
  "currentLowerPrice": "620",
  "currentUpperPrice": "680",
  "rangeWidthBps": 1000,
  "durationHours": 2,
  "lastRebalanceAt": null
}
```

`rangeWidthBps: 1000` means a proposed range of ±10% around the current price.
The agent rejects malformed requests rather than guessing or widening a buyer's
scope.

## Workspace

- `app/agent/` — the seller agent and sole commerce signer.
- `.studio/` — encrypted admin keystore and local secrets; never commit it.
- `bag dev` — local development; `bag doctor` — readiness checks.
- `bag deploy --provider aws` — deploy to the user's AWS AgentCore account.
