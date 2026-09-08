# Northflank deployment — Relic Health Guard

Relic Health Guard runs as two independently deployed services.

- **Layer A** is the private executor. It verifies a configured Venus market,
  releases one encrypted buyer session only for a funded job, and is the only
  component allowed to sign a bounded repayment.
- **Layer B** is the public, keyless gateway. It serves the agent card and
  forwards only a funded job ID to Layer A.

This document prepares deployment settings only. It does not create a cloud
service, add a secret, register an agent, or enable Mainnet execution.

## Layer A — private executor

Create a private Northflank combined service:

| Setting | Value |
| --- | --- |
| Name | `relic-health-guard-private` |
| Build context | repository root |
| Dockerfile | `agents/RelicHealthGuard/Dockerfile.private-agent` |
| Port | `9000` |
| Liveness | `GET /health` |
| Readiness | `GET /readiness` |
| Public exposure | Disabled |

Set these as secrets or runtime values:

| Variable | Required | Notes |
| --- | --- | --- |
| `CHAIN_ID` | Yes | Exactly `56`. |
| `BSC_MAINNET_RPC_URL` | Yes | Dedicated authenticated Mainnet RPC preferred. |
| `HEALTH_GUARD_POOLS_JSON` | Yes | The exact verified registry also used by Relic API and web. |
| `MAX_REPAY_BASE_UNITS` | Yes | Global Mainnet ceiling; every buyer cap is additionally enforced. |
| `MINIMUM_BNB_GAS_RESERVE_WEI` | Yes | Refuse a cycle below this rescue-wallet BNB reserve. |
| `PRIVATE_AGENT_BEARER_TOKEN` | Secret | New high-entropy credential shared only with Layer B. |
| `RELIC_API_URL` | Yes | Private HTTPS/API origin. |
| `RELIC_HEALTH_GUARD_INTERNAL_TOKEN` | Secret | 32+ character credential shared only with Relic API. |
| `RELIC_HEALTH_GUARD_SESSION_TRANSFER_PRIVATE_KEY` | Secret | X25519 private key paired with the API public key. |
| `EXECUTION_ENABLED` | Yes | Start with `false`; a non-Mainnet chain fails startup. |
| `HEALTH_GUARD_SCHEDULER_ENABLED` | Yes | Start with `false`. |

Never expose Layer A publicly or copy a buyer session, private key, or pool
addresses into Layer B.

## Layer B — public gateway

Create a public Northflank combined service:

| Setting | Value |
| --- | --- |
| Name | `relic-health-guard-gateway` |
| Build context | repository root |
| Dockerfile | `agents/RelicHealthGuard/Dockerfile` |
| Port | `8004` or Northflank-injected `PORT` |
| Liveness | `GET /health` |
| Readiness | `GET /ready` |
| Public routes | `/.well-known/agent-card.json`, `POST /apex` |

| Variable | Required | Notes |
| --- | --- | --- |
| `PUBLIC_SERVICE_URL` | Yes | Generated public HTTPS origin, no trailing slash. |
| `PRIVATE_AGENT_URL` | Yes | Layer A private URL; never publish it. |
| `PRIVATE_AGENT_BEARER_TOKEN` | Secret | Same value as Layer A. |
| `ALLOW_INTERNAL_HTTP` | Conditional | `true` only for internal Northflank `http://` DNS. |

## Relic API prerequisites

Configure the API with the exact same `HEALTH_GUARD_POOLS_JSON`, plus:

`RELIC_HEALTH_GUARD_INTERNAL_TOKEN`, `RELIC_HEALTH_GUARD_AGENT_ID`,
`ALTANA_SESSION_ENCRYPTION_KEY`, and
`RELIC_HEALTH_GUARD_SESSION_TRANSFER_PUBLIC_KEY`.

The Health Guard marketplace agent must be registered with the Layer B public
`/apex` endpoint and the `repay_debt` capability only after both `/ready` and
the externally visible agent card succeed. Keep `EXECUTION_ENABLED=false` and
the scheduler disabled until a read-only borrower preflight and a complete
authorization handoff have been verified.

## Read-only release checks

```sh
curl -fsS https://YOUR-GATEWAY/health
curl -fsS https://YOUR-GATEWAY/ready
curl -fsS https://YOUR-GATEWAY/.well-known/agent-card.json
```

Then use a real borrower wallet with eligible Venus debt to run the Relic
checkout preflight. Do not create a funded job or switch on the scheduler as
part of these checks.
