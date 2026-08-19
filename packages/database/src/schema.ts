import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const provenanceKind = pgEnum("provenance_kind", [
  "onchain_verified",
  "independently_observed",
  "agent_reported",
  "developer_declared",
  "secondary_unverified",
]);
export const taxonomyKind = pgEnum("taxonomy_kind", [
  "category",
  "capability",
  "tag",
  "protocol",
  "asset",
  "chain",
]);
export const availabilityStatus = pgEnum("availability_status", [
  "unknown",
  "available",
  "degraded",
  "unavailable",
]);
export const ingestionStatus = pgEnum("ingestion_status", [
  "succeeded",
  "failed",
]);
export const indexerStatus = pgEnum("indexer_status", [
  "idle",
  "running",
  "succeeded",
  "failed",
]);
export const reconciliationStatus = pgEnum("reconciliation_status", [
  "match",
  "mismatch",
  "unavailable_direct",
  "unavailable_secondary",
  "stale_secondary",
  "unverified_secondary",
]);
export const corpusImportStatus = pgEnum("corpus_import_status", [
  "idle",
  "running",
  "succeeded",
  "partial",
  "failed",
]);
export const verificationStatus = pgEnum("verification_status", [
  "unverified",
  "pending",
  "verified",
  "partial",
  "failed",
  "stale",
]);
export const marketplaceReadiness = pgEnum("marketplace_readiness", [
  "NOT_READY",
  "PARTIAL",
  "DISCOVERABLE",
  "ACTIONABLE",
]);
export const endpointObservationStatus = pgEnum("endpoint_observation_status", [
  "reachable",
  "unreachable",
  "timeout",
  "invalid",
  "unsupported_protocol",
]);
export const launchCandidateStatus = pgEnum("launch_candidate_status", [
  "DISCOVERED",
  "REVIEW_PENDING",
  "IDENTITY_VERIFIED",
  "SERVICE_IDENTIFIED",
  "SERVICE_OBSERVED",
  "INVOCATION_VERIFIED",
  "ACTIONABLE",
  "REJECTED",
  "STALE",
]);
export const serviceVerificationLevel = pgEnum("service_verification_level", [
  "DECLARED",
  "ENDPOINT_OBSERVED",
  "SCHEMA_UNDERSTOOD",
  "PAYMENT_UNDERSTOOD",
  "INVOCATION_VERIFIED",
  "COMMERCE_VERIFIED",
]);
export const activationStatus = pgEnum("activation_status", [
  "PREPARED",
  "TERMS_RESOLVED",
  "JOB_CREATED",
  "FUNDED",
  "SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "FAILED",
  "BLOCKED",
]);
export const supplyType = pgEnum("supply_type", [
  "third_party",
  "partner",
  "relic_reference",
]);
export const submissionStatus = pgEnum("submission_status", [
  "SUBMITTED",
  "IDENTITY_CHECK",
  "METADATA_CHECK",
  "SERVICE_DISCOVERY",
  "SERVICE_VERIFICATION",
  "COMMERCE_PREFLIGHT",
  "ACTIONABLE",
  "BLOCKED",
  "REJECTED",
  "STALE",
]);
export const activationLifecycleState = pgEnum("activation_lifecycle_state", [
  "PREPARING",
  "NEGOTIATING",
  "AWAITING_AUTHORIZATION",
  "ONCHAIN_CREATED",
  "ACTIVE",
  "DELIVERED",
  "SETTLING",
  "COMPLETED",
  "REJECTED",
  "REFUNDED",
  "FAILED",
  "BLOCKED",
]);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    description: text("description"),
    imageUrl: text("image_url"),
    websiteUrl: text("website_url"),
    metadataUri: text("metadata_uri").notNull(),
    developerIdentity: text("developer_identity"),
    ...timestamps,
  },
  (table) => [
    index("agents_name_idx").on(table.name),
    index("agents_updated_at_idx").on(table.updatedAt),
  ],
);

export const agentIdentities = pgTable(
  "agent_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    standard: text("standard").notNull(),
    namespace: text("namespace").notNull(),
    chainId: integer("chain_id").notNull(),
    registryAddress: text("registry_address").notNull(),
    externalAgentId: text("external_agent_id").notNull(),
    ownerAddress: text("owner_address").notNull(),
    registrationStatus: text("registration_status").notNull(),
    registrationTransaction: text("registration_transaction"),
    registrationBlock: bigint("registration_block", { mode: "bigint" }),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("agent_identity_chain_unique").on(
      table.namespace,
      table.chainId,
      table.registryAddress,
      table.externalAgentId,
    ),
    uniqueIndex("agent_identity_agent_unique").on(table.agentId),
    index("agent_identity_owner_idx").on(table.chainId, table.ownerAddress),
  ],
);

export const taxonomyTerms = pgTable(
  "taxonomy_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: taxonomyKind("kind").notNull(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    isCore: boolean("is_core").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("taxonomy_kind_slug_unique").on(table.kind, table.slug),
  ],
);

export const agentTaxonomy = pgTable(
  "agent_taxonomy",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => taxonomyTerms.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.termId] })],
);

export const agentServices = pgTable(
  "agent_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    name: text("name").notNull(),
    capability: text("capability"),
    description: text("description"),
    inputSchema: jsonb("input_schema"),
    outputSchema: jsonb("output_schema"),
    pricing: jsonb("pricing"),
    endpoint: text("endpoint"),
    sla: jsonb("sla"),
    status: availabilityStatus("status").notNull().default("unknown"),
    ...timestamps,
  },
  (table) => [index("agent_services_agent_idx").on(table.agentId)],
);

export const performanceMetrics = pgTable(
  "performance_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    unit: text("unit"),
    window: text("window"),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("performance_agent_key_time_idx").on(
      table.agentId,
      table.key,
      table.measuredAt,
    ),
  ],
);

export const reputationSignals = pgTable(
  "reputation_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: jsonb("value").notNull(),
    scale: text("scale"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("reputation_agent_kind_time_idx").on(
      table.agentId,
      table.kind,
      table.recordedAt,
    ),
  ],
);

export const availabilityObservations = pgTable(
  "availability_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: availabilityStatus("status").notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    lastSuccessfulContactAt: timestamp("last_successful_contact_at", {
      withTimezone: true,
    }),
    latencyMs: doublePrecision("latency_ms"),
    uptimeRatio: doublePrecision("uptime_ratio"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("availability_agent_time_idx").on(table.agentId, table.observedAt),
  ],
);

export const factEvidence = pgTable(
  "fact_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    fieldPath: text("field_path").notNull(),
    provenance: provenanceKind("provenance").notNull(),
    source: text("source").notNull(),
    sourceUri: text("source_uri"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    chainId: integer("chain_id"),
    transactionHash: text("transaction_hash"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    contentHash: text("content_hash"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("fact_evidence_agent_field_idx").on(table.agentId, table.fieldPath),
  ],
);

export const ingestionRecords = pgTable(
  "ingestion_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    sourceKey: text("source_key").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull(),
    status: ingestionStatus("status").notNull(),
    error: jsonb("error"),
    normalizedAgentId: uuid("normalized_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ingestion_provider_source_idx").on(
      table.provider,
      table.sourceKey,
      table.fetchedAt,
    ),
  ],
);

export const indexerCheckpoints = pgTable(
  "indexer_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    registryAddress: text("registry_address").notNull(),
    indexedBlock: bigint("indexed_block", { mode: "bigint" }).notNull(),
    indexedBlockHash: text("indexed_block_hash"),
    safeBlock: bigint("safe_block", { mode: "bigint" }).notNull(),
    status: indexerStatus("status").notNull().default("idle"),
    lastSuccessfulRunAt: timestamp("last_successful_run_at", {
      withTimezone: true,
    }),
    error: jsonb("error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("indexer_checkpoint_registry_unique").on(
      table.chainId,
      table.registryAddress,
    ),
  ],
);

export const indexedBlocks = pgTable(
  "indexed_blocks",
  {
    chainId: integer("chain_id").notNull(),
    registryAddress: text("registry_address").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    parentHash: text("parent_hash").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.chainId, table.registryAddress, table.blockNumber],
    }),
  ],
);

export const rawChainEvents = pgTable(
  "raw_chain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    contractAddress: text("contract_address").notNull(),
    eventName: text("event_name").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    transactionHash: text("transaction_hash").notNull(),
    transactionIndex: integer("transaction_index").notNull(),
    logIndex: integer("log_index").notNull(),
    externalAgentId: text("external_agent_id"),
    decodedPayload: jsonb("decoded_payload").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("raw_chain_event_log_unique").on(
      table.chainId,
      table.contractAddress,
      table.transactionHash,
      table.logIndex,
    ),
    index("raw_chain_event_block_idx").on(
      table.chainId,
      table.contractAddress,
      table.blockNumber,
    ),
    index("raw_chain_event_agent_idx").on(
      table.chainId,
      table.contractAddress,
      table.externalAgentId,
    ),
  ],
);

export const metadataHistory = pgTable(
  "metadata_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    metadataUri: text("metadata_uri").notNull(),
    contentHash: text("content_hash"),
    payload: jsonb("payload"),
    resolutionStatus: text("resolution_status").notNull(),
    error: jsonb("error"),
    observedBlock: bigint("observed_block", { mode: "bigint" }),
    observedBlockHash: text("observed_block_hash"),
    transactionHash: text("transaction_hash"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("metadata_history_observation_unique").on(
      table.agentId,
      sql`md5(${table.metadataUri})`,
      table.contentHash,
      table.observedBlock,
    ),
    index("metadata_history_agent_time_idx").on(
      table.agentId,
      table.observedAt,
    ),
  ],
);

export const ownershipHistory = pgTable(
  "ownership_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    previousOwner: text("previous_owner"),
    ownerAddress: text("owner_address").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    transactionHash: text("transaction_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ownership_history_log_unique").on(
      table.agentId,
      table.transactionHash,
      table.logIndex,
    ),
    index("ownership_history_agent_block_idx").on(
      table.agentId,
      table.blockNumber,
    ),
  ],
);

export const reconciliationRecords = pgTable(
  "reconciliation_records",
  {
    id: serial("id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    fieldPath: text("field_path").notNull(),
    status: reconciliationStatus("status").notNull(),
    directValue: jsonb("direct_value"),
    secondaryValue: jsonb("secondary_value"),
    secondaryProvider: text("secondary_provider").notNull(),
    secondaryObservedAt: timestamp("secondary_observed_at", {
      withTimezone: true,
    }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    details: jsonb("details"),
  },
  (table) => [
    index("reconciliation_agent_status_idx").on(table.agentId, table.status),
  ],
);

export const indexerRuns = pgTable("indexer_runs", {
  id: uuid("id").primaryKey(),
  mode: text("mode").notNull(),
  chainId: integer("chain_id").notNull(),
  registryAddress: text("registry_address").notNull(),
  fromBlock: bigint("from_block", { mode: "bigint" }),
  toBlock: bigint("to_block", { mode: "bigint" }),
  safeBlock: bigint("safe_block", { mode: "bigint" }),
  status: indexerStatus("status").notNull(),
  dryRun: boolean("dry_run").notNull().default(false),
  counters: jsonb("counters").notNull().default({}),
  error: jsonb("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const corpusImportCheckpoints = pgTable(
  "corpus_import_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    chainId: integer("chain_id").notNull(),
    registryAddress: text("registry_address").notNull(),
    nextPage: integer("next_page").notNull().default(1),
    pageSize: integer("page_size").notNull(),
    totalReported: integer("total_reported"),
    status: corpusImportStatus("status").notNull().default("idle"),
    lastSuccessfulRunAt: timestamp("last_successful_run_at", {
      withTimezone: true,
    }),
    error: jsonb("error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("corpus_import_checkpoint_source_unique").on(
      table.provider,
      table.chainId,
      table.registryAddress,
    ),
  ],
);

export const corpusImportRuns = pgTable(
  "corpus_import_runs",
  {
    id: uuid("id").primaryKey(),
    provider: text("provider").notNull(),
    chainId: integer("chain_id").notNull(),
    registryAddress: text("registry_address").notNull(),
    startPage: integer("start_page").notNull(),
    endPage: integer("end_page"),
    pageSize: integer("page_size").notNull(),
    status: corpusImportStatus("status").notNull(),
    counters: jsonb("counters").notNull().default({}),
    totalReported: integer("total_reported"),
    rateLimit: integer("rate_limit"),
    rateLimitRemaining: integer("rate_limit_remaining"),
    rateLimitResetAt: timestamp("rate_limit_reset_at", { withTimezone: true }),
    error: jsonb("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("corpus_import_runs_source_time_idx").on(
      table.provider,
      table.startedAt,
    ),
  ],
);

export const corpusSourceRecords = pgTable(
  "corpus_source_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    registryAddress: text("registry_address").notNull(),
    externalAgentId: text("external_agent_id").notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("corpus_source_record_unique").on(
      table.provider,
      table.sourceRecordId,
    ),
    index("corpus_source_agent_idx").on(table.agentId, table.provider),
  ],
);

export const verificationQueue = pgTable(
  "verification_queue",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: verificationStatus("status").notNull().default("unverified"),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBlock: bigint("verified_block", { mode: "bigint" }),
    error: jsonb("error"),
    ...timestamps,
  },
  (table) => [
    index("verification_queue_status_priority_idx").on(
      table.status,
      table.priority,
    ),
  ],
);

export const verificationObservations = pgTable(
  "verification_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: verificationStatus("status").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    facts: jsonb("facts").notNull(),
    mismatches: jsonb("mismatches").notNull().default([]),
    evidence: jsonb("evidence").notNull(),
    error: jsonb("error"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("verification_observation_agent_time_idx").on(
      table.agentId,
      table.observedAt,
    ),
  ],
);

export const serviceDeclarations = pgTable(
  "service_declarations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    rawName: text("raw_name").notNull(),
    normalizedType: text("normalized_type").notNull(),
    endpoint: text("endpoint"),
    malformed: boolean("malformed").notNull().default(false),
    provenance: provenanceKind("provenance").notNull(),
    raw: jsonb("raw").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("service_declaration_source_unique").on(
      table.agentId,
      table.source,
      table.rawName,
      table.endpoint,
    ),
    index("service_declaration_type_idx").on(table.normalizedType),
  ],
);

export const agentQualityProfiles = pgTable(
  "agent_quality_profiles",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    completenessPercent: integer("completeness_percent").notNull(),
    readiness: marketplaceReadiness("readiness").notNull(),
    facts: jsonb("facts").notNull(),
    ruleVersion: text("rule_version").notNull(),
    profiledAt: timestamp("profiled_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("agent_quality_readiness_idx").on(table.readiness)],
);

export const classificationEvidence = pgTable(
  "classification_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    categorySlug: text("category_slug").notNull(),
    confidence: text("confidence").notNull(),
    evidenceType: text("evidence_type").notNull(),
    matchedSource: text("matched_source").notNull(),
    matchedValue: text("matched_value").notNull(),
    ruleVersion: text("rule_version").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("classification_evidence_rule_unique").on(
      table.agentId,
      table.categorySlug,
      table.matchedSource,
      table.matchedValue,
      table.ruleVersion,
    ),
  ],
);

export const endpointObservations = pgTable(
  "endpoint_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    serviceDeclarationId: uuid("service_declaration_id").references(
      () => serviceDeclarations.id,
      { onDelete: "set null" },
    ),
    endpoint: text("endpoint").notNull(),
    status: endpointObservationStatus("status").notNull(),
    httpStatus: integer("http_status"),
    latencyMs: doublePrecision("latency_ms"),
    redirectCount: integer("redirect_count").notNull().default(0),
    errorCode: text("error_code"),
    evidence: jsonb("evidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("endpoint_observation_agent_time_idx").on(
      table.agentId,
      table.observedAt,
    ),
  ],
);

export const duplicateSignals = pgTable(
  "duplicate_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    fingerprint: text("fingerprint").notNull(),
    groupSize: integer("group_size").notNull(),
    details: jsonb("details").notNull(),
    ruleVersion: text("rule_version").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("duplicate_signal_agent_rule_unique").on(
      table.agentId,
      table.kind,
      table.fingerprint,
      table.ruleVersion,
    ),
    index("duplicate_signal_kind_fingerprint_idx").on(
      table.kind,
      table.fingerprint,
    ),
  ],
);

export const targetedDiscoveryRuns = pgTable(
  "targeted_discovery_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    chainId: integer("chain_id").notNull(),
    categorySlug: text("category_slug").notNull(),
    query: text("query").notNull(),
    status: corpusImportStatus("status").notNull(),
    returnedCount: integer("returned_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    rateLimit: integer("rate_limit"),
    rateLimitRemaining: integer("rate_limit_remaining"),
    rateLimitResetAt: timestamp("rate_limit_reset_at", { withTimezone: true }),
    error: jsonb("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("targeted_discovery_category_time_idx").on(
      table.categorySlug,
      table.startedAt,
    ),
  ],
);

export const launchCandidates = pgTable(
  "launch_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    categorySlug: text("category_slug").notNull(),
    supplyType: supplyType("supply_type").notNull().default("third_party"),
    status: launchCandidateStatus("status").notNull().default("DISCOVERED"),
    confidence: text("confidence").notNull(),
    source: text("source").notNull(),
    evidence: jsonb("evidence").notNull(),
    rejectionReason: text("rejection_reason"),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    staleAt: timestamp("stale_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("launch_candidate_agent_category_unique").on(
      table.agentId,
      table.categorySlug,
    ),
    index("launch_candidate_category_status_idx").on(
      table.categorySlug,
      table.status,
    ),
  ],
);

export const agentSubmissions = pgTable(
  "agent_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    externalAgentId: text("external_agent_id").notNull(),
    supplyType: supplyType("supply_type").notNull().default("third_party"),
    submitterAddress: text("submitter_address"),
    status: submissionStatus("status").notNull().default("SUBMITTED"),
    ownershipVerifiedAt: timestamp("ownership_verified_at", {
      withTimezone: true,
    }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    candidateId: uuid("candidate_id").references(() => launchCandidates.id, {
      onDelete: "set null",
    }),
    developerOverrides: jsonb("developer_overrides").notNull().default({}),
    evidence: jsonb("evidence").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("agent_submission_chain_identity_unique").on(
      table.chainId,
      table.externalAgentId,
    ),
    index("agent_submission_type_status_idx").on(
      table.supplyType,
      table.status,
    ),
  ],
);

export const submissionTransitions = pgTable(
  "submission_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => agentSubmissions.id, { onDelete: "cascade" }),
    fromStatus: submissionStatus("from_status"),
    toStatus: submissionStatus("to_status").notNull(),
    evidence: jsonb("evidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("submission_transition_time_idx").on(
      table.submissionId,
      table.observedAt,
    ),
  ],
);

export const ownershipChallenges = pgTable(
  "ownership_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => agentSubmissions.id, { onDelete: "cascade" }),
    nonceHash: text("nonce_hash").notNull(),
    message: text("message").notNull(),
    expectedOwner: text("expected_owner").notNull(),
    signerAddress: text("signer_address"),
    signatureDigest: text("signature_digest"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ownership_challenge_nonce_hash_unique").on(table.nonceHash),
    index("ownership_challenge_submission_expiry_idx").on(
      table.submissionId,
      table.expiresAt,
    ),
  ],
);

export const targetedDiscoveryRecords = pgTable(
  "targeted_discovery_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => targetedDiscoveryRuns.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").references(() => launchCandidates.id, {
      onDelete: "set null",
    }),
    sourceRecordId: text("source_record_id").notNull(),
    rank: integer("rank").notNull(),
    raw: jsonb("raw").notNull(),
    searchEvidence: jsonb("search_evidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("targeted_discovery_run_record_unique").on(
      table.runId,
      table.sourceRecordId,
    ),
    index("targeted_discovery_agent_idx").on(table.agentId),
  ],
);

export const launchCandidateTransitions = pgTable(
  "launch_candidate_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => launchCandidates.id, { onDelete: "cascade" }),
    fromStatus: launchCandidateStatus("from_status"),
    toStatus: launchCandidateStatus("to_status").notNull(),
    evidence: jsonb("evidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("launch_candidate_transition_time_idx").on(
      table.candidateId,
      table.observedAt,
    ),
  ],
);

export const marketplaceServices = pgTable(
  "marketplace_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    sourceDeclarationId: uuid("source_declaration_id").references(
      () => serviceDeclarations.id,
      { onDelete: "set null" },
    ),
    sourceServiceId: text("source_service_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    capability: text("capability"),
    categorySlug: text("category_slug"),
    interfaceProtocol: text("interface_protocol").notNull(),
    endpoint: text("endpoint"),
    httpMethod: text("http_method"),
    inputSchema: jsonb("input_schema"),
    outputSchema: jsonb("output_schema"),
    pricing: jsonb("pricing"),
    currencyToken: text("currency_token"),
    networkChainId: integer("network_chain_id"),
    sla: jsonb("sla"),
    authenticationRequirements: jsonb("authentication_requirements"),
    protocolSupport: jsonb("protocol_support").notNull().default({}),
    availability: availabilityStatus("availability")
      .notNull()
      .default("unknown"),
    verificationLevel: serviceVerificationLevel("verification_level")
      .notNull()
      .default("DECLARED"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    source: text("source").notNull(),
    provenance: provenanceKind("provenance").notNull(),
    raw: jsonb("raw").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("marketplace_service_source_unique").on(
      table.agentId,
      table.source,
      table.sourceServiceId,
    ),
    index("marketplace_service_verification_idx").on(
      table.verificationLevel,
      table.categorySlug,
    ),
    index("marketplace_service_agent_idx").on(table.agentId),
  ],
);

export const serviceVerificationObservations = pgTable(
  "service_verification_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => marketplaceServices.id, { onDelete: "cascade" }),
    fromLevel: serviceVerificationLevel("from_level").notNull(),
    toLevel: serviceVerificationLevel("to_level").notNull(),
    result: text("result").notNull(),
    protocol: text("protocol").notNull(),
    requestMethod: text("request_method"),
    httpStatus: integer("http_status"),
    latencyMs: doublePrecision("latency_ms"),
    evidence: jsonb("evidence").notNull(),
    error: jsonb("error"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("service_verification_service_time_idx").on(
      table.serviceId,
      table.observedAt,
    ),
  ],
);

export const activations = pgTable(
  "activations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => marketplaceServices.id, { onDelete: "restrict" }),
    chainId: integer("chain_id").notNull(),
    status: activationStatus("status").notNull().default("PREPARED"),
    lifecycleState: activationLifecycleState("lifecycle_state")
      .notNull()
      .default("PREPARING"),
    externalJobId: text("external_job_id"),
    commerceAddress: text("commerce_address"),
    clientAddress: text("client_address"),
    providerAddress: text("provider_address"),
    evaluatorAddress: text("evaluator_address"),
    budget: text("budget"),
    currencyToken: text("currency_token"),
    descriptionHash: text("description_hash"),
    resultReference: text("result_reference"),
    failure: jsonb("failure"),
    ...timestamps,
  },
  (table) => [
    index("activation_service_status_idx").on(table.serviceId, table.status),
    uniqueIndex("activation_chain_job_unique").on(
      table.chainId,
      table.commerceAddress,
      table.externalJobId,
    ),
  ],
);

export const activationLifecycleTransitions = pgTable(
  "activation_lifecycle_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id")
      .notNull()
      .references(() => activations.id, { onDelete: "cascade" }),
    fromState: activationLifecycleState("from_state"),
    toState: activationLifecycleState("to_state").notNull(),
    evidence: jsonb("evidence").notNull(),
    transactionHash: text("transaction_hash"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("activation_lifecycle_transition_time_idx").on(
      table.activationId,
      table.observedAt,
    ),
  ],
);

export const marketplaceOutcomes = pgTable(
  "marketplace_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id")
      .notNull()
      .references(() => activations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => marketplaceServices.id, { onDelete: "restrict" }),
    invocationSuccessful: boolean("invocation_successful").notNull(),
    commerceSuccessful: boolean("commerce_successful").notNull(),
    executionDurationMs: doublePrecision("execution_duration_ms"),
    responseStatus: text("response_status"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    settlementState: text("settlement_state").notNull(),
    observedCost: text("observed_cost").notNull(),
    protocolEvidence: jsonb("protocol_evidence").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("marketplace_outcome_activation_unique").on(table.activationId),
    index("marketplace_outcome_supply_metrics_idx").on(
      table.agentId,
      table.commerceSuccessful,
    ),
  ],
);

export const activationPreflights = pgTable(
  "activation_preflights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id").references(() => marketplaceServices.id, {
      onDelete: "set null",
    }),
    chainId: integer("chain_id").notNull(),
    status: activationStatus("status").notNull(),
    commerceAddress: text("commerce_address").notNull(),
    paymentToken: text("payment_token"),
    contractDeployed: boolean("contract_deployed").notNull(),
    transactionAttempted: boolean("transaction_attempted")
      .notNull()
      .default(false),
    evidence: jsonb("evidence").notNull(),
    failure: jsonb("failure"),
    ...timestamps,
  },
  (table) => [
    index("activation_preflight_status_time_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const activationTransitions = pgTable(
  "activation_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id")
      .notNull()
      .references(() => activations.id, { onDelete: "cascade" }),
    status: activationStatus("status").notNull(),
    transactionHash: text("transaction_hash"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    evidence: jsonb("evidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("activation_transition_time_idx").on(
      table.activationId,
      table.observedAt,
    ),
  ],
);

export const reputationInventory = pgTable(
  "reputation_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    feedbackCount: integer("feedback_count").notNull().default(0),
    averageScore: doublePrecision("average_score"),
    starCount: integer("star_count").notNull().default(0),
    sourceScore: doublePrecision("source_score"),
    raw: jsonb("raw").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("reputation_inventory_agent_source_unique").on(
      table.agentId,
      table.source,
    ),
  ],
);

export const referenceAgentArtifacts = pgTable(
  "reference_agent_artifacts",
  {
    agentSlug: text("agent_slug").notNull(),
    jobId: bigint("job_id", { mode: "bigint" }).notNull(),
    filename: text("filename").notNull(),
    content: jsonb("content").notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.agentSlug, table.jobId] }),
    index("reference_agent_artifacts_updated_idx").on(table.updatedAt),
  ],
);
