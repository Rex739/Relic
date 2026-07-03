# Kaspa Release Commitment Deployment Preflight

Status: READ-ONLY preflight only. No wallet, private key, seed phrase, address, faucet request, funds, deployment, transaction signing, transaction broadcast, or signing-wallet connection was created or performed.

Scope: Kaspa Testnet 12 proof planning for the already compiled Relic `ReleaseCommitment` covenant artifact at `kaspa/artifacts/ReleaseCommitment.json`.

## Official Sources Checked

- Kaspa Toccata guide: https://docs.kaspa.org/toccata
- Covenant state guide: https://docs.kaspa.org/toccata/covenant-state
- Transaction V1 guide: https://docs.kaspa.org/toccata/transaction-v1
- Script pricing guide: https://docs.kaspa.org/toccata/script-pricing
- Silverscript guide: https://docs.kaspa.org/toccata/silverscript
- Wallet integration guide: https://docs.kaspa.org/integrate/wallet
- Accepted transaction inspection guide: https://docs.kaspa.org/integrate/accepted-transactions
- Kaspa node guide: https://docs.kaspa.org/integrate/kaspa-node
- Kaspa integration references: https://docs.kaspa.org/references
- Toccata references and source-of-truth map: https://docs.kaspa.org/toccata/references
- Official Silverscript repository: https://github.com/kaspanet/silverscript
- Official Rusty Kaspa repository: https://github.com/kaspanet/rusty-kaspa

The checked Toccata references state that KIPs and implementation code are the source of truth if guides and code differ. Local source inspection used the `rusty-kaspa` checkout pinned by the official Silverscript dependency.

## Current Relic Contract Context

Contract source: `kaspa/contracts/ReleaseCommitment.sil`

Compiled artifact: `kaspa/artifacts/ReleaseCommitment.json`

Constructor arguments: `kaspa/contracts/ReleaseCommitment.args.json`

- Contract name: `ReleaseCommitment`
- Compiler version: `0.1.0`
- Testnet scope: Kaspa Testnet 12 only
- Script byte length: `748`
- State layout: `{ "start": 1, "len": 211 }`
- Deployment status: not deployed
- Runtime proof status: static only

ABI entrypoints:

- `__covenant_entrypoint_auth_acknowledgeFinance(financeSignature: sig)`
- `__covenant_entrypoint_auth_acknowledgeBilling(billingSignature: sig)`
- `__covenant_entrypoint_auth_supersede(attestorSignature: sig, supersedingCommitmentId: byte[32])`

Covenant state fields:

- `commitmentId: byte[32]`
- `evidenceDigest: byte[32]`
- `sourceCommitmentId: byte[32]`
- `status: int`
- `financeAcknowledged: bool`
- `billingAcknowledged: bool`
- `financeOwner: pubkey`
- `billingPolicyLead: pubkey`
- `relicAttestor: pubkey`

Constructor arguments:

1. `initCommitmentId: byte[32]`
2. `initEvidenceDigest: byte[32]`
3. `initSourceCommitmentId: byte[32]`
4. `initStatus: int`
5. `initFinanceAcknowledged: bool`
6. `initBillingAcknowledged: bool`
7. `initFinanceOwner: pubkey`
8. `initBillingPolicyLead: pubkey`
9. `initRelicAttestor: pubkey`

The current fixture initializes the commitment as `AWAITING_ACKNOWLEDGEMENTS` with `status = 0`, both acknowledgement flags false, a deterministic 32-byte commitment id, a deterministic 32-byte evidence digest, a zeroed source commitment id, and placeholder role public keys.

Acknowledgement flow:

- `acknowledgeFinance` requires `status == 0`, both acknowledgement flags false, and a valid Finance Systems Owner signature. It returns `status = 1`, `financeAcknowledged = true`, and `billingAcknowledged = false`.
- `acknowledgeBilling` requires `status == 1`, `financeAcknowledged == true`, `billingAcknowledged == false`, and a valid Billing Policy Lead signature. It returns `status = 2` and both acknowledgement flags true.
- The resulting blocked commitment state is `REMEDIATION_REQUIRED`.

Supersede flow:

- `supersede` requires `status == 2`, both acknowledgement flags true, a `supersedingCommitmentId` that differs from the original `commitmentId`, and a valid Relic attestor signature.
- It returns `status = 3`, preserves the original `commitmentId` and `evidenceDigest`, and records the superseding commitment id in `sourceCommitmentId`.
- This is not a `RELEASE_READY` mutation. The original blocked commitment remains an evidence record.

There is no `RELEASE_READY` ABI entrypoint and no transition returning a release-ready status. A clean release-ready proof must be represented by a separate clean commitment, not by mutating this blocked commitment into release ready.

Dynamic values that must replace deterministic fixtures before real deployment:

- Real 32-byte Relic commitment id.
- Real 32-byte evidence digest from the Relic review receipt.
- Genesis `sourceCommitmentId`, normally zero bytes unless this is itself a derived commitment.
- Initial state values for the intended genesis state: `status = 0`, `financeAcknowledged = false`, `billingAcknowledged = false`.
- Real test-only public keys for Finance Systems Owner, Billing Policy Lead, and Relic attestor.
- Funding UTXO and output plan.
- Transaction V1 compute budgets.
- Fees, change output, and covenant UTXO value.
- Genesis covenant id and each successor covenant binding.
- Signatures produced locally by the required secret-bearing identities.

## Preflight Answers

### 1. Suitable official transaction-building path

The most suitable official path is a custom Transaction V1 builder using the official Kaspa SDK/source stack, with the Silverscript artifact supplying the covenant script and generated entrypoints.

For this covenant, the most exact path is Rust against `rusty-kaspa` APIs pinned by the Silverscript toolchain. The local source exposes the required primitives:

- `TransactionInput::new_with_compute_budget(...)`
- `TransactionOutput { value, script_public_key, covenant: Option<CovenantBinding> }`
- `CovenantBinding { authorizing_input, covenant_id }`
- genesis covenant id calculation in the covenant context implementation
- `ComputeBudget::checked_covering_script_units(...)`
- RPC submission primitives such as `submit_transaction`

The Wallet API is official and appropriate for ordinary wallet/account/send flows, but the checked official wallet examples do not provide a complete covenant Transaction V1 builder recipe for this custom Silverscript covenant. It can support funding and account operations later, but the covenant transaction construction should be implemented against official low-level Transaction V1 and covenant primitives unless newer official examples supersede this preflight.

### 2. Local full node requirement

A local full node is optional for initial connectivity, because the official integration references describe public-node routing through the PNN/resolver path. It is recommended for reproducible covenant deployment proof and UTXO indexing.

For production-grade or hackathon-demo reproducibility, run a self-hosted `kaspad` with UTXO indexing and wRPC enabled, as described by the official node guide. This avoids relying on changing public node availability and gives deterministic access for accepted-transaction inspection.

### 3. Public Testnet 12 access route

The official references identify SDK connectivity through wRPC and a resolver/public-node route. They do not require a local node for every read path.

This preflight did not confirm a single stable official hardcoded Testnet 12 RPC endpoint that should be committed into Relic. A future deployer should use the official SDK resolver or a self-hosted Testnet 12 node, and should avoid committing mutable public endpoint assumptions into the covenant proof.

### 4. Minimum test-only identities

Required secret-bearing identities:

- Deployment/funding identity: controls funded Testnet 12 UTXOs and pays transaction fees.
- Finance Systems Owner authorization identity: signs `acknowledgeFinance`; its public key is committed into the covenant state.
- Billing Policy Lead authorization identity: signs `acknowledgeBilling`; its public key is committed into the covenant state.
- Relic attestor identity: required only for `supersede`; its public key is still committed into the initial state because the contract has a `relicAttestor` field.

No identity was created during this preflight.

### 5. Public values that may be committed

The following may be committed once generated from non-secret sources:

- Role public keys.
- Testnet addresses.
- Contract artifact and artifact digest.
- Commitment id.
- Evidence digest.
- Source commitment id.
- Covenant id.
- Transaction ids after broadcast.
- Output indices.
- Accepted-transaction proofs.
- Public redeem-script preimages needed for covenant inspection.
- Non-secret network and toolchain metadata.

### 6. Values that must never be committed

Never commit:

- Seed phrases.
- Private keys.
- Signing material.
- Wallet secrets.
- Payment secrets.
- Wallet backups or wallet database files.
- Local `.env` files containing secrets.
- Faucet authorization secrets or API tokens.
- Unsanitized logs containing private key, seed, wallet, or signing payload material.

### 7. Exact transaction sequence

The minimum proof sequence is:

1. Genesis covenant UTXO creation: creates the `AWAITING_ACKNOWLEDGEMENTS` covenant state.
2. Finance acknowledgement successor transaction: advances to `FINANCE_ACKNOWLEDGED`.
3. Billing acknowledgement successor transaction: advances to `REMEDIATION_REQUIRED`.

The original blocked commitment is never mutated into `RELEASE_READY`. If a clean follow-up proof is needed, it should be a separate commitment and the original blocked record may later be superseded with the `supersede` entrypoint.

### 8. Transaction requirements

Genesis commitment transaction:

- Input type: ordinary funded Testnet 12 UTXO controlled by the deployment/funding identity.
- Output type: Transaction V1 covenant output whose script public key commits to the Silverscript redeem script for the initial state.
- Required successor covenant state: `status = 0`, `financeAcknowledged = false`, `billingAcknowledged = false`.
- Required signatures: deployment/funding identity signs the funding input.
- Required Transaction V1 fields: input, output, output covenant binding, value, script public key, lock time/subnetwork/gas/payload/mass as required by SDK defaults, and any compute-budget value required for the input script path.
- Compute budget requirement: budget must cover executed script units. The script-pricing guide defines compute budget as the explicit Transaction V1 resource meter; builders should estimate or compute the required units and avoid over-budgeting because higher budget can increase mass/fees.
- Covenant binding requirement: genesis output must carry a covenant binding whose covenant id is derived from the authorizing input outpoint and authorized output set according to the official covenant-id rules.
- Fee requirement: funded input value must cover covenant output value, change, mass, and fees.
- Expected proof after broadcast: accepted genesis txid, output index, covenant id, covenant UTXO value, script public key, initial redeem-script preimage, and accepted-transaction record.

Finance acknowledgement successor transaction:

- Input type: the genesis covenant UTXO.
- Output type: Transaction V1 successor covenant output with the same covenant id.
- Required successor covenant state: `status = 1`, `financeAcknowledged = true`, `billingAcknowledged = false`, with commitment id, evidence digest, source commitment id, and role public keys preserved.
- Required signatures: Finance Systems Owner signature for the covenant entrypoint, plus funding/change signatures if a separate fee input is used.
- Required Transaction V1 fields: covenant input with compute budget, signature script revealing the previous redeem script and `financeSignature`, successor output with covenant binding, value, script public key, fees, and any change output.
- Compute budget requirement: must cover the covenant script path and signature verification attempt.
- Covenant binding requirement: successor output must point back to the authorizing covenant input and preserve the covenant id.
- Fee requirement: must cover mass and compute budget impact without draining the covenant UTXO below the intended continuation value.
- Expected proof after broadcast: finance txid, spent genesis outpoint, successor outpoint, same covenant id, and accepted transaction showing the status-1 state transition.

Billing acknowledgement successor transaction:

- Input type: the finance successor covenant UTXO.
- Output type: Transaction V1 successor covenant output with the same covenant id.
- Required successor covenant state: `status = 2`, `financeAcknowledged = true`, `billingAcknowledged = true`, with commitment id, evidence digest, source commitment id, and role public keys preserved.
- Required signatures: Billing Policy Lead signature for the covenant entrypoint, plus funding/change signatures if a separate fee input is used.
- Required Transaction V1 fields: covenant input with compute budget, signature script revealing the previous redeem script and `billingSignature`, successor output with covenant binding, value, script public key, fees, and any change output.
- Compute budget requirement: must cover the covenant script path and signature verification attempt.
- Covenant binding requirement: successor output must point back to the authorizing covenant input and preserve the covenant id.
- Fee requirement: must cover mass and compute budget impact while preserving the final evidence UTXO value.
- Expected proof after broadcast: billing txid, spent finance outpoint, final blocked commitment UTXO, same covenant id, and accepted transaction showing `REMEDIATION_REQUIRED`.

Optional supersede transaction:

- Input type: the remediation-required covenant UTXO.
- Output type: Transaction V1 successor covenant output with the same covenant id.
- Required successor state: `status = 3`, both acknowledgement flags true, original `commitmentId` and `evidenceDigest` preserved, and `sourceCommitmentId` set to a distinct clean commitment id.
- Required signatures: Relic attestor signature, plus any funding/change signatures if a separate fee input is used.
- Purpose: record that a separate clean commitment supersedes the blocked record. This is not a release-ready mutation of the blocked commitment.

### 9. Testnet funding source

No official Testnet 12 faucet route was confirmed in the checked official docs during this preflight. Do not request funds as part of this repository workflow.

Before deployment, a developer should identify the current official Testnet 12 funding route from current Kaspa project channels or use already available test-only funds. Any faucet route, if found, should remain outside committed source unless it is a non-secret public documentation link.

### 10. Explorer or inspection mechanism

The official accepted-transaction guide provides the reliable inspection path:

- Use `getVirtualChainFromBlockV2` with appropriate confirmation and high data verbosity to inspect accepted transactions and fields.
- Use `getVirtualChainFromBlock` and `subscribeVirtualChainChanged(true)` to follow accepted transaction ids.
- Handle reorgs with a confirmation buffer.

For covenant lineage and current UTXO state, maintain an index of:

- covenant id
- creating transaction
- live covenant UTXO
- spent predecessor UTXOs
- successor outputs
- redeem-script preimages
- constructor and transition arguments

No official covenant-aware Testnet 12 explorer URL was confirmed in the checked docs. A self-hosted indexed node plus RPC inspection is the reproducible path.

### 11. Safely automatable steps without secrets

Safe automation can include:

- Compile the Silverscript source.
- Verify artifact structure and ABI.
- Validate constructor argument shape and byte lengths.
- Replace fixture values from public inputs only.
- Compute public artifact digests.
- Build unsigned transaction plans.
- Estimate script-unit and compute-budget requirements without signing.
- Verify that no `RELEASE_READY` entrypoint exists.
- Verify accepted transactions by txid after a human-controlled broadcast.
- Generate sanitized evidence reports for Relic UI and hackathon submission.

### 12. Manually controlled steps

The developer must manually control:

- Wallet creation or wallet opening.
- Seed phrase/private key generation and storage.
- Testnet address generation.
- Faucet requests or funding transfers.
- Signature creation.
- Fee approval.
- Transaction broadcast.
- Final deployment approval.
- Any supersede decision that links this blocked commitment to a separate clean commitment.

## Proposed Deployment Plan

Do not execute any phase from this repository preflight.

1. Phase 0 - Pre-flight validation: READ-ONLY, MANUAL REVIEW REQUIRED
   - Re-run `npm run kaspa:compile` and `npm run kaspa:verify`.
   - Confirm artifact contract name, compiler version, ABI entrypoints, state layout, and absence of `RELEASE_READY`.
   - Confirm current official Transaction V1 and covenant-binding rules against official docs and `rusty-kaspa` source.

2. Phase 1 - Test-only identities and public keys: LOCAL SECRET-HANDLING, MANUAL REVIEW REQUIRED
   - Create or select test-only deployment/funding, Finance Systems Owner, Billing Policy Lead, and Relic attestor identities outside source control.
   - Capture only public keys and testnet addresses for fixture replacement.
   - Keep seed phrases, wallet secrets, payment secrets, private keys, and backups outside the repository.

3. Phase 2 - Fixture replacement: READ-ONLY, MANUAL REVIEW REQUIRED
   - Replace deterministic constructor fixtures with public deployment values.
   - Recompile the artifact and verify the public state fields.
   - Review the generated artifact, digest, constructor args, and no-secret diff before any broadcast.

4. Phase 3 - Genesis commitment transaction: TESTNET BROADCAST, LOCAL SECRET-HANDLING, MANUAL REVIEW REQUIRED
   - Build a Transaction V1 genesis covenant transaction from a funded Testnet 12 UTXO.
   - Attach the genesis covenant binding and initial `AWAITING_ACKNOWLEDGEMENTS` state.
   - Sign only in a local developer-controlled wallet environment.
   - Broadcast only after manual review.
   - Capture accepted txid, output index, covenant id, and UTXO evidence.

5. Phase 4 - Finance acknowledgement transaction: TESTNET BROADCAST, LOCAL SECRET-HANDLING, MANUAL REVIEW REQUIRED
   - Spend the genesis covenant UTXO through `acknowledgeFinance`.
   - Provide a Finance Systems Owner signature.
   - Create the successor covenant output with `FINANCE_ACKNOWLEDGED` state.
   - Capture accepted txid, successor outpoint, same covenant id, and state evidence.

6. Phase 5 - Billing acknowledgement transaction: TESTNET BROADCAST, LOCAL SECRET-HANDLING, MANUAL REVIEW REQUIRED
   - Spend the finance successor UTXO through `acknowledgeBilling`.
   - Provide a Billing Policy Lead signature.
   - Create the successor covenant output with `REMEDIATION_REQUIRED` state.
   - Capture accepted txid, successor outpoint, same covenant id, and state evidence.

7. Phase 6 - Evidence capture for Relic UI and hackathon submission: READ-ONLY, MANUAL REVIEW REQUIRED
   - Inspect accepted transactions through RPC or a verified indexed node.
   - Produce a sanitized public evidence package containing artifact digest, covenant id, transaction ids, output indices, accepted-transaction records, and state summaries.
   - Confirm again that the original blocked commitment was not mutated into `RELEASE_READY`.
