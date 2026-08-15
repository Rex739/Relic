import { asc, eq } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import { agentIdentities, reconciliationRecords } from "./schema.js";

export interface ReconciliationWrite {
  fieldPath: string;
  status:
    | "match"
    | "mismatch"
    | "unavailable_direct"
    | "unavailable_secondary"
    | "stale_secondary"
    | "unverified_secondary";
  directValue: unknown;
  secondaryValue: unknown;
}

export class DrizzleReconciliationStore {
  constructor(private readonly database: RelicDatabase) {}

  async candidates(chainId: number, limit: number) {
    return this.database
      .select({
        internalId: agentIdentities.agentId,
        externalAgentId: agentIdentities.externalAgentId,
      })
      .from(agentIdentities)
      .where(eq(agentIdentities.chainId, chainId))
      .orderBy(asc(agentIdentities.externalAgentId))
      .limit(limit);
  }

  async save(
    internalId: string,
    facts: readonly ReconciliationWrite[],
    secondaryObservedAt?: Date,
  ) {
    if (facts.length === 0) return;
    await this.database.insert(reconciliationRecords).values(
      facts.map((fact) => ({
        agentId: internalId,
        fieldPath: fact.fieldPath,
        status: fact.status,
        directValue: fact.directValue,
        secondaryValue: fact.secondaryValue,
        secondaryProvider: "8004scan",
        secondaryObservedAt,
      })),
    );
  }
}
