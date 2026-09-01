import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
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
export const marketplaceReviewRole = pgEnum("marketplace_review_role", [
  "BUYER",
  "AGENT",
]);
export const marketplaceReviewSubjectType = pgEnum(
  "marketplace_review_subject_type",
  ["AGENT", "BUYER"],
);
export const marketplaceReviewSentiment = pgEnum(
  "marketplace_review_sentiment",
  ["GOOD", "BAD"],
);
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
export const commerceValidationSessionStatus = pgEnum(
  "commerce_validation_session_status",
  ["OPEN", "CLAIMED", "COMPLETED", "CANCELLED", "EXPIRED"],
);
export const mandateStatus = pgEnum("mandate_status", [
  "DRAFT",
  "REVIEWED",
  "ACTIVE",
  "PAUSED",
  "REVOKED",
  "EXPIRED",
  "FAILED_ACTIVATION",
  "SUPERSEDED",
]);
export const mandateApprovalMode = pgEnum("mandate_approval_mode", [
  "OBSERVE_ONLY",
  "ASK_BEFORE_EXECUTION",
  "PRE_AUTHORIZED",
]);
export const mandatePrincipalType = pgEnum("mandate_principal_type", [
  "DEVELOPMENT_SESSION",
  "ACCOUNT",
  "WALLET",
]);
export const mandateAuthorizationBoundary = pgEnum(
  "mandate_authorization_boundary",
  ["POLICY_ONLY", "WALLET_AUTHORIZED"],
);
export const executionStatus = pgEnum("execution_status", [
  "REQUESTED",
  "EVALUATING",
  "APPROVAL_REQUIRED",
  "APPROVED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "DENIED",
  "EXPIRED",
  "CANCELLED",
  "BLOCKED_STALE_AGENT",
]);
export const executionPolicyDecision = pgEnum("execution_policy_decision", [
  "ALLOW",
  "REQUIRE_APPROVAL",
  "DENY",
]);
export const offerStatus = pgEnum("offer_status", [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "DEACTIVATED",
  "EXPIRED",
]);
export const offerBillingModel = pgEnum("offer_billing_model", [
  "ONE_TIME",
  "PER_EXECUTION",
  "SUBSCRIPTION",
]);
export const commerceAgreementStatus = pgEnum("commerce_agreement_status", [
  "DRAFT",
  "TERMS_ACCEPTED",
  "AUTHORIZATION_REQUIRED",
  "AUTHORIZED",
  "ACTIVE",
  "SUSPENDED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
]);
export const authorizationType = pgEnum("authorization_type", [
  "DEVELOPMENT_PRINCIPAL",
  "WALLET_SIGNATURE",
  "DELEGATED_AUTHORIZATION",
  "SESSION_KEY",
  "SMART_ACCOUNT_PERMISSION",
]);
export const authorizationVerificationStatus = pgEnum(
  "authorization_verification_status",
  ["PENDING", "VERIFIED", "REJECTED", "EXPIRED", "REVOKED"],
);
export const activationPurpose = pgEnum("activation_purpose", [
  "VERIFICATION",
  "USER_COMMERCE",
]);
export const activationReconciliationState = pgEnum(
  "activation_reconciliation_state",
  ["PENDING", "CURRENT", "STALE", "REORGED", "FAILED"],
);
export const commerceOperationType = pgEnum("commerce_operation_type", [
  "PREPARE_JOB",
  "APPROVE_TOKEN",
  "CREATE_JOB",
  "REGISTER_JOB",
  "SET_BUDGET",
  "FUND",
  "SUBMIT_DELIVERY",
  "SETTLE",
  "REJECT",
  "CLAIM_REFUND",
  "CANCEL",
]);
export const commerceOperationState = pgEnum("commerce_operation_state", [
  "CREATED",
  "READY",
  "AWAITING_SIGNATURE",
  "SUBMITTED",
  "PENDING",
  "CONFIRMED",
  "FINALIZED",
  "FAILED",
  "REPLACED",
  "REORGED",
  "CANCELLED",
]);
export const commerceValueMovementType = pgEnum(
  "commerce_value_movement_type",
  ["FUNDING", "ESCROW_LOCK", "PAYMENT", "REFUND", "FEE", "ESCROW_RELEASE"],
);
export const commerceFinalityState = pgEnum("commerce_finality_state", [
  "UNCONFIRMED",
  "CONFIRMED",
  "FINALIZED",
  "REORGED",
]);
export const commerceArtifactType = pgEnum("commerce_artifact_type", [
  "NEGOTIATED_TERMS",
  "ACCEPTED_TERMS",
  "AUTHORIZATION",
  "JOB_SPECIFICATION",
  "DELIVERY",
  "EVALUATION",
  "SETTLEMENT",
  "REJECTION",
  "REFUND",
]);
export const settlementStatus = pgEnum("settlement_status", [
  "PENDING",
  "FUNDED",
  "DELIVERED",
  "EVALUATED",
  "SETTLED",
  "REJECTED",
  "REFUNDED",
  "FAILED",
  "REORGED",
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
    verificationUrl: text("verification_url"),
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
    accessMode: text("access_mode").notNull().default("anonymous"),
    operationalMode: text("operational_mode").notNull().default("anonymous"),
    rateLimit: integer("rate_limit"),
    rateLimitRemaining: integer("rate_limit_remaining"),
    rateLimitResetAt: timestamp("rate_limit_reset_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
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
    accessMode: text("access_mode").notNull().default("anonymous"),
    operationalMode: text("operational_mode").notNull().default("anonymous"),
    requestBudget: integer("request_budget").notNull().default(1),
    requestCount: integer("request_count").notNull().default(0),
    counters: jsonb("counters").notNull().default({}),
    totalReported: integer("total_reported"),
    rateLimit: integer("rate_limit"),
    rateLimitRemaining: integer("rate_limit_remaining"),
    rateLimitResetAt: timestamp("rate_limit_reset_at", { withTimezone: true }),
    degradedReason: text("degraded_reason"),
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
    enrichmentRuleVersion: text("enrichment_rule_version"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    enrichmentError: jsonb("enrichment_error"),
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
    registryAddress: text("registry_address").notNull(),
    externalAgentId: text("external_agent_id").notNull(),
    supplyType: supplyType("supply_type").notNull().default("third_party"),
    relicPrincipalId: text("relic_principal_id"),
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
      table.registryAddress,
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
    principalId: text("principal_id"),
    chainId: integer("chain_id"),
    registryAddress: text("registry_address"),
    externalAgentId: text("external_agent_id"),
    nonceHash: text("nonce_hash").notNull(),
    message: text("message").notNull(),
    expectedOwner: text("expected_owner").notNull(),
    signerAddress: text("signer_address"),
    signatureDigest: text("signature_digest"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
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

export const sellerAgentAuthorizations = pgTable(
  "seller_agent_authorizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: text("principal_id").notNull(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => agentSubmissions.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    chainId: integer("chain_id").notNull(),
    registryAddress: text("registry_address").notNull(),
    externalAgentId: text("external_agent_id").notNull(),
    verifiedOwner: text("verified_owner").notNull(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => ownershipChallenges.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    lastOwnerCheckedAt: timestamp("last_owner_checked_at", {
      withTimezone: true,
    }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("seller_agent_authorization_challenge_unique").on(
      table.challengeId,
    ),
    uniqueIndex("seller_agent_authorization_active_identity_unique")
      .on(table.chainId, table.registryAddress, table.externalAgentId)
      .where(sql`${table.revokedAt} is null`),
    index("seller_agent_authorization_principal_idx").on(
      table.principalId,
      table.revokedAt,
    ),
    index("seller_agent_authorization_identity_idx").on(
      table.chainId,
      table.registryAddress,
      table.externalAgentId,
    ),
  ],
);

export const sellerMarketplaceProfiles = pgTable(
  "seller_marketplace_profiles",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    imageUrl: text("image_url"),
    updatedByPrincipalId: text("updated_by_principal_id").notNull(),
    ...timestamps,
  },
  (table) => [
    index("seller_marketplace_profile_principal_idx").on(
      table.updatedByPrincipalId,
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
    verificationUrl: text("verification_url"),
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
    verificationRequestedAt: timestamp("verification_requested_at", {
      withTimezone: true,
    }),
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
    purpose: activationPurpose("purpose").notNull().default("VERIFICATION"),
    marketplaceHistoryEligible: boolean("marketplace_history_eligible")
      .notNull()
      .default(false),
    commerceAgreementId: uuid("commerce_agreement_id"),
    executionRequestId: uuid("execution_request_id"),
    mandateId: uuid("mandate_id"),
    mandateVersion: integer("mandate_version"),
    principalId: text("principal_id"),
    acceptedTermsHash: text("accepted_terms_hash"),
    pricingSnapshot: jsonb("pricing_snapshot"),
    budgetBaseUnits: numeric("budget_base_units", { precision: 78, scale: 0 }),
    paymentTokenDecimals: integer("payment_token_decimals"),
    authorizationId: uuid("authorization_id"),
    reconciliationState: activationReconciliationState("reconciliation_state")
      .notNull()
      .default("PENDING"),
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
    uniqueIndex("activation_execution_unique").on(table.executionRequestId),
    index("activation_agreement_lifecycle_idx").on(
      table.commerceAgreementId,
      table.lifecycleState,
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

export const marketplaceReviews = pgTable(
  "marketplace_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id")
      .notNull()
      .references(() => activations.id, { onDelete: "restrict" }),
    commerceAgreementId: uuid("commerce_agreement_id")
      .notNull()
      .references(() => commerceAgreements.id, { onDelete: "restrict" }),
    reviewerPrincipalId: text("reviewer_principal_id").notNull(),
    reviewerRole: marketplaceReviewRole("reviewer_role").notNull(),
    subjectType: marketplaceReviewSubjectType("subject_type").notNull(),
    subjectAgentId: uuid("subject_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    subjectPrincipalId: text("subject_principal_id"),
    sentiment: marketplaceReviewSentiment("sentiment").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    message: text("message"),
    marketplaceHistoryEligible: boolean("marketplace_history_eligible")
      .notNull()
      .default(true),
    eligibilityProvenance: jsonb("eligibility_provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("marketplace_review_role_subject_unique").on(
      table.activationId,
      table.reviewerRole,
      table.subjectType,
    ),
    index("marketplace_review_agent_time_idx").on(
      table.subjectAgentId,
      table.createdAt,
    ),
    index("marketplace_review_buyer_time_idx").on(
      table.subjectPrincipalId,
      table.createdAt,
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

export const mandates = pgTable(
  "mandates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: text("principal_id").notNull(),
    principalType: mandatePrincipalType("principal_type").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    chainId: integer("chain_id").notNull(),
    status: mandateStatus("status").notNull().default("DRAFT"),
    authorizationBoundary: mandateAuthorizationBoundary(
      "authorization_boundary",
    )
      .notNull()
      .default("POLICY_ONLY"),
    currentVersion: integer("current_version").notNull().default(1),
    activeVersion: integer("active_version"),
    attentionReason: text("attention_reason"),
    ...timestamps,
  },
  (table) => [
    index("mandate_principal_status_idx").on(table.principalId, table.status),
    index("mandate_agent_status_idx").on(table.agentId, table.status),
  ],
);

export const mandateVersions = pgTable(
  "mandate_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => mandates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    state: mandateStatus("state").notNull().default("DRAFT"),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => marketplaceServices.id, { onDelete: "restrict" }),
    objective: text("objective").notNull(),
    allowedCapabilities: jsonb("allowed_capabilities").notNull(),
    deniedCapabilities: jsonb("denied_capabilities").notNull(),
    allowedAssets: jsonb("allowed_assets").notNull(),
    allowedProtocols: jsonb("allowed_protocols").notNull(),
    allowedContracts: jsonb("allowed_contracts").notNull(),
    perActionLimit: jsonb("per_action_limit"),
    aggregateLimit: jsonb("aggregate_limit"),
    executionFrequency: jsonb("execution_frequency"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvalMode: mandateApprovalMode("approval_mode").notNull(),
    riskConstraints: jsonb("risk_constraints").notNull(),
    stopConditions: jsonb("stop_conditions").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mandate_version_unique").on(table.mandateId, table.version),
    index("mandate_version_state_idx").on(table.mandateId, table.state),
    index("mandate_version_expiry_idx").on(table.expiresAt),
  ],
);

export const mandateEvidenceBindings = pgTable(
  "mandate_evidence_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mandateVersionId: uuid("mandate_version_id")
      .notNull()
      .references(() => mandateVersions.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    externalAgentId: text("external_agent_id").notNull(),
    registryAddress: text("registry_address").notNull(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => marketplaceServices.id, { onDelete: "restrict" }),
    serviceEndpoint: text("service_endpoint").notNull(),
    verificationTier: text("verification_tier").notNull(),
    verificationTimestamp: timestamp("verification_timestamp", {
      withTimezone: true,
    }).notNull(),
    chainId: integer("chain_id").notNull(),
    capabilitySet: jsonb("capability_set").notNull(),
    evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mandate_evidence_version_unique").on(table.mandateVersionId),
    index("mandate_evidence_agent_service_idx").on(
      table.agentId,
      table.serviceId,
    ),
  ],
);

export const mandateEvents = pgTable(
  "mandate_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => mandates.id, { onDelete: "cascade" }),
    mandateVersionId: uuid("mandate_version_id").references(
      () => mandateVersions.id,
      { onDelete: "set null" },
    ),
    eventType: text("event_type").notNull(),
    securitySensitive: boolean("security_sensitive").notNull().default(false),
    details: jsonb("details").notNull().default({}),
    evidenceReferences: jsonb("evidence_references").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mandate_event_time_idx").on(table.mandateId, table.occurredAt),
    index("mandate_event_security_idx").on(
      table.securitySensitive,
      table.occurredAt,
    ),
  ],
);

export const executionRequests = pgTable(
  "execution_requests",
  {
    id: uuid("id").primaryKey(),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => mandates.id, { onDelete: "cascade" }),
    mandateVersion: integer("mandate_version").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    chainId: integer("chain_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    rawRequest: jsonb("raw_request").notNull(),
    normalizedAction: jsonb("normalized_action").notNull(),
    normalizedHash: text("normalized_hash").notNull(),
    status: executionStatus("status").notNull().default("REQUESTED"),
    decision: executionPolicyDecision("decision"),
    decisionReasons: jsonb("decision_reasons").notNull().default([]),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("execution_principal_idempotency_unique").on(
      table.principalId,
      table.idempotencyKey,
    ),
    uniqueIndex("execution_normalized_hash_unique").on(
      table.principalId,
      table.normalizedHash,
    ),
    index("execution_mandate_time_idx").on(table.mandateId, table.createdAt),
    index("execution_status_time_idx").on(table.status, table.updatedAt),
  ],
);

export const executionPolicyDecisions = pgTable(
  "execution_policy_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionRequestId: uuid("execution_request_id")
      .notNull()
      .references(() => executionRequests.id, { onDelete: "cascade" }),
    decision: executionPolicyDecision("decision").notNull(),
    normalizedHash: text("normalized_hash").notNull(),
    mandateVersion: integer("mandate_version").notNull(),
    reasons: jsonb("reasons").notNull(),
    evidence: jsonb("evidence").notNull().default({}),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("execution_policy_request_idx").on(table.executionRequestId),
  ],
);

export const executionApprovals = pgTable(
  "execution_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionRequestId: uuid("execution_request_id")
      .notNull()
      .references(() => executionRequests.id, { onDelete: "cascade" }),
    principalId: text("principal_id").notNull(),
    normalizedHash: text("normalized_hash").notNull(),
    approved: boolean("approved").notNull(),
    authorizationKind: text("authorization_kind")
      .notNull()
      .default("DEVELOPMENT_API"),
    walletAuthorization: boolean("wallet_authorization")
      .notNull()
      .default(false),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("execution_approval_once_unique").on(table.executionRequestId),
    index("execution_approval_hash_idx").on(table.normalizedHash),
  ],
);

export const executionRuns = pgTable(
  "executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionRequestId: uuid("execution_request_id")
      .notNull()
      .references(() => executionRequests.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull().default(1),
    executorKind: text("executor_kind").notNull(),
    status: executionStatus("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("execution_run_attempt_unique").on(
      table.executionRequestId,
      table.attempt,
    ),
  ],
);

export const executionReceipts = pgTable(
  "execution_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionRequestId: uuid("execution_request_id")
      .notNull()
      .references(() => executionRequests.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    outcome: jsonb("outcome").notNull(),
    evidence: jsonb("evidence").notNull(),
    cost: numeric("cost", { precision: 78, scale: 18 }),
    transactionHash: text("transaction_hash"),
    jobId: text("job_id"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("execution_receipt_request_unique").on(
      table.executionRequestId,
    ),
  ],
);

export const budgetReservations = pgTable(
  "budget_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionRequestId: uuid("execution_request_id")
      .notNull()
      .references(() => executionRequests.id, { onDelete: "cascade" }),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => mandates.id, { onDelete: "cascade" }),
    mandateVersion: integer("mandate_version").notNull(),
    asset: text("asset").notNull(),
    amount: numeric("amount", { precision: 78, scale: 18 }).notNull(),
    state: text("state").notNull(),
    releasedAmount: numeric("released_amount", { precision: 78, scale: 18 })
      .notNull()
      .default("0"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("budget_execution_unique").on(table.executionRequestId),
    index("budget_mandate_state_idx").on(
      table.mandateId,
      table.mandateVersion,
      table.state,
    ),
  ],
);

export const walletAuthChallenges = pgTable(
  "wallet_auth_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull(),
    chainId: integer("chain_id").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    message: text("message").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("wallet_challenge_nonce_unique").on(table.nonceHash),
    index("wallet_challenge_address_expiry_idx").on(
      table.walletAddress,
      table.expiresAt,
    ),
  ],
);

export const walletSessions = pgTable(
  "wallet_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: text("principal_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    chainId: integer("chain_id").notNull(),
    sessionTokenHash: text("session_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("wallet_session_token_unique").on(table.sessionTokenHash),
    index("wallet_session_principal_expiry_idx").on(
      table.principalId,
      table.expiresAt,
    ),
  ],
);

export const agentOffers = pgTable(
  "agent_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorPrincipalId: text("operator_principal_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => marketplaceServices.id, { onDelete: "restrict" }),
    status: offerStatus("status").notNull().default("DRAFT"),
    currentVersion: integer("current_version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("agent_offer_agent_status_idx").on(table.agentId, table.status),
    index("agent_offer_operator_status_idx").on(
      table.operatorPrincipalId,
      table.status,
    ),
  ],
);

export const agentOfferVersions = pgTable(
  "agent_offer_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => agentOffers.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    chainId: integer("chain_id").notNull(),
    capability: text("capability").notNull(),
    billingModel: offerBillingModel("billing_model").notNull(),
    priceBaseUnits: numeric("price_base_units", {
      precision: 78,
      scale: 0,
    }).notNull(),
    paymentTokenAddress: text("payment_token_address").notNull(),
    paymentTokenDecimals: integer("payment_token_decimals").notNull(),
    currencySymbol: text("currency_symbol").notNull(),
    termsContent: text("terms_content").notNull(),
    termsHash: text("terms_hash").notNull(),
    capabilitySnapshot: jsonb("capability_snapshot").notNull(),
    limitationsSnapshot: jsonb("limitations_snapshot").notNull(),
    evidenceReference: jsonb("evidence_reference").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_offer_version_unique").on(table.offerId, table.version),
    index("agent_offer_version_terms_idx").on(table.termsHash),
  ],
);

export const commerceValidationSessions = pgTable(
  "commerce_validation_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => agentOffers.id, { onDelete: "restrict" }),
    offerVersionId: uuid("offer_version_id")
      .notNull()
      .references(() => agentOfferVersions.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => marketplaceServices.id, { onDelete: "restrict" }),
    chainId: integer("chain_id").notNull(),
    sellerPrincipalId: text("seller_principal_id").notNull(),
    buyerPrincipalId: text("buyer_principal_id"),
    mandateId: uuid("mandate_id").references(() => mandates.id, {
      onDelete: "restrict",
    }),
    agreementId: uuid("agreement_id").references(() => commerceAgreements.id, {
      onDelete: "restrict",
    }),
    handoffTokenHash: text("handoff_token_hash").notNull(),
    status: commerceValidationSessionStatus("status").notNull().default("OPEN"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedActivationId: uuid("completed_activation_id").references(
      () => activations.id,
      { onDelete: "restrict" },
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commerce_validation_session_token_unique").on(
      table.handoffTokenHash,
    ),
    index("commerce_validation_session_offer_status_idx").on(
      table.offerId,
      table.status,
      table.expiresAt,
    ),
    index("commerce_validation_session_buyer_idx").on(
      table.buyerPrincipalId,
      table.status,
    ),
  ],
);

export const agentOfferEvents = pgTable(
  "agent_offer_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => agentOffers.id, { onDelete: "restrict" }),
    offerVersionId: uuid("offer_version_id").references(
      () => agentOfferVersions.id,
      { onDelete: "restrict" },
    ),
    eventType: text("event_type").notNull(),
    actorPrincipalId: text("actor_principal_id").notNull(),
    evidence: jsonb("evidence").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_offer_event_time_idx").on(table.offerId, table.occurredAt),
  ],
);

export const commerceAgreements = pgTable(
  "commerce_agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: text("principal_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => marketplaceServices.id, { onDelete: "restrict" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => agentOffers.id, { onDelete: "restrict" }),
    offerVersionId: uuid("offer_version_id")
      .notNull()
      .references(() => agentOfferVersions.id, { onDelete: "restrict" }),
    mandateId: uuid("mandate_id").references(() => mandates.id, {
      onDelete: "restrict",
    }),
    mandateVersion: integer("mandate_version"),
    authorizationArtifactId: uuid("authorization_artifact_id"),
    status: commerceAgreementStatus("status").notNull().default("DRAFT"),
    currentVersion: integer("current_version").notNull().default(1),
    chainId: integer("chain_id").notNull(),
    termsHash: text("terms_hash").notNull(),
    termsSnapshot: text("terms_snapshot").notNull(),
    pricingSnapshot: jsonb("pricing_snapshot").notNull(),
    amountBaseUnits: numeric("amount_base_units", {
      precision: 78,
      scale: 0,
    }).notNull(),
    paymentTokenAddress: text("payment_token_address").notNull(),
    paymentTokenDecimals: integer("payment_token_decimals").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("commerce_agreement_principal_status_idx").on(
      table.principalId,
      table.status,
    ),
    index("commerce_agreement_offer_idx").on(table.offerVersionId),
    index("commerce_agreement_mandate_idx").on(table.mandateId),
  ],
);

export const commerceAgreementVersions = pgTable(
  "commerce_agreement_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => commerceAgreements.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: commerceAgreementStatus("status").notNull(),
    offerVersionId: uuid("offer_version_id")
      .notNull()
      .references(() => agentOfferVersions.id, { onDelete: "restrict" }),
    mandateId: uuid("mandate_id").references(() => mandates.id, {
      onDelete: "restrict",
    }),
    mandateVersion: integer("mandate_version"),
    termsHash: text("terms_hash").notNull(),
    termsSnapshot: text("terms_snapshot").notNull(),
    pricingSnapshot: jsonb("pricing_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("commerce_agreement_version_unique").on(
      table.agreementId,
      table.version,
    ),
  ],
);

export const commerceAgreementEvents = pgTable(
  "commerce_agreement_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => commerceAgreements.id, { onDelete: "restrict" }),
    agreementVersionId: uuid("agreement_version_id").references(
      () => commerceAgreementVersions.id,
      { onDelete: "restrict" },
    ),
    fromStatus: commerceAgreementStatus("from_status"),
    toStatus: commerceAgreementStatus("to_status").notNull(),
    eventType: text("event_type").notNull(),
    actorPrincipalId: text("actor_principal_id").notNull(),
    evidence: jsonb("evidence").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("commerce_agreement_event_time_idx").on(
      table.agreementId,
      table.occurredAt,
    ),
  ],
);

export const authorizationChallenges = pgTable(
  "authorization_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => commerceAgreements.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    normalizedPayload: jsonb("normalized_payload").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("authorization_challenge_nonce_unique").on(table.nonceHash),
    index("authorization_challenge_agreement_expiry_idx").on(
      table.agreementId,
      table.expiresAt,
    ),
  ],
);

export const authorizationArtifacts = pgTable(
  "authorization_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: text("principal_id").notNull(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => commerceAgreements.id, { onDelete: "restrict" }),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => mandates.id, { onDelete: "restrict" }),
    mandateVersion: integer("mandate_version").notNull(),
    executionRequestId: uuid("execution_request_id").references(
      () => executionRequests.id,
      { onDelete: "restrict" },
    ),
    authorizationType: authorizationType("authorization_type").notNull(),
    signerAddress: text("signer_address"),
    chainId: integer("chain_id").notNull(),
    normalizedPayload: jsonb("normalized_payload").notNull(),
    signature: text("signature"),
    messageHash: text("message_hash").notNull(),
    actionHash: text("action_hash"),
    termsHash: text("terms_hash").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    verificationStatus: authorizationVerificationStatus("verification_status")
      .notNull()
      .default("PENDING"),
    evidenceReference: jsonb("evidence_reference").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("authorization_nonce_unique").on(table.nonceHash),
    index("authorization_agreement_status_idx").on(
      table.agreementId,
      table.verificationStatus,
    ),
    index("authorization_action_hash_idx").on(table.actionHash),
  ],
);

export const authorizationEvents = pgTable(
  "authorization_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorizationId: uuid("authorization_id")
      .notNull()
      .references(() => authorizationArtifacts.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    verificationStatus: authorizationVerificationStatus(
      "verification_status",
    ).notNull(),
    evidence: jsonb("evidence").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("authorization_event_time_idx").on(
      table.authorizationId,
      table.occurredAt,
    ),
  ],
);

export const commerceOperations = pgTable(
  "commerce_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => commerceAgreements.id, { onDelete: "restrict" }),
    activationId: uuid("activation_id").references(() => activations.id, {
      onDelete: "restrict",
    }),
    executionRequestId: uuid("execution_request_id").references(
      () => executionRequests.id,
      { onDelete: "restrict" },
    ),
    operationType: commerceOperationType("operation_type").notNull(),
    state: commerceOperationState("state").notNull().default("CREATED"),
    idempotencyKey: text("idempotency_key").notNull(),
    attempt: integer("attempt").notNull().default(1),
    preparedPayloadHash: text("prepared_payload_hash"),
    signerAddress: text("signer_address"),
    nonce: bigint("nonce", { mode: "bigint" }),
    transactionHash: text("transaction_hash"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    blockHash: text("block_hash"),
    confirmationCount: integer("confirmation_count").notNull().default(0),
    finalityState: commerceFinalityState("finality_state")
      .notNull()
      .default("UNCONFIRMED"),
    replacementOperationId: uuid("replacement_operation_id"),
    retryCount: integer("retry_count").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    failure: jsonb("failure"),
    evidence: jsonb("evidence").notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commerce_operation_idempotency_unique").on(
      table.agreementId,
      table.idempotencyKey,
    ),
    uniqueIndex("commerce_operation_attempt_unique").on(
      table.agreementId,
      table.operationType,
      table.attempt,
    ),
    index("commerce_operation_worker_idx").on(
      table.state,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    index("commerce_operation_transaction_idx").on(table.transactionHash),
  ],
);

export const commerceValueMovements = pgTable(
  "commerce_value_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => commerceAgreements.id, { onDelete: "restrict" }),
    activationId: uuid("activation_id").references(() => activations.id, {
      onDelete: "restrict",
    }),
    executionRequestId: uuid("execution_request_id").references(
      () => executionRequests.id,
      { onDelete: "restrict" },
    ),
    sourceOperationId: uuid("source_operation_id").references(
      () => commerceOperations.id,
      { onDelete: "restrict" },
    ),
    movementType: commerceValueMovementType("movement_type").notNull(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: text("token_address").notNull(),
    tokenDecimals: integer("token_decimals").notNull(),
    amountBaseUnits: numeric("amount_base_units", {
      precision: 78,
      scale: 0,
    }).notNull(),
    payerAddress: text("payer_address"),
    payeeAddress: text("payee_address"),
    transactionHash: text("transaction_hash"),
    logIndex: integer("log_index"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    blockHash: text("block_hash"),
    finalityState: commerceFinalityState("finality_state")
      .notNull()
      .default("UNCONFIRMED"),
    provenance: provenanceKind("provenance").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("commerce_value_chain_event_unique").on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
      table.movementType,
    ),
    index("commerce_value_agreement_type_idx").on(
      table.agreementId,
      table.movementType,
    ),
  ],
);

export const settlementRecords = pgTable(
  "settlement_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => commerceAgreements.id, { onDelete: "restrict" }),
    activationId: uuid("activation_id").references(() => activations.id, {
      onDelete: "restrict",
    }),
    executionRequestId: uuid("execution_request_id").references(
      () => executionRequests.id,
      { onDelete: "restrict" },
    ),
    status: settlementStatus("status").notNull().default("PENDING"),
    expectedAmountBaseUnits: numeric("expected_amount_base_units", {
      precision: 78,
      scale: 0,
    }).notNull(),
    fundedAmountBaseUnits: numeric("funded_amount_base_units", {
      precision: 78,
      scale: 0,
    })
      .notNull()
      .default("0"),
    settledAmountBaseUnits: numeric("settled_amount_base_units", {
      precision: 78,
      scale: 0,
    })
      .notNull()
      .default("0"),
    refundedAmountBaseUnits: numeric("refunded_amount_base_units", {
      precision: 78,
      scale: 0,
    })
      .notNull()
      .default("0"),
    feeAmountBaseUnits: numeric("fee_amount_base_units", {
      precision: 78,
      scale: 0,
    })
      .notNull()
      .default("0"),
    tokenAddress: text("token_address").notNull(),
    tokenDecimals: integer("token_decimals").notNull(),
    evidence: jsonb("evidence").notNull().default({}),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("settlement_agreement_activation_unique").on(
      table.agreementId,
      table.activationId,
    ),
    index("settlement_status_time_idx").on(table.status, table.updatedAt),
  ],
);

export const commerceArtifacts = pgTable(
  "commerce_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => commerceAgreements.id, { onDelete: "restrict" }),
    activationId: uuid("activation_id").references(() => activations.id, {
      onDelete: "restrict",
    }),
    executionRequestId: uuid("execution_request_id").references(
      () => executionRequests.id,
      { onDelete: "restrict" },
    ),
    artifactType: commerceArtifactType("artifact_type").notNull(),
    source: text("source").notNull(),
    contentHash: text("content_hash").notNull(),
    contentReference: text("content_reference"),
    safeContent: jsonb("safe_content"),
    provenance: provenanceKind("provenance").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("commerce_artifact_content_unique").on(
      table.agreementId,
      table.artifactType,
      table.contentHash,
    ),
    index("commerce_artifact_activation_idx").on(table.activationId),
  ],
);

export const commerceReputationObservations = pgTable(
  "commerce_reputation_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    agreementId: uuid("agreement_id").references(() => commerceAgreements.id, {
      onDelete: "restrict",
    }),
    activationId: uuid("activation_id").references(() => activations.id, {
      onDelete: "restrict",
    }),
    kind: text("kind").notNull(),
    value: jsonb("value").notNull(),
    provenance: provenanceKind("provenance").notNull(),
    evidenceReference: jsonb("evidence_reference").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("commerce_reputation_agent_kind_time_idx").on(
      table.agentId,
      table.kind,
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
