CREATE TYPE "public"."corpus_import_status" AS ENUM('idle', 'running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."endpoint_observation_status" AS ENUM('reachable', 'unreachable', 'timeout', 'invalid', 'unsupported_protocol');--> statement-breakpoint
CREATE TYPE "public"."marketplace_readiness" AS ENUM('NOT_READY', 'PARTIAL', 'DISCOVERABLE', 'ACTIONABLE');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'pending', 'verified', 'partial', 'failed', 'stale');--> statement-breakpoint
ALTER TYPE "public"."provenance_kind" ADD VALUE 'secondary_unverified';--> statement-breakpoint
CREATE TABLE "agent_quality_profiles" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"completeness_percent" integer NOT NULL,
	"readiness" "marketplace_readiness" NOT NULL,
	"facts" jsonb NOT NULL,
	"rule_version" text NOT NULL,
	"profiled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classification_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"category_slug" text NOT NULL,
	"confidence" text NOT NULL,
	"evidence_type" text NOT NULL,
	"matched_source" text NOT NULL,
	"matched_value" text NOT NULL,
	"rule_version" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_import_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"chain_id" integer NOT NULL,
	"registry_address" text NOT NULL,
	"next_page" integer DEFAULT 1 NOT NULL,
	"page_size" integer NOT NULL,
	"total_reported" integer,
	"status" "corpus_import_status" DEFAULT 'idle' NOT NULL,
	"last_successful_run_at" timestamp with time zone,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_import_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"chain_id" integer NOT NULL,
	"registry_address" text NOT NULL,
	"start_page" integer NOT NULL,
	"end_page" integer,
	"page_size" integer NOT NULL,
	"status" "corpus_import_status" NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_reported" integer,
	"rate_limit" integer,
	"rate_limit_remaining" integer,
	"rate_limit_reset_at" timestamp with time zone,
	"error" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "corpus_source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"source_record_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"registry_address" text NOT NULL,
	"external_agent_id" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"group_size" integer NOT NULL,
	"details" jsonb NOT NULL,
	"rule_version" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoint_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"service_declaration_id" uuid,
	"endpoint" text NOT NULL,
	"status" "endpoint_observation_status" NOT NULL,
	"http_status" integer,
	"latency_ms" double precision,
	"redirect_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reputation_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"source" text NOT NULL,
	"feedback_count" integer DEFAULT 0 NOT NULL,
	"average_score" double precision,
	"star_count" integer DEFAULT 0 NOT NULL,
	"source_score" double precision,
	"raw" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"source" text NOT NULL,
	"raw_name" text NOT NULL,
	"normalized_type" text NOT NULL,
	"endpoint" text,
	"malformed" boolean DEFAULT false NOT NULL,
	"provenance" "provenance_kind" NOT NULL,
	"raw" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" "verification_status" NOT NULL,
	"block_number" bigint,
	"facts" jsonb NOT NULL,
	"mismatches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"error" jsonb,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_queue" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_block" bigint,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_quality_profiles" ADD CONSTRAINT "agent_quality_profiles_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_evidence" ADD CONSTRAINT "classification_evidence_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_source_records" ADD CONSTRAINT "corpus_source_records_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_signals" ADD CONSTRAINT "duplicate_signals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_observations" ADD CONSTRAINT "endpoint_observations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_observations" ADD CONSTRAINT "endpoint_observations_service_declaration_id_service_declarations_id_fk" FOREIGN KEY ("service_declaration_id") REFERENCES "public"."service_declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_inventory" ADD CONSTRAINT "reputation_inventory_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_declarations" ADD CONSTRAINT "service_declarations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_observations" ADD CONSTRAINT "verification_observations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_queue" ADD CONSTRAINT "verification_queue_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_quality_readiness_idx" ON "agent_quality_profiles" USING btree ("readiness");--> statement-breakpoint
CREATE UNIQUE INDEX "classification_evidence_rule_unique" ON "classification_evidence" USING btree ("agent_id","category_slug","matched_source","matched_value","rule_version");--> statement-breakpoint
CREATE UNIQUE INDEX "corpus_import_checkpoint_source_unique" ON "corpus_import_checkpoints" USING btree ("provider","chain_id","registry_address");--> statement-breakpoint
CREATE INDEX "corpus_import_runs_source_time_idx" ON "corpus_import_runs" USING btree ("provider","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "corpus_source_record_unique" ON "corpus_source_records" USING btree ("provider","source_record_id");--> statement-breakpoint
CREATE INDEX "corpus_source_agent_idx" ON "corpus_source_records" USING btree ("agent_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_signal_agent_rule_unique" ON "duplicate_signals" USING btree ("agent_id","kind","fingerprint","rule_version");--> statement-breakpoint
CREATE INDEX "duplicate_signal_kind_fingerprint_idx" ON "duplicate_signals" USING btree ("kind","fingerprint");--> statement-breakpoint
CREATE INDEX "endpoint_observation_agent_time_idx" ON "endpoint_observations" USING btree ("agent_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reputation_inventory_agent_source_unique" ON "reputation_inventory" USING btree ("agent_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "service_declaration_source_unique" ON "service_declarations" USING btree ("agent_id","source","raw_name","endpoint");--> statement-breakpoint
CREATE INDEX "service_declaration_type_idx" ON "service_declarations" USING btree ("normalized_type");--> statement-breakpoint
CREATE INDEX "verification_observation_agent_time_idx" ON "verification_observations" USING btree ("agent_id","observed_at");--> statement-breakpoint
CREATE INDEX "verification_queue_status_priority_idx" ON "verification_queue" USING btree ("status","priority");