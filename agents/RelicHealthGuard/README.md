# Relic Health Guard

Relic Health Guard is a Mainnet-first, executable Venus health-protection service. It is deliberately separate from `health-factor-monitor`, which remains the read-only BSC Testnet reference monitor.

## What V1 can do

- Monitor a buyer-selected Venus borrower account on BSC Mainnet.
- Repay **only** the configured USDT debt market, using the buyer's isolated, authorized rescue-wallet USDT balance.
- Submit an exact ERC-20 approval only when required, then call the configured Venus market's `repayBorrowBehalf(borrower, amount)`.
- Enforce a per-action cap, aggregate cap, health-factor trigger and target, cooldown, mandate expiry, minimum USDT reserve, transaction-fee cap, idempotency, simulation, confirmation, and emergency pause.

## What it cannot do

- It cannot swap, borrow, withdraw collateral, move funds to a third party, or call a buyer-supplied contract.
- It cannot use a pooled Relic reserve. Every buyer job has a separate session, policy, reserve, and evidence trail.
- It has no default contract addresses or private keys. Deployment must inject independently verified BSC Mainnet configuration.

## Deployment topology

`public gateway -> private executor -> bounded per-job signer -> Venus`

The public gateway exposes an agent card and accepts only funded-job notifications. It has no wallet or protocol authority. The private executor is the sole signer boundary and must run on private networking with a shared service credential.

Relic's API exposes only two private, bearer-authenticated endpoints for this service: a one-job encrypted session release and a canonical execution request. Browser/A2A input is never accepted as a mandate or payment instruction.

## Required Mainnet configuration

`CHAIN_ID=56`, `BSC_MAINNET_RPC_URL`, `VENUS_USDT`, `VENUS_USDT_VTOKEN`, `VENUS_COMPTROLLER`, `USDT_DECIMALS`, `MAX_REPAY_BASE_UNITS`, `MINIMUM_BNB_GAS_RESERVE_WEI`, `PRIVATE_AGENT_BEARER_TOKEN`, and `EXECUTION_ENABLED=true` are all required. Contract values must be verified from official Venus deployment records and independently checked against the configured RPC before enabling execution.

`EXECUTION_ENABLED` defaults to false. This is not a Testnet switch: when enabled with a chain ID other than 56, startup fails.
