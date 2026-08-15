# Relic developer supply onboarding

Status: engineering interface for Phase 05. This is not polished public
documentation and does not imply that a submitted seller is trusted.

## What a developer controls

The developer owns their ERC-8004 identity, service endpoint, and signing
wallet. Relic never asks for or stores the private key. Public submissions are
always classified `third_party`; only an internal trusted workflow may assign
`partner` or `relic_reference`. Supply type records provenance/operation, not a
score.

## Reusable flow

1. Register an ERC-8004 identity on BNB Chain and publish a standards-shaped
   registration file containing the seller endpoint and service declarations.
2. Submit the onchain identifier:

   ```http
   POST /v1/agent-submissions
   content-type: application/json

   {
     "chainId": 97,
     "externalAgentId": "<uint256 token id>",
     "submitterAddress": "0x...",
     "developerOverrides": {
       "categorySlug": "health-factor-monitoring"
     }
   }
   ```

   Overrides retain `developer_declared` provenance. Relic independently reads
   the registry owner, registration URI, metadata, services, and endpoints.

3. After the canonical indexer has ingested the identity, request a challenge:
   `POST /v1/agent-submissions/{id}/ownership-challenges`.
4. Sign the exact returned EIP-191 message with the current onchain owner and
   send `challengeId` plus the signature to
   `POST /v1/agent-submissions/{id}/ownership-verification`.
5. Relic re-reads its canonical current-owner record, recovers the signer,
   consumes the challenge once, and stores a digest—not the raw signature.
6. An operator runs the bounded canonical import:

   ```sh
   pnpm supply:onboard -- --submission-id=<uuid>
   pnpm supply:materialize
   pnpm supply:inspect
   ```

7. Evidence must advance the existing Phase 04 service through `DECLARED`,
   `ENDPOINT_OBSERVED`, `SCHEMA_UNDERSTOOD`, `PAYMENT_UNDERSTOOD`,
   `INVOCATION_VERIFIED`, and `COMMERCE_VERIFIED`. Candidate `ACTIONABLE` is
   derived from those checks; no submission endpoint can set it directly.

## State and provenance

Submission state is durable:

`SUBMITTED → IDENTITY_CHECK → METADATA_CHECK → SERVICE_DISCOVERY → SERVICE_VERIFICATION → COMMERCE_PREFLIGHT → ACTIONABLE`

`BLOCKED`, `REJECTED`, and `STALE` are explicit outcomes. Every transition
requires evidence. The canonical agent writer and Phase 04 marketplace-service
materializer are reused; onboarding does not insert a fake agent or alternate
service catalog.

## Seller requirements

- A stable HTTPS endpoint with status, negotiation, job, and response routes.
- An ERC-8183 provider address consistent with the indexed declaration.
- Machine-readable input/output schemas and exact payment token/budget terms.
- Deterministic errors and bounded request bodies/timeouts.
- No secrets in metadata, logs, submission overrides, or Relic storage.

No source-code edit, hardcoded agent ID, hardcoded wallet, manual SQL, or
Relic-specific application schema is required for another ERC-8004/ERC-8183
seller. A new category still requires a normal taxonomy/product decision; that
is deliberately separate from onboarding an agent in an existing category.

## Optional live reference command

The testnet-only command is deliberately excluded from CI:

```sh
pnpm commerce:live:health-factor -- \
  --service-id=<relic service uuid> \
  --account=<read-only Venus account> \
  --wallets-dir=<encrypted buyer keystore directory> \
  --wallet-address=<optional buyer address>
```

It requires a human-provided `WALLET_PASSWORD`, selects only an already
`ACTIONABLE` and `COMMERCE_VERIFIED` `relic_reference` service, negotiates exact
price `0`, calls `createJob → registerJob → setBudget(0) → fund(0)`, waits for
seller delivery, and checkpoints. Resume after delivery/dispute window with:

```sh
pnpm commerce:live:health-factor -- \
  --activation-id=<uuid> \
  --wallets-dir=<encrypted buyer keystore directory>
```

Zero price skips ERC-20 approval/token transfer in SDK 0.5.0, but does not skip
the ERC-8183 state-changing transactions. Testnet paymaster sponsorship is
attempted by the SDK; operators must stop if sponsorship fails and the wallet
lacks free testnet gas. No mainnet or real-money fallback is permitted.
