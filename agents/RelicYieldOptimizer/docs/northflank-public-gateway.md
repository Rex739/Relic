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

Required secrets: `ALTANA_SESSION`, `PRIVATE_AGENT_BEARER_TOKEN`,
`BSC_TESTNET_RPC_URL`, `DATABASE_URL`, and the verified Venus deployment
values. Do not put any of these into a Docker build argument or repository
file.

## Layer B — public gateway

| Setting | Value |
| --- | --- |
| Service name | `relic-yield-optimizer-gateway` |
| Dockerfile | `Dockerfile` |
| Port | `8003` |
| Liveness | `GET /health` |
| Readiness | `GET /ready` |
| Public paths | `/.well-known/agent-card.json`, `POST /apex` |

Set `PRIVATE_AGENT_BEARER_TOKEN` as the same Northflank secret used by Layer
A. Set `PRIVATE_AGENT_URL` to Layer A's internal Northflank URL and set
`ALLOW_INTERNAL_HTTP=true` only for that internal URL. After Northflank assigns
the public HTTPS domain, set `PUBLIC_SERVICE_URL` to that origin and redeploy.

Before registering the agent identity, verify `/health`, `/ready`, and the
agent card externally. The card must advertise `<PUBLIC_SERVICE_URL>/apex`.
