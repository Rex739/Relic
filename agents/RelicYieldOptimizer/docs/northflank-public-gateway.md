# Northflank deployment — Relic Yield Optimizer

Deploy two Combined Services from `agents/RelicYieldOptimizer`. Layer A stays
private. Layer B is the sole public route.

## Layer A — private executor

| Setting | Value |
| --- | --- |
| Service name | `relic-yield-optimizer-agent` |
| Port | `9000` |
| Exposure | Private only |
| Liveness | `GET /health` |
| Readiness | `GET /readiness` |

Required secrets: `PRIVATE_AGENT_BEARER_TOKEN`, `BSC_TESTNET_RPC_URL`,
`RELIC_API_URL`, `RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN`,
`RELIC_YIELD_SESSION_TRANSFER_PRIVATE_KEY`, and the verified Venus deployment
values: `CHAIN_ID=97`, `VENUS_TESTNET_USDT`, `VENUS_TESTNET_COMPTROLLER`,
`VENUS_TESTNET_USDT_VTOKEN`, `VENUS_TESTNET_USDT_DECIMALS`,
`MAX_JOB_AMOUNT_BASE_UNITS`, and `MINIMUM_BNB_GAS_RESERVE_WEI`. There is no
long-lived `ALTANA_SESSION`: Layer A requests and decrypts a buyer's one-job
session only after Relic has confirmed funding. Do not put any value into a
Docker build argument or repository file.

## Layer B — public gateway

| Setting | Value |
| --- | --- |
| Service name | `relic-yield-optimizer-gateway` |
| Dockerfile | `Dockerfile` |
| Port | `8003` |
| Liveness | `GET /health` |
| Readiness | `GET /ready` |
| Public paths | `/.well-known/agent-card.json`, `POST /apex` |

Set `PRIVATE_AGENT_BEARER_TOKEN` and
`RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN` to the same corresponding secrets used
by Layer A. Set `RELIC_API_URL` to the Relic API, `PRIVATE_AGENT_URL` to Layer
A's internal Northflank URL, and `ALLOW_INTERNAL_HTTP=true` only for that
internal URL. After Northflank assigns the public HTTPS domain, set
`PUBLIC_SERVICE_URL` to that origin and redeploy.

Before registering the agent identity, verify `/health`, `/ready`, and the
agent card externally. The card must advertise `<PUBLIC_SERVICE_URL>/apex`.
