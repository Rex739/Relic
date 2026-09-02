# AWS marketplace deployment

This runbook deploys the public Relic marketplace to **Amazon ECS on Fargate**
in `us-east-1` (US East, N. Virginia), using `userelic.app` as the canonical
public domain.
It does not deploy seller agents to Bedrock AgentCore and it does not require
any seller to use AWS. Relic only reads an agent's public declared service
endpoint and its on-chain identity.

The existing [Northflank reference-runtime deployment](./northflank-reference-runtime.md)
remains the Health Factor Monitor's own seller runtime. Keep it running during
this marketplace deployment. Moving that individual seller runtime to AWS is a
separate, explicit migration.

## AWS architecture

```text
Internet -> Route 53 + ACM -> Application Load Balancer -> ECS/Fargate relic-web
                                                         -> private relic-api
                                                              |
                                                        Supabase Postgres

EventBridge Scheduler -> ECS/Fargate relic-indexer-sync
ECS/Fargate relic-commerce-worker -> BSC RPC + Supabase
ECS task execution role -> ECR + CloudWatch Logs + Secrets Manager
```

Provision an ACM certificate in `us-east-1` for both `userelic.app` and
`www.userelic.app`. Redirect `www.userelic.app` to `https://userelic.app`;
the canonical origin is always the apex domain.

Use Fargate because Relic has three normal container processes: a public
Next.js app, a private authenticated API, and a long-running reconciliation
worker. Fargate runs those containers without managing EC2 servers, while ECS
services keep long-running processes at their configured desired count. Use an
Application Load Balancer for the public HTTP marketplace service.

## ECS services and jobs

Build every target from repository-root
[`Dockerfile.marketplace`](../../Dockerfile.marketplace). The root
[`Dockerfile`](../../Dockerfile) is reserved for the reference seller runtime.

| ECS workload | Docker target | ECS form | Network | Initial size |
| --- | --- | --- | --- | --- |
| `relic-web` | `web` | ECS service | Public ALB target, port `3000` | 0.5 vCPU / 1 GB, 1 task |
| `relic-api` | `api` | ECS service | Private subnet, port `8787` | 0.5 vCPU / 1 GB, 1 task |
| `relic-commerce-worker` | `commerce-worker` | ECS service | Private subnet | 0.5 vCPU / 1 GB, 1 task |
| `relic-indexer-sync` | `indexer-sync` | EventBridge Scheduler `RunTask` | Private subnet | 0.5 vCPU / 1 GB, every 10 minutes |
| `relic-migrate` | `migrate` | one-off ECS task | Private subnet | 0.5 vCPU / 1 GB, once per release |

Use `awsvpc` networking, Fargate compatibility, Linux/x86_64, and separate
task definitions for each target. Put all tasks in private subnets with NAT or
the required VPC endpoints. Only the ALB should accept inbound internet traffic.
The `relic-api` service is reached by the web service through ECS Service
Connect or Cloud Map, for example `http://relic-api:8787`; configure that
internal URL as the web service's server-only `RELIC_API_URL`.

Do not make the API public solely to connect the web app: Relic's Next.js route
handlers already proxy browser authentication and commerce requests to the API.

## Image delivery

1. Create one private ECR repository in `us-east-1`, named
   `relic/marketplace`.
2. Build and push the required image targets from CI using a GitHub OIDC role
   or AWS CodeBuild. Do not build from a laptop as the release mechanism.
3. Tag each immutable release with the Git SHA; do not deploy mutable `latest`
   tags.
4. Register a new task-definition revision that references that immutable ECR
   digest, then update the relevant ECS service.

The Dockerfile accepts only these public build values because Next.js embeds
them in browser code:

| Build argument | Value |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Relic Privy app ID |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | Relic Privy client ID, if used |
| `NEXT_PUBLIC_API_URL` | Omit unless a browser-facing API URL is intentionally added later |

Never pass a database URL, RPC key, wallet key, API secret, or Privy
verification key as a Docker build argument.

## Secrets and IAM

Store server-only values in AWS Secrets Manager. Reference individual JSON keys
from the ECS task-definition `secrets` array. The **task execution role** needs
only the permissions to pull from ECR, write CloudWatch logs, and read the
specific Secrets Manager ARNs (plus the KMS decrypt permission if a customer
managed key is used). The application task role needs no wallet-signing
permission.

| Secret/runtime variable | API | Worker/indexer/migrate | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Required | Required | Supabase PostgreSQL connection |
| `BSC_MAINNET_RPC_URL` | Required | Required | Reliable ERC-8004 reads |
| `BSC_TESTNET_RPC_URL` | Required | Required | Testnet commerce and reconciliation |
| `8004SCAN_API_KEY` | Not needed | Recommended | Server-side discovery quota |
| `PRIVY_JWT_VERIFICATION_KEY` | Required | Not needed | Server-side Privy verification |
| `MANDATE_API_SECRET` | Required | Not needed | At least 32 characters |
| `RELIC_PUBLIC_ORIGIN` | Required | Not needed | `https://userelic.app` |
| `RELIC_WALLET_AUTH_DOMAIN` | Required | Not needed | `userelic.app` |
| `RELIC_WALLET_AUTH_URI` | Required | Not needed | `https://userelic.app` |
| `RELIC_ADMIN_PRINCIPAL_IDS` | Required for admin verification | Not needed | Comma-separated privileged principals |
| `RELIC_COMMERCE_EIP712_DOMAIN_ADDRESS` | Required for commerce | Required | Set to the selected ERC-8183 policy address; used only to domain-separate Relic EIP-712 buyer approvals |
| `RELIC_ERC8183_COMMERCE_ADDRESS` | Required for commerce | Required | Selected BSC Testnet contract |
| `RELIC_ERC8183_EVALUATOR_ADDRESS` | Required for commerce | Required | Selected BSC Testnet contract |
| `ERC8183_POLICY_ADDRESS` | If applicable | If applicable | Selected BSC Testnet policy contract |

Set `NODE_ENV=production` in every ECS task. Set `API_PORT=8787` for
`relic-api`. Do **not** set `RELIC_DEVELOPMENT_PRINCIPAL_ID` in AWS production.
The API intentionally refuses production commerce startup without wallet auth
and the required ERC-8183 addresses. That protects users from a false
"Hire" state.

Secrets injected into ECS environment variables are read when a task starts.
After rotation, force a new ECS deployment so the new task reads the new value.

## Release sequence

1. Configure the authoritative DNS zone and an ACM certificate in `us-east-1`
   for `userelic.app` plus `www.userelic.app`; point the apex record at the
   public ALB for `relic-web` and redirect `www` to the apex.
2. Add the marketplace origin to Privy's allowed origins. Build and push the
   immutable ECR images with the public Privy build arguments.
3. Create Secrets Manager entries and least-privilege execution/task roles.
4. Run `relic-migrate` once, confirm successful exit, then stop it.
5. Start `relic-api`; verify `GET /health` through a temporary internal check.
6. Start one `relic-commerce-worker` task and verify it remains healthy.
7. Start `relic-web`, attach it to the ALB, and verify the public HTTPS domain.
8. Run `relic-indexer-sync` once, then configure EventBridge Scheduler for a
   rate of 10 minutes with an execution role limited to `ecs:RunTask` for this
   task definition and `iam:PassRole` for its ECS roles.

Set CloudWatch alarms for ECS task exits, API ALB 5xx responses, commerce-worker
failures, and missed indexer schedules. Use one task for each service initially;
add replicas only after configuring a shared Next.js cache and a consistent
server-action encryption key.

## Production acceptance test

1. Open the public marketplace and browse Rebalancing, Grid Trading, Yield
   Optimisation, and Health Factor Monitoring.
2. Verify the API is healthy and the indexer has a recent checkpoint.
3. Connect a distinct buyer wallet and confirm the seller cannot act as buyer.
4. Create one real low-value BSC Testnet ERC-8183 job for a current, verified
   offer; fund it with the buyer wallet.
5. Observe delivery, receipt reconciliation, finality, and the resulting
   buyer-commerce record. Do not count a service verification as a completed
   buyer job or review.

This deploys **Relic's marketplace infrastructure** on AWS. It never asks
external agents for `RELIC_AGENTCORE_OAUTH_CLIENTS_JSON`, a relay credential,
or any AWS account access.
