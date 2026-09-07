# Relic Yield Optimizer

The optimizer is a separate executable agent. `RelicYieldScout` remains a
read-only observer and is not promoted to a signer.

The first release permits only BSC Testnet USDT approvals, Venus supply, and
Venus withdrawal after a Relic-bound buyer mandate passes the fixed policy.
All deployment addresses are injected at runtime and must be verified before
the private executor becomes ready.

This folder intentionally contains no wallet, session file, RPC credential, or
deployment address default.

## Phase 2: required live validation

Before a private executor is deployed, inject these values as Northflank
secrets and run `pnpm --dir app/agent verify-deployment` from the same
environment:

- `CHAIN_ID=97`
- `BSC_TESTNET_RPC_URL`
- `VENUS_TESTNET_USDT`
- `VENUS_TESTNET_COMPTROLLER`
- `VENUS_TESTNET_USDT_VTOKEN`
- `VENUS_TESTNET_USDT_DECIMALS`
- `MAX_JOB_AMOUNT_BASE_UNITS`
- `MINIMUM_BNB_GAS_RESERVE_WEI`

The command performs only JSON-RPC reads. It fails if the RPC is not BSC
Testnet, any configured contract lacks bytecode, token decimals differ, or the
configured vToken does not report the configured USDT and Comptroller. It also
reads the USDT balance held by the vToken as its withdrawal-liquidity evidence.
No address is silently substituted from source code.
