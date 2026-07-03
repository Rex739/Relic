console.log(
  "Planning scaffold only. No wallet, keys, funds, or transaction actions were performed.",
);

throw new Error(
  "Planning scaffold only. This file intentionally does not execute deployment actions.",
);

/**
 * @typedef {Object} PublicRoleKeys
 * @property {string} financeOwnerPubkey
 * @property {string} billingPolicyLeadPubkey
 * @property {string} relicAttestorPubkey
 */

/**
 * @typedef {Object} PublicCommitmentInputs
 * @property {string} commitmentId32ByteHex
 * @property {string} evidenceDigest32ByteHex
 * @property {string} sourceCommitmentId32ByteHex
 * @property {PublicRoleKeys} roleKeys
 */

/**
 * @typedef {Object} PublicCovenantOutpoint
 * @property {string} transactionId
 * @property {number} outputIndex
 * @property {string} covenantId
 */

/**
 * @typedef {Object} UnsignedTransactionPlan
 * @property {"genesis" | "financeAcknowledgement" | "billingAcknowledgement"} phase
 * @property {PublicCommitmentInputs} publicInputs
 * @property {PublicCovenantOutpoint | null} predecessor
 * @property {string} expectedSuccessorState
 * @property {number | null} estimatedComputeBudget
 */

/**
 * This file is intentionally limited to public planning shapes for a future
 * deployer. It must not import wallet modules, create keys, request funds,
 * connect to RPC, sign, or broadcast.
 *
 * @type {ReadonlyArray<UnsignedTransactionPlan>}
 */
export const releaseCommitmentDeploymentPlan = Object.freeze([]);
