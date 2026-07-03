# Relic Kaspa Release Commitment

Relic's Kaspa Release Commitment layer models a release-control safety property for risky legacy-system changes:

```text
Relic deterministic review receipt
  -> release commitment
  -> required owner acknowledgements
  -> remediation required
  -> separate clean review creates a new release-ready commitment
```

This is not a payment rail and not a cosmetic chain badge. The app-level state machine in `src/lib/relic/kaspa/releaseCommitment.ts` makes the blocked Meridian Grid receipt an immutable release-control record.

## Safety Property

For the Meridian Grid demo, the blocked review is:

- Review ID: `REL-MER-2026-0701-001`
- Verdict: `BLOCKED`
- Finding: duplicate-charge condition detected
- Evidence: 8 impacted components, 5 critical paths, 1 failed regression test, 842 potentially affected commercial accounts
- Required owners: Finance Systems Owner and Billing Policy Lead

The valid blocked lifecycle is:

```text
AWAITING_ACKNOWLEDGEMENTS
  -> FINANCE_ACKNOWLEDGED
  -> REMEDIATION_REQUIRED
```

There is intentionally no valid transition from a blocked commitment to `RELEASE_READY`. A clean review creates a distinct commitment with a different commitment ID and a `sourceCommitmentId` reference to the original blocked commitment.

## Kaspa Scope

This workspace targets Kaspa Testnet 12 only.

Do not use this prototype on mainnet. Do not add private keys, wallet seeds, test funds, or deployment credentials to this repository.

## Covenant Artifact

`contracts/ReleaseCommitment.sil` is a Silverscript singleton covenant for the blocked-review commitment. It models:

- the original commitment identifier
- the evidence digest
- sequential finance then billing acknowledgements
- owner/attestor public keys
- a remediation-required terminal state for the blocked commitment
- supersession by a separate clean commitment identifier

The covenant deliberately does not include a `RELEASE_READY` state or a transition from blocked/remediation-required to release-ready.

## Compilation Status

Successfully compiled locally for Kaspa Testnet 12.

- Official toolchain: `https://github.com/kaspanet/silverscript`
- Official workspace path used locally: `/tmp/relic-silverscript`
- Official validation run first: `cargo test -p silverscript-lang`
- Rust requirement from official workspace: `1.85.0`
- Local Rust used: `rustc 1.95.0`
- Compiler package: `silverscript-lang`
- Compiler binary: `silverc`
- Compiler version in artifact: `0.1.0`
- Compile command:

```bash
cargo run -p silverscript-lang --bin silverc -- \
  /Users/progressojemeh/Projects/hackathons/Relic/kaspa/contracts/ReleaseCommitment.sil \
  --constructor-args /Users/progressojemeh/Projects/hackathons/Relic/kaspa/contracts/ReleaseCommitment.args.json \
  -o /Users/progressojemeh/Projects/hackathons/Relic/kaspa/artifacts/ReleaseCommitment.json
```

- Artifact: `kaspa/artifacts/ReleaseCommitment.json`
- Artifact includes `contract_name`, `compiler_version`, `script`, `ast`, `abi`, `state_layout`, and `debug_info`.
- No deployment was performed.
- No transaction ID exists.
- No wallet, private key, seed phrase, testnet funds, or mainnet logic was added.

## Verification Status

Compiled locally for Kaspa Testnet 12. Not deployed. No transaction has been submitted.

- Compilation: successful with the official `silverscript-lang` `silverc` compiler.
- Static verification: completed by `npm run kaspa:verify` against the real source contract and generated artifact.
- Runtime covenant execution: not verified for this Relic contract.
- Runtime limitation: the official debugger documents covenant transaction-context tests, but the Relic contract transition paths require valid signature checks. No wallet/private-key material was created or used, so runtime covenant execution was not performed.
- Testnet deployment status: not deployed.
- Mainnet status: not compatible or claimed; this workspace is Testnet 12 only.
- Forbidden transition status: `BLOCKED -> RELEASE_READY` is statically verified as absent from the source, compiler-produced AST, and ABI. It has not been proven rejected by runtime transaction-context execution.
- Verification report: `kaspa/artifacts/ReleaseCommitment.verification.md`

## Validation

Run:

```bash
npm run kaspa:check
npm run kaspa:compile
npm run kaspa:verify
```

The scripts only inspect prerequisites and invoke the official local compiler workflow. They do not install Rust, Cargo, Silverscript, wallets, keys, or funds.

If the official toolchain is not present at `/tmp/relic-silverscript`, clone `https://github.com/kaspanet/silverscript` there or set `SILVERSCRIPT_ROOT` to a temporary external checkout. Do not vendor the compiler repository into Relic.

## Directories

- `contracts/`: Silverscript covenant source and deterministic constructor args.
- `scripts/`: local validation helpers.
- `tests/`: reserved for covenant-level tests once the compiler/test harness is available.
- `artifacts/`: generated compiler outputs. Do not commit secrets here.
