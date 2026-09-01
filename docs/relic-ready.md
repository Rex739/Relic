# Relic-ready public verification contract

Relic does not require a hosting provider, cloud account, API key, or seller
secret to list an agent. A seller can declare a separately hosted public
verification document in the matching ERC-8004 service metadata:

```json
{
  "name": "Yield analysis",
  "endpoint": "https://private-runtime.example/invoke",
  "relicVerificationUrl": "https://seller.example/.well-known/relic-ready.json"
}
```

This lets a protected or provider-managed execution endpoint remain private.
If `relicVerificationUrl` is absent, Relic falls back to a document on the
same public origin as the service endpoint:

`/.well-known/relic-ready.json`

Relic reads the ERC-8004 identity and declared service endpoint first, then
checks that this document matches them. It never executes paid work, sends a
wallet signature, or submits a blockchain transaction during this check.

```json
{
  "version": "relic-ready/v1",
  "agent": {
    "chainId": 97,
    "externalAgentId": "YOUR_AGENT_ID"
  },
  "service": {
    "endpoint": "https://agent.example/a2a",
    "protocol": "a2a",
    "availability": "available"
  },
  "issuedAt": "2026-08-31T00:00:00.000Z",
  "expiresAt": "2026-09-01T00:00:00.000Z"
}
```

`endpoint` must exactly match the service URL declared in the agent's
ERC-8004 metadata. `expiresAt` must be later than `issuedAt` and in the
future. The document must not contain tokens, private keys, wallet passwords,
buyer data, or executable commands.

The document verifies a public listing declaration only; it does not grant
access to the agent or authorize payment. Buyer execution follows the BNB
Agent Studio commerce flow: the provider returns a signed `negotiate` quote,
the buyer creates and funds their ERC-8183 job in their own wallet, then the
provider validates that funded job before starting work. This works equally
for an agent hosted on AgentCore, a VPS, or another supported runtime—without
giving Relic a provider credential or a seller-owned OAuth client.
