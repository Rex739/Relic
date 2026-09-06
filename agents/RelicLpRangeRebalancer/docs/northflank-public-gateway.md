# Northflank public gateway

Relic LP Range Rebalancer runs as two Northflank services, matching the Grid
Trader deployment pattern.

- **Layer A** is the private Studio signer. It is the only process that can
  read the buyer's Altana session, and it has no public route.
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
| `ALTANA_SESSION` | Full JSON contents of the local `.studio/wallets/altana-session.json` file |
| `PRIVATE_AGENT_BEARER_TOKEN` | A newly generated long random service-to-service credential |

Set `NODE_ENV=production`. The container materializes `ALTANA_SESSION` only in
its ephemeral filesystem, with owner-only permissions. Never put `.studio`, a
keystore, a wallet password, or this session JSON in git, a Docker image, or
Layer B.

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
publish Layer A's URL. The current agent value layer returns deterministic LP
range plans; a PancakeSwap execution adapter must be separately completed and
verified before describing the agent as executing liquidity withdrawals or
deposits.
