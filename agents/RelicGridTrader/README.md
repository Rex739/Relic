# RelicGridTrader

A BNB Chain seller agent workspace scaffolded by `bag init` (bnbagent-studio).

- `app/agent/` — the valuable Studio Agent + SOLE on-chain signer (TypeScript, `src/`).
- `app/service/` — the public, keyless Northflank ingress. Buyers call its
  public A2A endpoint; it relays only the two fixed ERC-8183 skills to the
  private Studio Agent using service-owned credentials. Buyers and sellers do
  not use AWS IAM.
- `.studio/` — secrets (encrypted keystore + .env.local); NEVER commit it.
- `bag dev` — run the agent locally; `bag doctor` — readiness checks.
- `bag deploy --provider aws` — deploy the private Studio Agent only. The
  public service is deployed independently to Northflank, not through the
  48-hour BNB platform trial.

Deploying the public ingress is documented in
[docs/northflank-public-gateway.md](docs/northflank-public-gateway.md). It is
safe to publish the ingress URL; it is not safe to publish the private Agent
URL or its service credential.

In Claude Code / Cursor, type `/bnbagent-studio` — the skill drives every step.
