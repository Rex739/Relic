import type {
  CanonicalAgent,
  Evidence,
  RegistryAgentRecord,
} from "@relic/domain";
import { and, eq, ne, sql } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  agentIdentities,
  agents,
  agentServices,
  agentTaxonomy,
  availabilityObservations,
  factEvidence,
  ingestionRecords,
  metadataHistory,
  ownershipHistory,
  performanceMetrics,
  reputationSignals,
  taxonomyTerms,
} from "./schema.js";

interface EvidenceRow {
  agentId: string;
  subjectType: string;
  subjectId?: string;
  fieldPath: string;
  provenance: Evidence["provenance"];
  source: string;
  sourceUri?: string;
  observedAt: Date;
  chainId?: number;
  transactionHash?: string;
  blockNumber?: bigint;
  contentHash?: string;
  details?: Record<string, unknown>;
}

const fallbackMetadataHash = (status: string, uri: string) =>
  createHash("sha256").update(`${status}:${uri}`).digest("hex");

function evidenceRows(
  agentId: string,
  subjectType: string,
  fieldPath: string,
  evidence: readonly Evidence[],
  subjectId?: string,
): EvidenceRow[] {
  return evidence.map((item) => ({
    agentId,
    subjectType,
    ...(subjectId === undefined ? {} : { subjectId }),
    fieldPath,
    provenance: item.provenance,
    source: item.source,
    ...(item.sourceUri === undefined ? {} : { sourceUri: item.sourceUri }),
    observedAt: new Date(item.observedAt),
    ...(item.chainId === undefined ? {} : { chainId: item.chainId }),
    ...(item.transactionHash === undefined
      ? {}
      : { transactionHash: item.transactionHash }),
    ...(item.blockNumber === undefined
      ? {}
      : { blockNumber: BigInt(item.blockNumber) }),
    ...(item.contentHash === undefined
      ? {}
      : { contentHash: item.contentHash }),
    ...(item.details === undefined ? {} : { details: item.details }),
  }));
}

export class DrizzleAgentWriter {
  public constructor(private readonly database: RelicDatabase) {}

  public async persist(
    agent: CanonicalAgent,
    raw: RegistryAgentRecord,
  ): Promise<string> {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction
        .select({ agentId: agentIdentities.agentId })
        .from(agentIdentities)
        .where(
          and(
            eq(agentIdentities.namespace, agent.identity.namespace),
            eq(agentIdentities.chainId, agent.identity.chainId),
            sql`lower(${agentIdentities.registryAddress}) = lower(${agent.identity.registryAddress})`,
            eq(agentIdentities.externalAgentId, agent.identity.agentId),
          ),
        )
        .limit(1);
      const internalId = existing[0]?.agentId ?? agent.id;
      const now = new Date(agent.updatedAt);

      await transaction
        .insert(agents)
        .values({
          id: internalId,
          name: agent.profile.name?.value ?? null,
          description: agent.profile.description?.value ?? null,
          imageUrl: agent.profile.imageUrl?.value ?? null,
          websiteUrl: agent.profile.websiteUrl?.value ?? null,
          metadataUri: agent.profile.metadataUri.value,
          developerIdentity: agent.profile.developerIdentity?.value ?? null,
          createdAt: new Date(agent.createdAt),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: agents.id,
          set: {
            name: agent.profile.name?.value ?? null,
            description: agent.profile.description?.value ?? null,
            imageUrl: agent.profile.imageUrl?.value ?? null,
            websiteUrl: agent.profile.websiteUrl?.value ?? null,
            metadataUri: agent.profile.metadataUri.value,
            developerIdentity: agent.profile.developerIdentity?.value ?? null,
            updatedAt: now,
          },
        });

      const identityValues = {
        agentId: internalId,
        standard: agent.identity.standard,
        namespace: agent.identity.namespace,
        chainId: agent.identity.chainId,
        registryAddress: agent.identity.registryAddress,
        externalAgentId: agent.identity.agentId,
        ownerAddress: agent.identity.ownerAddress,
        registrationStatus: agent.identity.registrationStatus,
        registrationTransaction: agent.identity.registrationTransaction,
        registrationBlock:
          agent.identity.registrationBlock === null
            ? null
            : BigInt(agent.identity.registrationBlock),
        registeredAt:
          agent.identity.registeredAt === null
            ? null
            : new Date(agent.identity.registeredAt),
        updatedAt: now,
      };
      if (existing[0] === undefined)
        await transaction.insert(agentIdentities).values(identityValues);
      else
        await transaction
          .update(agentIdentities)
          .set({
            ownerAddress: agent.identity.ownerAddress,
            registrationStatus: agent.identity.registrationStatus,
            registrationTransaction: sql`coalesce(${agent.identity.registrationTransaction}, ${agentIdentities.registrationTransaction})`,
            registrationBlock: sql`coalesce(${agent.identity.registrationBlock === null ? null : BigInt(agent.identity.registrationBlock)}, ${agentIdentities.registrationBlock})`,
            registeredAt: sql`coalesce(${agent.identity.registeredAt === null ? null : new Date(agent.identity.registeredAt)}, ${agentIdentities.registeredAt})`,
            updatedAt: now,
          })
          .where(eq(agentIdentities.agentId, internalId));

      await Promise.all([
        transaction
          .delete(agentTaxonomy)
          .where(eq(agentTaxonomy.agentId, internalId)),
        transaction
          .delete(agentServices)
          .where(eq(agentServices.agentId, internalId)),
        transaction
          .delete(performanceMetrics)
          .where(eq(performanceMetrics.agentId, internalId)),
        transaction
          .delete(reputationSignals)
          .where(eq(reputationSignals.agentId, internalId)),
        transaction
          .delete(availabilityObservations)
          .where(eq(availabilityObservations.agentId, internalId)),
        transaction
          .delete(factEvidence)
          .where(
            and(
              eq(factEvidence.agentId, internalId),
              ne(factEvidence.provenance, "secondary_unverified"),
            ),
          ),
      ]);

      const evidence: EvidenceRow[] = [];
      for (const [field, fieldEvidence] of Object.entries(
        agent.identity.fieldEvidence,
      )) {
        evidence.push(
          ...evidenceRows(
            internalId,
            "identity",
            `identity.${field}`,
            fieldEvidence,
          ),
        );
      }
      for (const [field, sourced] of Object.entries(agent.profile)) {
        if (sourced !== null) {
          evidence.push(
            ...evidenceRows(
              internalId,
              "profile",
              `profile.${field}`,
              sourced.evidence,
            ),
          );
        }
      }

      for (const assignment of agent.taxonomy) {
        const [term] = await transaction
          .insert(taxonomyTerms)
          .values({
            kind: assignment.kind,
            slug: assignment.slug,
            label: assignment.label,
          })
          .onConflictDoUpdate({
            target: [taxonomyTerms.kind, taxonomyTerms.slug],
            set: { label: assignment.label, updatedAt: now },
          })
          .returning({ id: taxonomyTerms.id });
        if (term === undefined)
          throw new Error("Taxonomy upsert did not return an identifier");
        await transaction
          .insert(agentTaxonomy)
          .values({ agentId: internalId, termId: term.id });
        evidence.push(
          ...evidenceRows(
            internalId,
            "taxonomy",
            `taxonomy.${assignment.kind}.${assignment.slug}`,
            assignment.evidence,
            term.id,
          ),
        );
      }

      for (const service of agent.services) {
        const [row] = await transaction
          .insert(agentServices)
          .values({
            agentId: internalId,
            externalId: service.externalId,
            name: service.name,
            capability: service.capability,
            description: service.description,
            inputSchema: service.inputSchema,
            outputSchema: service.outputSchema,
            pricing: service.pricing,
            endpoint: service.endpoint,
            sla: service.sla,
            status: service.availabilityStatus,
          })
          .returning({ id: agentServices.id });
        if (row === undefined)
          throw new Error("Service insert did not return an identifier");
        evidence.push(
          ...evidenceRows(
            internalId,
            "service",
            "service",
            service.evidence,
            row.id,
          ),
        );
      }

      for (const metric of agent.metrics) {
        const [row] = await transaction
          .insert(performanceMetrics)
          .values({
            agentId: internalId,
            key: metric.key,
            value: metric.value,
            unit: metric.unit,
            window: metric.window,
            measuredAt: new Date(metric.measuredAt),
          })
          .returning({ id: performanceMetrics.id });
        if (row === undefined)
          throw new Error("Metric insert did not return an identifier");
        evidence.push(
          ...evidenceRows(
            internalId,
            "performance_metric",
            `metrics.${metric.key}`,
            metric.evidence,
            row.id,
          ),
        );
      }

      for (const signal of agent.reputation) {
        const [row] = await transaction
          .insert(reputationSignals)
          .values({
            agentId: internalId,
            kind: signal.kind,
            value: signal.value,
            scale: signal.scale,
            recordedAt: new Date(signal.recordedAt),
          })
          .returning({ id: reputationSignals.id });
        if (row === undefined)
          throw new Error("Reputation insert did not return an identifier");
        evidence.push(
          ...evidenceRows(
            internalId,
            "reputation_signal",
            `reputation.${signal.kind}`,
            signal.evidence,
            row.id,
          ),
        );
      }

      for (const observation of agent.availability) {
        const [row] = await transaction
          .insert(availabilityObservations)
          .values({
            agentId: internalId,
            status: observation.status,
            heartbeatAt:
              observation.heartbeatAt === null
                ? null
                : new Date(observation.heartbeatAt),
            lastSuccessfulContactAt:
              observation.lastSuccessfulContactAt === null
                ? null
                : new Date(observation.lastSuccessfulContactAt),
            latencyMs: observation.latencyMs,
            uptimeRatio: observation.uptimeRatio,
            observedAt: new Date(observation.observedAt),
          })
          .returning({ id: availabilityObservations.id });
        if (row === undefined)
          throw new Error("Availability insert did not return an identifier");
        evidence.push(
          ...evidenceRows(
            internalId,
            "availability",
            "availability",
            observation.evidence,
            row.id,
          ),
        );
      }

      if (evidence.length > 0)
        await transaction.insert(factEvidence).values(evidence);
      const rawContainer =
        raw.raw !== null && typeof raw.raw === "object"
          ? (raw.raw as Record<string, unknown>)
          : {};
      const indexEvent =
        rawContainer.indexEvent !== null &&
        typeof rawContainer.indexEvent === "object"
          ? (rawContainer.indexEvent as Record<string, unknown>)
          : null;
      const scalarString = (value: unknown): string | null =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
          ? String(value)
          : null;
      const eventBlockNumber = scalarString(indexEvent?.blockNumber);
      const eventBlockHash = scalarString(indexEvent?.blockHash);
      const eventTransactionHash = scalarString(indexEvent?.transactionHash);
      const observedBlock =
        eventBlockNumber === null
          ? raw.registrationBlock === null
            ? null
            : BigInt(raw.registrationBlock)
          : BigInt(eventBlockNumber);
      await transaction
        .insert(metadataHistory)
        .values({
          agentId: internalId,
          metadataUri: raw.metadataUri,
          contentHash:
            raw.metadataResolution?.contentHash ??
            fallbackMetadataHash(
              raw.metadataResolution?.status ?? "unverified",
              raw.metadataUri,
            ),
          payload: raw.metadata,
          resolutionStatus: raw.metadataResolution?.status ?? "unverified",
          error:
            raw.metadataResolution?.error === undefined
              ? null
              : { message: raw.metadataResolution.error },
          observedBlock,
          observedBlockHash: eventBlockHash,
          transactionHash: eventTransactionHash ?? raw.registrationTransaction,
          observedAt: new Date(raw.fetchedAt),
        })
        .onConflictDoNothing();
      if (
        indexEvent !== null &&
        (indexEvent.eventName === "Transfer" ||
          indexEvent.eventName === "Registered") &&
        eventBlockNumber !== null &&
        eventBlockHash !== null &&
        eventTransactionHash !== null &&
        indexEvent.logIndex !== undefined
      ) {
        const payload =
          indexEvent.payload !== null && typeof indexEvent.payload === "object"
            ? (indexEvent.payload as Record<string, unknown>)
            : {};
        await transaction
          .insert(ownershipHistory)
          .values({
            agentId: internalId,
            previousOwner: scalarString(payload.from),
            ownerAddress: raw.ownerAddress,
            blockNumber: BigInt(eventBlockNumber),
            blockHash: eventBlockHash,
            transactionHash: eventTransactionHash,
            logIndex: Number(indexEvent.logIndex),
          })
          .onConflictDoNothing();
      }
      await transaction.insert(ingestionRecords).values({
        provider: raw.source,
        sourceKey: `${raw.chainId}:${raw.registryAddress}:${raw.agentId}`,
        fetchedAt: new Date(raw.fetchedAt),
        payload: JSON.parse(
          JSON.stringify(raw.raw, (_key, value: unknown) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        ) as unknown,
        status: "succeeded",
        normalizedAgentId: internalId,
      });
      return internalId;
    });
  }

  public async recordFailure(
    raw: RegistryAgentRecord,
    error: { message: string; issues?: readonly string[] },
  ): Promise<void> {
    await this.database.insert(ingestionRecords).values({
      provider: raw.source,
      sourceKey: `${raw.chainId}:${raw.registryAddress}:${raw.agentId}`,
      fetchedAt: new Date(raw.fetchedAt),
      payload: raw.raw,
      status: "failed",
      error: { message: error.message, issues: error.issues ?? [] },
    });
  }
}
import { createHash } from "node:crypto";
