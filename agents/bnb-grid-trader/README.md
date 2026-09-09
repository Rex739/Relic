# Relic BNB Grid Trader (prototype)

> This is the original deterministic planning prototype. The deployed seller
> workspace is [`../RelicGridTrader`](../RelicGridTrader), which adds the
> private signer and public gateway boundaries.

This original planning milestone is deliberately constrained to BSC Testnet and
the BNB/USDT pair. It exposes a deterministic grid-plan API, accepts only a
capital cap, a price range, 5–8 grid levels, and a 1–168 hour duration, and
derives a finite plan with a 15-minute execution cooldown.

The public service must not execute a trade until the next milestone adds all
of the following: verified Relic mandate binding, exact router allowlisting,
buyer-approved capital cap, durable idempotency, on-chain receipt verification,
and a structured result submission. This separation makes the current service
safe to deploy while the execution boundary is built and tested.

Run locally:

```sh
pnpm --filter @relic/bnb-grid-trader dev
```

`POST /grid/plan` accepts the `GridTradingRequest` defined in `src/grid.ts`.
