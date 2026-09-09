# Yield Optimizer: BSC Mainnet release

This is a **separate deployment** from the existing BSC Testnet agent. Do not
reuse its public URL, private URL, session material, bearer tokens, wallet, or
any `VENUS_TESTNET_*` value.

## Mainnet Layer A environment

Set these non-secret values in the new private executor service:

```ini
RELIC_YIELD_NETWORK=bsc-mainnet
RELIC_YIELD_MAINNET_ENABLED=true
CHAIN_ID=56
BSC_MAINNET_RPC_URL=https://<your authenticated BSC mainnet RPC>
VENUS_MAINNET_USDT=<officially verified mainnet USDT address>
VENUS_MAINNET_COMPTROLLER=<officially verified Venus mainnet Comptroller>
VENUS_MAINNET_USDT_VTOKEN=<officially verified Venus USDT market address>
VENUS_MAINNET_USDT_DECIMALS=<value read from that USDT contract>
MAX_JOB_AMOUNT_BASE_UNITS=<strict USDT base-unit cap>
MINIMUM_BNB_GAS_RESERVE_WEI=<strict BNB reserve>
RELIC_API_URL=https://<relic-api>
PORT=9000
```

Attach separately-created secrets for:

```ini
PRIVATE_AGENT_BEARER_TOKEN
RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN
RELIC_YIELD_SESSION_TRANSFER_PRIVATE_KEY
```

Before making this service reachable, run its read-only deployment verifier:

```sh
pnpm --dir agents/RelicYieldOptimizer/app/agent verify-deployment
```

It must report `"chainId":56`, the expected token symbol and decimals, and
the configured vToken's underlying/Comptroller relationship. It sends no
transaction. A failed verifier means the service must remain unavailable.

## Mainnet Layer B environment

Set:

```ini
RELIC_YIELD_NETWORK=bsc-mainnet
PUBLIC_SERVICE_URL=https://<new public gateway URL>
PRIVATE_AGENT_URL=https://<new private executor URL>
RELIC_API_URL=https://<relic-api>
PORT=8003
```

Attach the new Layer A bearer token and a separate internal API token. The
agent card will then advertise `BSC Mainnet`; it stays `BSC Testnet` unless
this exact network setting is present.

## Release gate

1. Verify Venus addresses from the current official Venus deployment source
   and the mainnet RPC. Do not copy addresses from testnet or from this file.
2. Create a fresh, mainnet-only wallet/session with a very small cap and BNB
   reserve. Never copy testnet keystore or session data.
3. Run the read-only verifier in Layer A and check `/readiness` is `ready`.
4. Register/import the distinct mainnet ERC-8004 identity and create a new
   mainnet listing. Testnet identity and evidence do not prove mainnet.
5. Make one deliberately tiny, user-approved canary job. Review all receipts
   before increasing the cap.

`RELIC_YIELD_MAINNET_ENABLED=true` is intentionally mandatory. Omitting it,
using chain 97, or missing any `VENUS_MAINNET_*` variable fails startup.
