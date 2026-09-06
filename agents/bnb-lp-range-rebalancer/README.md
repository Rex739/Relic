# Relic BNB LP Range Rebalancer

A bounded PancakeSwap V3 BNB/USDT range-rebalancing service for BSC Testnet.

For one buyer-approved LP-position NFT, the service calculates whether the
market price has left the active range. It will only produce a rebalance plan
when all of these are true:

- the pair is BNB/USDT on BSC Testnet;
- the buyer supplied a positive capital cap and a 1–168 hour expiry;
- the price has exited the active range; and
- at least one hour has passed since the previous rebalance.

The plan allowlists only PancakeSwap V3's testnet Position Manager and V3 Swap
Router. A real execution layer must additionally verify the Relic mandate and
Altana session, submit only these structured calls, independently verify
receipts, and publish the resulting service update. It must never accept raw
calldata or an arbitrary contract address.

Run locally:

```sh
pnpm --filter @relic/bnb-lp-range-rebalancer dev
```

`POST /lp-range/plan` accepts the `LpRangeRebalanceRequest` in
`src/rebalance.ts`.
