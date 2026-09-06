---
name: bnbagent-studio-using-altana-wallet
description: Use when a bnbagent-studio project selects wallet.kind = "altana" and needs the encrypted admin keystore, bounded runtime session lifecycle, ERC-8183 quote checker, x402 allowance, local dev, or session-only deployment and renewal.
---

# Using the Altana wallet

Altana separates trusted administration from runtime authority:

- `.studio/wallets/<address>.json` is the encrypted admin keystore.
- `.studio/wallets/altana-session.json` is the one bounded, expiring runtime session and must stay mode `0600`.
- `WALLET_PASSWORD` is admin-only. The Agent gets `ALTANA_SESSION`, never the password or admin keystore.
- Generic signing is refused. ERC-8183 uses `sessionQuoteSigner()` and the approved quote checker.
- The generated project pins `@bnbagent/sdk@0.5.5` and `@altananetwork/sdk@0.7.1`; doctor, readiness, and runtime loading reject version drift. SDK 0.5.4 introduced selector-bound calls, removed session-key token approvals, and requires an admin-provisioned bounded Commerce allowance. Projects upgrading from an older SDK must update it, re-grant with `bag wallet session grant --force`, and redeploy.
- Deployment ships ONLY the serialized session as the `ALTANA_SESSION` runtime secret; the admin keystore and `WALLET_PASSWORD` never leave the operator machine. Renewal after expiry: `bag wallet session grant --force`, then re-run `bag deploy`. Readiness fails on a missing/expired/address-mismatched session, a group/world-readable session file, a session inside the artifact root, or an unresolvable project-local `@altananetwork/sdk`; it warns under 7 days remaining. `bag deploy verify` needs `--skip-register` (no generic signing for the ERC-8004 register).
- Altana refuses generic message signing, so Pieverse SIWE cannot authenticate `bag llm activate` or runtime credit renewal. `bag init --wallet-kind altana --llm-provider pieverse-llm` is rejected outright; use OpenRouter, OpenAI, or Anthropic (API-key providers). `bag llm activate` and `bag doctor` also flag the combination on projects edited by hand.

## Procedure

```bash
bag init <name> --wallet-kind altana --destination self --no-onboard
# --destination platform is also accepted (48h trial; same session-only transport).
# Non-TTY defaults to OpenRouter. In a TTY, choose OpenRouter, OpenAI, or
# Anthropic from the provider menu; a flag remains available when desired:
# bag init <name> --wallet-kind altana --llm-provider anthropic --destination self
# Edit <name>/.studio/.env.local and set WALLET_PASSWORD first.
cd <name>/app/agent
bag wallet new
# fund the printed admin address with ~0.05 tBNB + U
bag wallet session grant
bag wallet session status
bag doctor
bag dev
```

Interactive grant recommendations are 10 U/day, 30 days, register=yes. In a non-TTY, pass `--budget-u`, `--expiry-days`, optional `--no-register`, and `--yes`. Stdout from a successful grant is only the session public key.

The grant persists the owner-only session, provisions a Commerce allowance no higher than its U-token cap, and approves the quote checker. Every relay-backed management write must return `CONFIRMED`; `PENDING` fails closed and preserves the session file. If either setup step fails after the paid grant, repair both with:

```bash
bag wallet session grant --approve-only
```

`--approve-only`, runtime loading, and deploy readiness reject pre-0.5.4 target-wide sessions. Replace one with `grant --force`; Studio zeros the old Commerce allowance before revoking, and both operations must be confirmed before the new grant begins. Revoke with `bag wallet session revoke --yes`; the file is deleted only after both confirmations.

x402 buying remains separate and exact-bounded:

```bash
bag wallet session x402-setup --allowance-u <U> --yes
```

Once armed, `bag x402 buy` pays b402-facilitated merchants (e.g. CoinMarketCap) end to end: B402 verifies the session's ERC-1271 signature on its **permit2 rails** (live since 2026-08 in production and, since 2026-08-20, in the QA/testnet environment). Studio's own b402 sellers advertise `permit2-exact` alongside `eip3009`, so Altana wallets can pay studio-hosted merchants too; eip3009-only merchants still need a 65-byte EOA signature and cannot be paid by a smart account. The buy preflight checks the U→Permit2 allowance against the spend cap, and `bag doctor` reports `[wallet] Altana x402 buying`. Use `@altananetwork/sdk` 0.7.1 in the project.

Altana can also be the b402 **seller** payout wallet for a positive price: the payout lands at `[wallet].address`, which for an EIP-7702 altana account is the admin EOA, so the locally-held admin keystore can always move the revenue. Issue the B402 merchant credentials for that exact address. Explicit `price_usd = "0"` stays FREE passthrough (no payout, bypasses B402). The outbound buying authority above remains a separate feature.

For troubleshooting, run `bag doctor` and `bag wallet session status`. Do not print, parse, or copy the `signer` portion of the serialized session, and never move `.studio/wallets/` under `app/agent/`.
