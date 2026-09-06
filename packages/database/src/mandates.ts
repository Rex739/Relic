import type {
  Mandate,
  MandateConfiguration,
  MandateEvidenceBinding,
  MandateEvent,
  MandateEventType,
  MandateListItem,
  MandatePersistence,
  MandateStatus,
  VerifiedMandateProfile,
} from "@relic/domain";
import { nextExpectedMandateAction } from "@relic/domain";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  agents,
  mandateEvents,
  mandateEvidenceBindings,
  mandates,
  mandateVersions,
} from "./schema.js";

type MandateRow = typeof mandates.$inferSelect;
type VersionRow = typeof mandateVersions.$inferSelect;
type EvidenceRow = typeof mandateEvidenceBindings.$inferSelect;

const asRecord = (value: unknown) => (value ?? {}) as Record<string, unknown>;
const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [];

export class DrizzleMandateStore implements MandatePersistence {
  public constructor(private readonly database: RelicDatabase) {}

  public async createMandate(input: {
    principalId: string;
    principalType: Mandate["principalType"];
    profile: VerifiedMandateProfile;
    configuration: MandateConfiguration;
    evidence: MandateEvidenceBinding;
  }) {
    const id = await this.database.transaction(async (transaction) => {
      const [mandate] = await transaction
        .insert(mandates)
        .values({
          principalId: input.principalId,
          principalType: input.principalType,
          agentId: input.profile.agentId,
          chainId: input.profile.chainId,
          status: "DRAFT",
          authorizationBoundary: "POLICY_ONLY",
          currentVersion: 1,
        })
        .returning({ id: mandates.id });
      if (mandate === undefined) throw new Error("Mandate insert failed");
      const versionId = await this.#insertVersion(transaction, {
        mandateId: mandate.id,
        version: 1,
        profile: input.profile,
        configuration: input.configuration,
        evidence: input.evidence,
      });
      await transaction.insert(mandateEvents).values({
        mandateId: mandate.id,
        mandateVersionId: versionId,
        eventType: "MANDATE_CREATED",
        securitySensitive: true,
        details: { authorizationBoundary: "POLICY_ONLY" },
        evidenceReferences: {
          agentId: input.evidence.agentId,
          serviceId: input.evidence.serviceId,
          verificationTimestamp: input.evidence.verificationTimestamp,
        },
      });
      return mandate.id;
    });
    const created = await this.findMandate(id, input.principalId);
    if (created === null) throw new Error("Created mandate was not readable");
    return created;
  }

  public async findMandate(id: string, principalId: string) {
    const [row] = await this.database
      .select({ mandate: mandates, version: mandateVersions })
      .from(mandates)
      .innerJoin(
        mandateVersions,
        and(
          eq(mandateVersions.mandateId, mandates.id),
          eq(mandateVersions.version, mandates.currentVersion),
        ),
      )
      .where(and(eq(mandates.id, id), eq(mandates.principalId, principalId)))
      .limit(1);
    if (row === undefined) return null;
    const [evidence, events] = await Promise.all([
      this.database
        .select()
        .from(mandateEvidenceBindings)
        .where(eq(mandateEvidenceBindings.mandateVersionId, row.version.id))
        .limit(1),
      this.database
        .select()
        .from(mandateEvents)
        .where(eq(mandateEvents.mandateId, id))
        .orderBy(desc(mandateEvents.occurredAt), desc(mandateEvents.id)),
    ]);
    if (evidence[0] === undefined)
      throw new Error(`Mandate ${id} has no evidence binding`);
    return this.#mandate(row.mandate, row.version, evidence[0], events);
  }

  public async listMandates(principalId: string): Promise<MandateListItem[]> {
    const rows = await this.database
      .select({ id: mandates.id, name: agents.name })
      .from(mandates)
      .innerJoin(agents, eq(agents.id, mandates.agentId))
      .where(eq(mandates.principalId, principalId))
      .orderBy(desc(mandates.updatedAt));
    const results = await Promise.all(
      rows.map(async (row) => ({
        name: row.name ?? "Unnamed agent",
        mandate: await this.findMandate(row.id, principalId),
      })),
    );
    return results.flatMap(({ name, mandate }) =>
      mandate === null
        ? []
        : [
            {
              mandate,
              agent: {
                id: mandate.agentId,
                name,
                network:
                  mandate.chainId === 56
                    ? ("BNB Chain" as const)
                    : ("BNB Chain Testnet" as const),
                tier: "Actionable" as const,
              },
              lastActivityAt:
                mandate.events[0]?.occurredAt ?? mandate.updatedAt,
              nextExpectedAction: nextExpectedMandateAction(mandate),
            },
          ],
    );
  }

  public async transitionMandate(input: {
    id: string;
    principalId: string;
    from: MandateStatus[];
    to: MandateStatus;
    event: MandateEvent["type"];
    securitySensitive: boolean;
    details?: Record<string, unknown>;
    evidenceReferences?: Record<string, unknown>;
    activateCurrentVersion?: boolean;
  }) {
    const changed = await this.database.transaction(async (transaction) => {
      const [mandate] = await transaction
        .select()
        .from(mandates)
        .where(
          and(
            eq(mandates.id, input.id),
            eq(mandates.principalId, input.principalId),
            inArray(mandates.status, input.from),
          ),
        )
        .limit(1);
      if (mandate === undefined) return false;
      const [version] = await transaction
        .select()
        .from(mandateVersions)
        .where(
          and(
            eq(mandateVersions.mandateId, mandate.id),
            eq(mandateVersions.version, mandate.currentVersion),
          ),
        )
        .limit(1);
      if (version === undefined)
        throw new Error("Current mandate version missing");
      if (input.activateCurrentVersion === true) {
        await transaction
          .update(mandateVersions)
          .set({ state: "SUPERSEDED", supersededAt: new Date() })
          .where(
            and(
              eq(mandateVersions.mandateId, mandate.id),
              eq(mandateVersions.state, "ACTIVE"),
            ),
          );
      }
      const versionDates =
        input.to === "REVIEWED"
          ? { approvedAt: new Date() }
          : input.to === "ACTIVE"
            ? { activatedAt: new Date() }
            : input.to === "SUPERSEDED"
              ? { supersededAt: new Date() }
              : {};
      await transaction
        .update(mandateVersions)
        .set({ state: input.to, ...versionDates })
        .where(eq(mandateVersions.id, version.id));
      await transaction
        .update(mandates)
        .set({
          status: input.to,
          attentionReason: null,
          ...(input.activateCurrentVersion === true
            ? { activeVersion: mandate.currentVersion }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(mandates.id, mandate.id));
      await transaction.insert(mandateEvents).values({
        mandateId: mandate.id,
        mandateVersionId: version.id,
        eventType: input.event,
        securitySensitive: input.securitySensitive,
        details: input.details ?? {},
        evidenceReferences: input.evidenceReferences ?? {},
      });
      return true;
    });
    return changed ? this.findMandate(input.id, input.principalId) : null;
  }

  public async createMandateVersion(input: {
    id: string;
    principalId: string;
    profile: VerifiedMandateProfile;
    configuration: MandateConfiguration;
    evidence: MandateEvidenceBinding;
  }) {
    const changed = await this.database.transaction(async (transaction) => {
      const [mandate] = await transaction
        .select()
        .from(mandates)
        .where(
          and(
            eq(mandates.id, input.id),
            eq(mandates.principalId, input.principalId),
            inArray(mandates.status, ["ACTIVE", "PAUSED", "REVIEWED"]),
          ),
        )
        .limit(1);
      if (mandate === undefined) return false;
      const nextVersion = mandate.currentVersion + 1;
      await transaction
        .update(mandateVersions)
        .set({ state: "SUPERSEDED", supersededAt: new Date() })
        .where(
          and(
            eq(mandateVersions.mandateId, mandate.id),
            eq(mandateVersions.version, mandate.currentVersion),
          ),
        );
      const versionId = await this.#insertVersion(transaction, {
        mandateId: mandate.id,
        version: nextVersion,
        profile: input.profile,
        configuration: input.configuration,
        evidence: input.evidence,
      });
      await transaction
        .update(mandates)
        .set({
          status: "DRAFT",
          currentVersion: nextVersion,
          activeVersion: null,
          attentionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(mandates.id, mandate.id));
      await transaction.insert(mandateEvents).values({
        mandateId: mandate.id,
        mandateVersionId: versionId,
        eventType: "MANDATE_MODIFIED",
        securitySensitive: true,
        details: {
          previousVersion: mandate.currentVersion,
          newVersion: nextVersion,
          requiresExplicitReapproval: true,
        },
        evidenceReferences: {
          agentId: input.evidence.agentId,
          serviceId: input.evidence.serviceId,
          verificationTimestamp: input.evidence.verificationTimestamp,
        },
      });
      return true;
    });
    return changed ? this.findMandate(input.id, input.principalId) : null;
  }

  public async markAttentionRequired(input: {
    id: string;
    principalId: string;
    reason: string;
  }) {
    const changed = await this.database.transaction(async (transaction) => {
      const [mandate] = await transaction
        .select()
        .from(mandates)
        .where(
          and(
            eq(mandates.id, input.id),
            eq(mandates.principalId, input.principalId),
          ),
        )
        .limit(1);
      if (mandate === undefined) return false;
      if (
        mandate.attentionReason === input.reason &&
        mandate.status !== "ACTIVE"
      )
        return true;
      const nextStatus =
        mandate.status === "ACTIVE" ? "PAUSED" : mandate.status;
      await transaction
        .update(mandates)
        .set({
          status: nextStatus,
          attentionReason: input.reason,
          updatedAt: new Date(),
        })
        .where(eq(mandates.id, mandate.id));
      if (mandate.status === "ACTIVE")
        await transaction
          .update(mandateVersions)
          .set({ state: "PAUSED" })
          .where(
            and(
              eq(mandateVersions.mandateId, mandate.id),
              eq(mandateVersions.version, mandate.currentVersion),
            ),
          );
      await transaction.insert(mandateEvents).values({
        mandateId: mandate.id,
        eventType: "MANDATE_ATTENTION_REQUIRED",
        securitySensitive: true,
        details: { reason: input.reason, executionBlocked: true },
        evidenceReferences: {},
      });
      return true;
    });
    return changed ? this.findMandate(input.id, input.principalId) : null;
  }

  public async setAuthorizationBoundary(input: {
    id: string;
    principalId: string;
    boundary: "POLICY_ONLY" | "WALLET_AUTHORIZED";
    event: MandateEventType;
    details?: Record<string, unknown>;
  }) {
    const changed = await this.database.transaction(async (transaction) => {
      const [mandate] = await transaction
        .select({ id: mandates.id, currentVersion: mandates.currentVersion })
        .from(mandates)
        .where(
          and(
            eq(mandates.id, input.id),
            eq(mandates.principalId, input.principalId),
          ),
        )
        .limit(1);
      if (mandate === undefined) return false;
      await transaction
        .update(mandates)
        .set({ authorizationBoundary: input.boundary, updatedAt: new Date() })
        .where(eq(mandates.id, mandate.id));
      const [version] = await transaction
        .select({ id: mandateVersions.id })
        .from(mandateVersions)
        .where(
          and(
            eq(mandateVersions.mandateId, mandate.id),
            eq(mandateVersions.version, mandate.currentVersion),
          ),
        )
        .limit(1);
      await transaction.insert(mandateEvents).values({
        mandateId: mandate.id,
        mandateVersionId: version?.id ?? null,
        eventType: input.event,
        securitySensitive: true,
        details: input.details ?? { authorizationBoundary: input.boundary },
        evidenceReferences: {},
      });
      return true;
    });
    return changed ? this.findMandate(input.id, input.principalId) : null;
  }

  async #insertVersion(
    transaction: Parameters<Parameters<RelicDatabase["transaction"]>[0]>[0],
    input: {
      mandateId: string;
      version: number;
      profile: VerifiedMandateProfile;
      configuration: MandateConfiguration;
      evidence: MandateEvidenceBinding;
    },
  ) {
    const [version] = await transaction
      .insert(mandateVersions)
      .values({
        mandateId: input.mandateId,
        version: input.version,
        state: "DRAFT",
        serviceId: input.profile.serviceId,
        objective: input.configuration.objective,
        allowedCapabilities: input.configuration.allowedCapabilities,
        deniedCapabilities: input.configuration.deniedCapabilities,
        allowedAssets: input.configuration.allowedAssets,
        allowedProtocols: input.configuration.allowedProtocols,
        allowedContracts: input.configuration.allowedContracts,
        perActionLimit: input.configuration.perActionLimit,
        aggregateLimit: input.configuration.aggregateLimit,
        executionFrequency: input.configuration.executionFrequency,
        startAt: new Date(input.configuration.startAt),
        expiresAt: new Date(input.configuration.expiresAt),
        approvalMode: input.configuration.approvalMode,
        riskConstraints: input.configuration.riskConstraints,
        stopConditions: input.configuration.stopConditions,
      })
      .returning({ id: mandateVersions.id });
    if (version === undefined) throw new Error("Mandate version insert failed");
    await transaction.insert(mandateEvidenceBindings).values({
      mandateVersionId: version.id,
      agentId: input.evidence.agentId,
      externalAgentId: input.evidence.externalAgentId,
      registryAddress: input.evidence.registryAddress,
      serviceId: input.evidence.serviceId,
      serviceEndpoint: input.evidence.serviceEndpoint,
      verificationTier: input.evidence.verificationTier,
      verificationTimestamp: new Date(input.evidence.verificationTimestamp),
      chainId: input.evidence.chainId,
      capabilitySet: input.evidence.capabilitySet,
      evidenceSnapshot: input.evidence.evidenceSnapshot,
    });
    return version.id;
  }

  #mandate(
    mandate: MandateRow,
    version: VersionRow,
    evidence: EvidenceRow,
    events: Array<typeof mandateEvents.$inferSelect>,
  ): Mandate {
    if (mandate.chainId !== 56 && mandate.chainId !== 97)
      throw new Error(`Unsupported mandate chain ${mandate.chainId}`);
    return {
      id: mandate.id,
      principalId: mandate.principalId,
      principalType: mandate.principalType,
      agentId: mandate.agentId,
      chainId: mandate.chainId,
      status: mandate.status,
      authorizationBoundary: mandate.authorizationBoundary,
      currentVersion: mandate.currentVersion,
      activeVersion: mandate.activeVersion,
      attentionReason: mandate.attentionReason,
      createdAt: mandate.createdAt.toISOString(),
      updatedAt: mandate.updatedAt.toISOString(),
      version: {
        id: version.id,
        mandateId: version.mandateId,
        version: version.version,
        state: version.state,
        objective: version.objective,
        allowedCapabilities: asStringArray(version.allowedCapabilities),
        deniedCapabilities: asStringArray(version.deniedCapabilities),
        allowedAssets: asStringArray(version.allowedAssets),
        allowedProtocols: asStringArray(version.allowedProtocols),
        allowedContracts: asStringArray(version.allowedContracts),
        perActionLimit:
          version.perActionLimit as MandateConfiguration["perActionLimit"],
        aggregateLimit:
          version.aggregateLimit as MandateConfiguration["aggregateLimit"],
        executionFrequency:
          version.executionFrequency as MandateConfiguration["executionFrequency"],
        startAt: version.startAt.toISOString(),
        expiresAt: version.expiresAt.toISOString(),
        approvalMode: version.approvalMode,
        riskConstraints: asRecord(version.riskConstraints),
        stopConditions: Array.isArray(version.stopConditions)
          ? (version.stopConditions as Array<Record<string, unknown>>)
          : [],
        createdAt: version.createdAt.toISOString(),
        approvedAt: version.approvedAt?.toISOString() ?? null,
        activatedAt: version.activatedAt?.toISOString() ?? null,
        supersededAt: version.supersededAt?.toISOString() ?? null,
        evidence: {
          agentId: evidence.agentId,
          externalAgentId: evidence.externalAgentId,
          registryAddress: evidence.registryAddress,
          serviceId: evidence.serviceId,
          serviceEndpoint: evidence.serviceEndpoint,
          verificationTier: "Actionable",
          verificationTimestamp: evidence.verificationTimestamp.toISOString(),
          chainId: mandate.chainId,
          capabilitySet: asStringArray(evidence.capabilitySet),
          evidenceSnapshot: asRecord(evidence.evidenceSnapshot),
        },
      },
      events: events.map((event) => ({
        id: event.id,
        mandateId: event.mandateId,
        mandateVersionId: event.mandateVersionId,
        type: event.eventType as MandateEvent["type"],
        securitySensitive: event.securitySensitive,
        details: asRecord(event.details),
        evidenceReferences: asRecord(event.evidenceReferences),
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }
}
