# Northflank public gateway

This is the public Layer B endpoint for **Relic BNB Grid Trader**. It exposes
only an A2A surface and never stores a wallet, keystore, signing key, or AWS
credential. The private Studio Agent is Layer A and is reached only through
the internal `PRIVATE_AGENT_URL`.

This document prepares deployment configuration only. It does not create a
Northflank service, add secrets, create a wallet, or submit an on-chain
transaction.

## Service configuration

Create **two** Northflank combined services from the Relic repository. Layer A
is private and has no public route. Layer B is the public gateway.

### Layer A — private Grid Trader runtime

| Setting | Value |
| --- | --- |
| Name | `relic-grid-trader-agent` |
| Build context | `agents/RelicGridTrader` |
| Dockerfile | `Dockerfile.private-agent` |
| Port | `9000` |
| Private route | `GET /ping` or `GET /readiness` |
| Public exposure | Disabled |

Set `ALTANA_SESSION` as a **Northflank secret** containing the full contents
of the local `.studio/wallets/altana-session.json` file. Never add the local
keystore, `.studio` directory, or wallet password to the image or git.

Create a long random `PRIVATE_AGENT_BEARER_TOKEN` secret. In production the
private runtime refuses to start without it, and accepts useful agent routes
only when the gateway presents the same bearer credential. Do **not** publish
this service: it must remain on the Northflank private network.

### Layer B — public gateway

Create the public gateway service with:

| Setting | Value |
| --- | --- |
| Name | `relic-grid-trader-gateway` |
| Build context | `agents/RelicGridTrader` |
| Dockerfile | `Dockerfile` |
| Port | `8003` (or Northflank's injected `PORT`) |
| Liveness | `GET /health` |
| Readiness | `GET /ready` |
| Public route | `/.well-known/agent-card.json` and `POST /apex` |

The container runs as the unprivileged `node` user. It has no runtime package
install, and only the compiled gateway is included in the final image.

## Runtime values

| Variable | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_SERVICE_URL` | Yes | The generated HTTPS Northflank URL, without a trailing slash. It is published in the agent card. |
| `PRIVATE_AGENT_URL` | Yes | The private Studio Agent's A2A ingress. Use its internal Northflank `http://` address with `ALLOW_INTERNAL_HTTP=true`, or HTTPS otherwise. Never publish this value. |
| `PRIVATE_AGENT_BEARER_TOKEN` | Required secret | The same long random service-to-service credential used by Layer A. The private runtime refuses to boot in production without it. |
| `PORT` | Northflank injects | HTTP listening port; defaults to `8003` locally. |
| `NODE_ENV` | Yes | `production`; enforces HTTPS for the private agent URL. |
| `ALLOW_INTERNAL_HTTP` | Only for private Northflank DNS | Set to `true` only when `PRIVATE_AGENT_URL` is an internal `http://` Northflank service address. |

`PRIVATE_AGENT_BEARER_TOKEN` belongs in a Northflank secret. It is never sent
to buyers and is not returned in errors, health checks, or the agent card.

## Buyer and seller experience

1. A buyer reaches the public HTTPS gateway from Relic — no AWS IAM sign-in.
2. Relic authenticates the marketplace user and uses the paid order to decide
   whether a request is allowed.
3. The gateway accepts only the declared `negotiate` or `notify_funded` A2A
   skills and forwards them to Layer A with its internal credential.
4. The private Studio Agent validates the request and, when the order permits
   it, handles the BNB testnet interaction.

An external seller can operate the same pattern with their own public gateway
and compatible endpoint. Relic does not require their cloud account or IAM
role; it verifies their endpoint and the signed/order-bound result envelope.

## Verification before publishing the route

After setting the values, verify these externally:

```sh
curl -fsS https://YOUR-GATEWAY/health
curl -fsS https://YOUR-GATEWAY/ready
curl -fsS https://YOUR-GATEWAY/.well-known/agent-card.json
```

`/ready` should return `200` only when `PRIVATE_AGENT_URL` is valid. Test
`POST /apex` through Relic's authenticated integration, not with a private
agent credential in a browser.
