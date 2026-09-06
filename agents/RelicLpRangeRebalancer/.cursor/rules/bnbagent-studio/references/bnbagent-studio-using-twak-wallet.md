---
name: bnbagent-studio-using-twak-wallet
description: When the user's project has [wallet].kind = "twak" (a fully-supported wallet kind, opt in with `--wallet-kind twak`) - creating the Trust Wallet Agent Kit wallet, anchoring its address, funding it, SIWE-binding for Pieverse, deploying it as a container, and working around its known limitations.
---

> **Reference file** of the `bnbagent-studio` router skill - installed at `bnbagent-studio/references/` and loaded on demand (not a standalone skill). Route here via the router's decision tree.

# bnbagent-studio-using-twak-wallet

Procedure for setting up and operating the **twak** wallet kind (Trust Wallet Agent Kit CLI) in a bnbagent-studio project. twak is a **fully-supported** wallet kind - opt in at scaffold with `bag init <name> --wallet-kind twak` (`evm-local`, a local keystore, is the default). The wallet is a **self-custody, AES-256-GCM-encrypted mnemonic** the user controls (not a hosted service), living by default in a **project-dedicated** home `.studio/twak` (`[wallet].twak_home`), isolated from your main `~/.twak`. The default kind is `evm-local` (local keystore); re-scaffold with `--wallet-kind twak` to use twak.

## 1. Install the CLI

Needs Node >=22:

```bash
npm install -g @trustwallet/cli@0.20.0
twak --version
```

studio requires **>= 0.20.0** (the SDK forwards `--paymaster-url` on sponsored bsc-testnet writes - the flag first shipped in v0.20.0; older CLIs reject it with "unknown option"); `bag doctor` and `bag deploy prepare` verify the floor.

## 2. Create the wallet - one time, in YOUR terminal

`bag wallet twak-init` drives creation for you (step 3) so you never type the password on a command line; the NaaS setup wizard below still has to be run by hand once, because it is interactive.

**Every twak command is prefixed with the dedicated home.** Without `HOME=$DH`, twak uses your real `~/.twak` (your MAIN wallet) and macOS pops a login-keychain password prompt. Set it once:

```bash
DH=<workspace>/.studio/twak     # e.g. ~/proj/.studio/twak
```

**1. Get Trust Wallet NaaS API credentials** (one time; account-level, NOT wallet-specific). Make an app at https://portal.trustwallet.com/dashboard/apps → copy its Access ID + HMAC secret. (`twak wallet create` fails with "No API credentials found" without them.)

**2. Run the setup wizard** - writes the credentials into the dedicated home:

```bash
HOME="$DH" twak setup
```

- **Step 1 (API credentials):** paste the Access ID + HMAC secret. WalletConnect Project ID → leave blank, ENTER.
- **Step 2 ("which harnesses to wire up"): SELECT NONE - press ENTER** on the empty list (do NOT press SPACE or `a`). 🔒 This would register twak's signing MCP into Claude Code / Cursor / etc., handing wallet+signing power to your AI assistant (and any prompt-injection reaching it) - studio forbids that: signing is fixed `signing.ts` code, the LLM only receives read-only chain tools, and the deployed agent never calls twak via MCP.
- **Step 3 (Wallet "Pick one"): choose `3) Skip for now`** (you create it in the next step). NOT `2) Use WalletConnect with my existing wallet` (binds your main/real wallet).

**3. Create the wallet** (password UPPER + lower + digit, e.g. `Mypasswd01`; `mypasswd01` is rejected). **RECOMMENDED - let studio drive it so you never type the password on a command line** (it resolves the project home from studio.toml, so no `HOME=` juggling):

```bash
bag wallet twak-init                                       # interactive hidden prompt
printf %s "$PW" | bag wallet twak-init --password-stdin    # CI / scripts
bag wallet twak-init --password-file pw.txt                # file must be chmod 600
```

It seeds this home's `credentials.json` from `~/.twak` when step 2 was run there, wraps `twak wallet create --password … --no-keychain` (twak requires the flag on its own argv, so the value reaches that short-lived child - it never lands in YOUR shell history), tightens `wallet.json` to mode 600, and adopts the address into studio.toml in one go - so step 5's `bag wallet new` is already done.

Manual alternative (you type the password on argv → `ps` / shell history; acceptable only for a throwaway hot wallet):

```bash
HOME="$DH" twak wallet create --password '<StrongPw>' --no-keychain
```

`--no-keychain` keeps the password OUT of the OS keychain - it lives only in `TWAK_WALLET_PASSWORD` (step 4), so creation triggers **no macOS keychain prompt**. Expect: "Agent wallet created successfully / Wallet registered with backend / Generated addresses for 25 chains". (twak then prints "Restart your harness… / Try a sample query…" - that's for MCP users; ignore it, studio doesn't use twak's MCP.)

> **Already have a wallet here?** If twak says `Wallet already exists. Back up … then delete it`, the wallet is already created - do **NOT** follow the literal "delete it". `wallet.json` is the ONLY copy of your AES-256-GCM encrypted mnemonic; deleting it without the mnemonic backed up loses the funds **forever**. Confirm it's yours (`HOME="$DH" twak wallet addresses`), skip create, and go straight to step 5 - `bag wallet new` just ADOPTS the existing address (idempotent, never destructive). Only recreate if you've safely backed up the mnemonic, and then `mv` `wallet.json` to a `.bak` rather than deleting.

> **CI / scripts:** use `bag wallet twak-init --password-stdin` / `--password-file` above - it is the supported non-interactive path and works on headless runners (no keychain involved). Avoid the older `TWAK_NONINTERACTIVE=1 TWAK_SETUP_WALLET=create … twak setup` route: it has no `--no-keychain` equivalent, stores the password in the OS keychain, and aborts with `STORAGE_ERROR` on headless / Docker runners.

**4. Put the unlock password in `.env.local`** - **YOU edit the file** (never through the chat, never `bag env set <literal>` - the password must not reach the assistant or argv). Same value as Step 3:

```
# .studio/.env.local
TWAK_WALLET_PASSWORD=<StrongPw>
```

studio AND the deployed runtime unlock via this env - the keychain copy is local-only and never deploys, so this line is mandatory or deploy can't sign.

**5. Anchor + activate** - back in a NORMAL shell (**no `HOME=` prefix**; studio resolves the home from `[wallet].twak_home` itself, and `bag wallet new` ADOPTS the address - it does not create a second wallet):

```bash
cd <workspace>/app/agent
bag wallet new      # writes the NEW address into studio.toml [wallet].address - confirm it's the new wallet, not your main one
bag llm activate    # zero-deposit Pieverse key
bag doctor          # all PASS (zero balance is a WARN, fine)
```

### macOS keychain - bypassed by default

With `--no-keychain` (step 3) the wallet password lives ONLY in `TWAK_WALLET_PASSWORD` (step 4) - twak never reads or writes the OS keychain, so both creation and signing trigger **no macOS password prompt**. studio and the deployed runtime unlock via that env, so nothing is lost by skipping the keychain.

> **Safety net (you normally never see it):** for the rare case you create a wallet WITHOUT `--no-keychain`, `bag init` (and `bag wallet new`) also auto-creates an isolated, **empty-password** keychain under `$DH/Library/Keychains` - secret-free, scoped to `$DH` (your real login keychain untouched), never deployed. With `--no-keychain` twak doesn't touch any keychain at all.

> ⚠️ **If you omitted `--no-keychain` and a macOS prompt LOOPS** (or a bare `twak setup` prompted against your **main** login keychain and rejects every password): **Do NOT click "Reset Default Keychain"** - it erases your Wi-Fi passwords, SSH passphrases, and saved app secrets. Quit it with `pkill -9 -f twak`, then recreate the wallet **disk-only**:
>
> ```bash
> HOME="$DH" twak wallet create --password '<StrongPw>' --no-keychain
> ```
>
> and rely on `TWAK_WALLET_PASSWORD` (step 4) to unlock - same end state, no keychain involved.

### Other wallet placements

`bag init` always writes a project-dedicated `[wallet].twak_home`; the flow above is the default (a brand-new dedicated wallet). Alternatives:

- **Reuse an existing wallet** across agents → `bag init --twak-home <path>` (that wallet's HOME-style dir, containing `.twak/wallet.json`). Same flow: create with `--no-keychain`, unlock via `TWAK_WALLET_PASSWORD`.
- **Your main `~/.twak`** (DISCOURAGED - real funds / bound identities) → opt-in only via `bag init --twak-home ~`, or "yes" to the warned prompt (default "no") when a machine wallet is detected. Recorded as `[wallet].twak_home = <$HOME>`.

Each wallet is its own address → its own ERC-8004 identity, Pieverse SIWE binding, and secret bundle; `bag doctor` / `bag deploy` resolve the right one via `[wallet].twak_home`.

## 3. Fund it - and keep it a HOT wallet

Two assets, two different rules:

- **U (payment token)** - the principal for x402 topups (LLM credit) and what buyers pay you. x402 payments are **GASLESS** (EIP-3009, the facilitator settles), so topping up burns no BNB. A twak wallet is also a supported b402 **seller** payout wallet (`bag init --wallet-kind twak --rails b402`); receiving needs no signature or gas either.
- **BNB (gas)** - **testnet canonical contracts normally use sponsorship; mainnet needs a little for ERC-8183.** Testnet: the SDK forwards MegaFuel's testnet paymaster (`--paymaster-url`, twak >= 0.20.0). Sponsorship still depends on the paymaster policy covering the target contract and method; keep a little tBNB (~0.007) as fallback. Mainnet: x402 stays gasless and `bag 8004 register` is gas-sponsored by twak internally (Trust gateway - studio passes no paymaster flag), but **`8183 settle` / `fund` self-pay gas**, so keep ~0.007 BNB on the wallet for them.

> ⚠️ **MegaFuel testnet relay reliability (BUG-029).** The bsctestnet relay has been observed accepting a sponsored write, returning a tx hash, and then never broadcasting it - the hash is unverifiable on every public RPC and the wallet nonce never moves (reproduced 2026-07-24 and 2026-07-28 with raw `twak erc8183 create-job --paymaster-url …`). Do NOT treat raw `twak erc8183` sponsored bsctestnet writes as a stable PASS path for tests/CI. Drive the write through studio (`bag erc8004 …`, `bag erc8183 …`) or the SDK's `TWAKProvider` instead: those classify the failure (`RelaySubmissionUnverifiedError` = relay swallowed it, never persist the hash as pending; `TransactionPendingError` = the tx IS visible, wait) instead of a bare receipt timeout. Self-pay escape hatches: `--no-paymaster` on studio 8004 writes, or `BNBAGENT_USE_PAYMASTER=0` for any studio/SDK call.

**Hot-wallet rule**: fund only a few days of spend. The Agent wallet is an operational hot wallet, not a treasury - the on-chain balance is the one spending limit nothing can bypass. Studio's daily caps (`[budget].max_per_day_usd`) are in-process guardrails: real across CLI runs (persisted to `.studio/spend-ledger.json`), best-effort in the deployed runtime (in-memory, resets on cold start).

On testnet, message https://t.me/bnbchain_official_bot with `I would like to get tBNB to my wallet <address>` for gas and `I would like to get U to my wallet <address>` for ERC-8183 U. More options: https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/ (tBNB) and https://united-coin-u.github.io/u-faucet/ (U). Mainnet: U via PancakeSwap; keep BNB for ERC-8183 fund/settle.

## 4. SIWE binding (Pieverse) - ALWAYS bind before paying

Pieverse attributes x402 topups to the **SIWE-bound payer address** (the paid call carries no session header on the twak path). `bag llm activate` performs the SIWE login (an EIP-191 `sign_message`, which twak supports) before any payment, so the normal flow is safe. If you ever top up through a custom path: bind first, pay second - an unbound payment cannot be attributed.

## 5. Local dev (no Docker) vs deploy (Container image)

**Local dev needs no Docker.** `bag dev` runs the agent **in-process** by default (the TS entrypoint, no Docker) - the keystore/twak materialize hooks are no-ops locally, so in-process exercises the same code path as the deployed container minus the image. Use `bag dev --container` only if you want the AgentCore dev container for full image parity (that mode runs via `agentcore dev` and needs Docker / Podman / Finch); it is **not** required to develop or test the twak agent locally.

**Deploy ships a Container image.** The managed AgentCore image can't host the twak CLI toolchain, so a twak Agent deploys as a **custom container** (Node >=22

- the twak CLI). `bag init` already configured everything: `agentcore.json` registers a `Container` runtime and `app/agent/Dockerfile` builds the image (linux/arm64 - an x86 machine needs docker buildx for cross-build).

* Local Docker is **required** for `bag deploy --provider aws`: the pinned `bnbagent-deploy` (to which Studio delegates all cloud lifecycle mutations) builds the image locally (linux/arm64) and pushes it to ECR - there is no remote-build fallback, so the Docker daemon must be running.
* Wallet material reaches the runtime ONLY via AWS Secrets Manager (`TWAK_WALLET_JSON` / `TWAK_CREDENTIALS_JSON` / `TWAK_WALLET_PASSWORD`), never inside the image. `bag deploy prepare` verifies all of this.

## 6. Known limitations (upstream twak CLI v0.20.0)

| Limitation | Upstream ref | What you see |
| --- | --- | --- |
| ~~Seller `submit` unavailable~~ | ~~REQ-1~~ RESOLVED in v0.19.0 | `submit --opt-params` works - verified on-chain. |
| ~~Seller `quote` signing broken~~ | ~~S-11 regression in v0.19.0~~ RESOLVED in v0.19.1 | v0.19.0 hex-decoded `0x…` messages and signed the bytes, so provider_sig never verified (testnet also rejected `sign-message --chain bsctestnet`). v0.19.1 signs the literal text (EIP-191): `sign_quote` works on both wallet kinds. |
| ~~No testnet paymaster URL~~ | ~~REQ-2~~ RESOLVED in v0.20.0 | twak accepts `--paymaster-url`; the SDK forwards MegaFuel's testnet endpoint on eligible writes. Actual sponsorship depends on the paymaster policy covering the target and method (the relay itself is flaky - see the BUG-029 warning in §3). The CLI floor is **0.20.0**. |
| Custom ERC-8004 registry | supported | Set `ERC8004_REGISTRY_ADDRESS`; the SDK requires the intent target and env override to match before invoking twak. Sponsorship still depends on paymaster policy coverage, so keep fallback tBNB. |
| Custom ERC-8183 targets unavailable | upstream feature request | twak v0.20.0 has no Commerce/Router/Policy address option. Studio doctor/prepare and the SDK fail closed instead of silently executing on canonical contracts; use `evm-local` for a custom ERC-8183 deployment. |
| No generic EIP-712 signing | P0 (won't fix) | `[wallet.signing]` is ignored; payments go through the delegated payer's own prechecks + `--max-payment`. Endpoints needing an `Authorization` header _and_ x402 are unavailable (e.g. `bag llm key new --initial-usd > 0` - use `--initial-usd 0` + topup + allocate instead, same end state). |
| No wallet import | S-6 | Switching wallet kinds changes your address → re-run `bag 8004 register` (new on-chain identity). |
| Programmatic wallet creation forces password onto argv | S-8 | Bridged by `bag wallet twak-init` (you supply it via stdin / 0600 file / hidden prompt; studio forwards it on the child's argv because twak requires the flag); the manual twak commands remain a fallback. |
| CLI has no daily/monthly caps | - | Studio's policy layer (`[budget].max_per_day_usd`, host allowlist, per-request caps) is the spend authority for both wallet kinds. |
| `twak wallet balance --chain bsctestnet` rejects the chain | BUG-031 | Fails with `CHAIN_UNSUPPORTED` even though `wallet address` and `erc8183` accept `bsctestnet`. Use `bag wallet balance` (RPC-based, works on testnet), or raw RPC: `eth_getBalance` for tBNB and an `eth_call` of `balanceOf(address)` on the U token for token balance. |
| `twak tx <hash> --chain bsctestnet` rejects the chain | BUG-032 | Same chain-registry gap on the readback path: transactions twak itself just mined on `bsctestnet` cannot be inspected with `twak tx`. Use public RPC (`eth_getTransactionByHash` / `eth_getTransactionReceipt`) or BscScan testnet instead. |
| Raw `twak erc8183 create-job` has no expiry preflight | BUG-030 | An `--expires-at` inside the policy's dispute window is accepted, all four funding steps succeed, and only the final `submit` reverts `SubmissionTooLate()` (`0x15e5dd74`). Prefer the SDK path (`ERC8183Client` preflights this); if you must use the raw CLI, set `expires_at ≥ now + deadline + dispute_window` - on testnet's 24h window, `now + 172800` (48h) is a safe floor. |

## 7. Quick health checks

```bash
bag doctor                  # [wallet] twak CLI / wallet / address-anchor checks
bag wallet show             # describe(): address, key_location, capabilities
bag wallet balance          # BNB + U via RPC (works on testnet too)
bag deploy prepare          # container/Dockerfile/secret checks before deploy
```
