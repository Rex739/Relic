# Relic LP Range Rebalancer

A BNB Chain seller agent for one PancakeSwap V3 BNB/USDT liquidity position.
Its initial value layer is deterministic: it returns a signed-job deliverable
that says whether to **HOLD** or **REBALANCE**, proposes a new range, and
records the buyer's cap, duration, and one-hour cooldown.

The marketplace execution path verifies the buyer mandate immediately before
submitting the fixed PancakeSwap V3 calls. It never turns an LLM response into
a transaction: the agent's deterministic plan is advisory, while the Relic API
independently validates the live NFT, pool, cap, cooldown, session permission,
and receipts before execution.

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
- `app/agent/` — private Layer A signer runtime for Northflank.
- `app/service/` — public Layer B A2A gateway for Northflank; it has no
  wallet or Altana session material.

## Deployment

Deploy the two Northflank services described in
[`docs/northflank-public-gateway.md`](docs/northflank-public-gateway.md).
The private Layer A receives the Altana session as a Northflank secret; Layer B
is the only public endpoint. Marketplace hires execute through the Relic API,
which holds each buyer's encrypted, bounded Altana session rather than sharing
it with the public gateway.
