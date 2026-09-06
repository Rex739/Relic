# Northflank public gateway

Relic LP Range Rebalancer runs as two Northflank services, matching the Grid
Trader deployment pattern.

- **Layer A** is the private A2A delivery runtime. It has no public route and
  never receives buyer Altana sessions.
- **Layer B** is the public A2A gateway. It exposes only the declared seller
  skills and carries no wallet, session, or signing key.

This document configures deployment only. It does not create services, add
secrets, create wallets, or submit blockchain transactions.

## Layer A — private signer runtime

Create a Northflank combined service with these settings:

| Setting | Value |
| --- | --- |
| Name | `relic-lp-range-rebalancer-agent` |
| Build context | `agents/RelicLpRangeRebalancer` |
| Dockerfile | `Dockerfile.private-agent` |
| Port | `9000` |
| Readiness | `GET /ping` or `GET /readiness` |
| Public exposure | Disabled |

Add these runtime values as Northflank secrets:

| Variable | Value |
| --- | --- |
| `ALTANA_SESSION` | Seller agent's own Studio session JSON, used only for fixed ERC-8183 quote/delivery signatures; never a buyer session |
| `PRIVATE_AGENT_BEARER_TOKEN` | A newly generated long random service-to-service credential |
| `RELIC_EXECUTOR_URL` | Private HTTPS base URL of Relic's ECS API |
| `RELIC_LP_REBALANCER_INTERNAL_TOKEN` | A newly generated 32+ character credential shared only with the ECS API |

Set `NODE_ENV=production`. Never put a buyer session, `.studio`, a keystore,
or a wallet password in git, a Docker image, or Layer B. Layer A receives only
the seller's existing signing session. It forwards an already verified job id;
ECS resolves its associated mandate and decrypts the buyer session only for
that mandate.

## Layer B — public A2A gateway

Create a second Northflank combined service:

| Setting | Value |
| --- | --- |
| Name | `relic-lp-range-rebalancer-gateway` |
| Build context | `agents/RelicLpRangeRebalancer` |
| Dockerfile | `Dockerfile` |
| Port | `8003` (or Northflank-injected `PORT`) |
| Liveness | `GET /health` |
| Readiness | `GET /ready` |
| Public routes | `/.well-known/agent-card.json`, `POST /apex` |

Set these runtime values:

| Variable | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_SERVICE_URL` | Yes | Layer B's generated HTTPS URL, without a trailing slash |
| `PRIVATE_AGENT_URL` | Yes | Layer A's private Northflank HTTP URL |
| `PRIVATE_AGENT_BEARER_TOKEN` | Secret | The same value used by Layer A |
| `NODE_ENV` | Yes | `production` |
| `ALLOW_INTERNAL_HTTP` | Yes for private Northflank DNS | `true` only when `PRIVATE_AGENT_URL` is an internal `http://` address |

The public gateway accepts only `negotiate` and `notify_funded`; it adds the
private bearer credential while forwarding the request. It does not reveal the
credential in an agent card, error, or health response.

## Verify before publishing the marketplace listing

After both services are healthy, verify Layer B externally:

```sh
curl -fsS https://YOUR-GATEWAY/health
curl -fsS https://YOUR-GATEWAY/ready
curl -fsS https://YOUR-GATEWAY/.well-known/agent-card.json
```

Then set the marketplace service endpoint to the public `/apex` URL. Do not
publish Layer A's URL. A verified funded Relic job is delegated to the
mandate-bound PancakeSwap executor; direct planning requests remain
deterministic and non-transactional.
