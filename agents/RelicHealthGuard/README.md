# Relic Health Guard

Relic Health Guard is a Mainnet-first, executable Venus health-protection service. It is deliberately separate from `health-factor-monitor`, which remains the read-only BSC Testnet reference monitor.

## What V1 can do

- Monitor a buyer-selected Venus borrower account on BSC Mainnet.
- Repay only the debt market selected for that buyer's configured pool, using the buyer's isolated, authorized rescue-wallet balance of that debt asset.
- Submit an exact ERC-20 approval only when required, then call the configured Venus market's `repayBorrowBehalf(borrower, amount)`.
- Enforce a per-action cap, aggregate cap, health-factor trigger and target, cooldown, mandate expiry, minimum USDT reserve, transaction-fee cap, idempotency, simulation, confirmation, and emergency pause.

The runtime supports one verified Venus pool per job. It can carry multiple verified pools in its deployment registry; the job's pool ID resolves the exact debt token, vToken, Comptroller, session permissions, simulation target, and reader. It derives the health factor from same-block Venus account snapshots, that pool's Comptroller collateral factors, and its oracle prices; it refuses to act when any of that evidence cannot be read or validated.

## What it cannot do

- It cannot swap, borrow, withdraw collateral, move funds to a third party, or call a buyer-supplied contract.
- It cannot use a pooled Relic reserve. Every buyer job has a separate session, policy, reserve, and evidence trail.
- It has no default contract addresses or private keys. Deployment must inject independently verified BSC Mainnet configuration.

## Deployment topology

`public gateway -> private executor -> bounded per-job signer -> Venus`

The public gateway exposes an agent card and accepts only funded-job notifications. It has no wallet or protocol authority. The private executor is the sole signer boundary and must run on private networking with a shared service credential.

Relic's API exposes only two private, bearer-authenticated endpoints for this service: a one-job encrypted session release and a canonical execution request. Browser/A2A input is never accepted as a mandate or payment instruction.

## Required Mainnet configuration

`CHAIN_ID=56`, `BSC_MAINNET_RPC_URL`, `HEALTH_GUARD_POOLS_JSON`, `MAX_REPAY_BASE_UNITS`, `MINIMUM_BNB_GAS_RESERVE_WEI`, `PRIVATE_AGENT_BEARER_TOKEN`, and `EXECUTION_ENABLED=true` are required. `HEALTH_GUARD_POOLS_JSON` is a deployment-owned JSON array:

```json
[
  {
    "id": "venus-core-usdt",
    "name": "Venus Core Pool",
    "protocol": "Venus",
    "network": "BNB Chain",
    "debtAsset": "USDT",
    "debtAssetAddress": "0x...",
    "debtVTokenAddress": "0x...",
    "comptrollerAddress": "0x...",
    "debtAssetDecimals": 18
  }
]
```

There are no address defaults. Every registry entry must come from official Venus deployment records and independently pass the runtime's bytecode, `underlying()`, and `comptroller()` verification before execution can be enabled.

`EXECUTION_ENABLED` defaults to false. This is not a Testnet switch: when enabled with a chain ID other than 56, startup fails.

Before deployment, run `pnpm audit:mainnet` with the production environment injected. It performs read-only RPC and bytecode/underlying/comptroller verification and checks that private runtime credentials are present. It does not start a scheduler, create a buyer session, or submit a transaction.
