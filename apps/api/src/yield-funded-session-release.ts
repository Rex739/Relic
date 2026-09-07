import type { DrizzleCommerceStore } from "@relic/database";
import { AltanaSessionEncryption } from "./altana-session-encryption.js";
import { sealFundedSession } from "./funded-session-envelope.js";

/** Releases one bounded session only after Relic resolves its funded activation. */
export class YieldFundedSessionRelease {
  constructor(private readonly commerce: DrizzleCommerceStore, private readonly encryption: AltanaSessionEncryption, private readonly agentId: string, private readonly executorPublicKey: string) {}
  async release(jobId: string) {
    const row = await this.commerce.findFundedYieldSession(jobId);
    if (!row || row.mandate.agentId !== this.agentId) throw new Error("No funded active Yield Optimizer session is bound to this job");
    return {
      commerceJobId: jobId,
      mandateId: row.mandate.id,
      sessionAddress: row.session.sessionAddress,
      expiresAt: row.session.expiresAt.toISOString(),
      envelope: sealFundedSession(this.encryption.decrypt(row.session.encryptedSessionPrivateKey), this.executorPublicKey),
    };
  }
}
