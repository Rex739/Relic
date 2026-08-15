CREATE TYPE "public"."activation_status" AS ENUM('PREPARED', 'TERMS_RESOLVED', 'JOB_CREATED', 'FUNDED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."launch_candidate_status" AS ENUM('DISCOVERED', 'REVIEW_PENDING', 'IDENTITY_VERIFIED', 'SERVICE_IDENTIFIED', 'SERVICE_OBSERVED', 'INVOCATION_VERIFIED', 'ACTIONABLE', 'REJECTED', 'STALE');--> statement-breakpoint
CREATE TYPE "public"."service_verification_level" AS ENUM('DECLARED', 'ENDPOINT_OBSERVED', 'SCHEMA_UNDERSTOOD', 'PAYMENT_UNDERSTOOD', 'INVOCATION_VERIFIED', 'COMMERCE_VERIFIED');--> statement-breakpoint
CREATE TABLE "activation_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activation_id" uuid NOT NULL,
	"status" "activation_status" NOT NULL,
	"transaction_hash" text,
	"block_number" bigint,
	"evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"status" "activation_status" DEFAULT 'PREPARED' NOT NULL,
	"external_job_id" text,
	"commerce_address" text,
	"client_address" text,
	"provider_address" text,
	"evaluator_address" text,
	"budget" text,
	"currency_token" text,
	"description_hash" text,
	"result_reference" text,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_candidate_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"from_status" "launch_candidate_status",
	"to_status" "launch_candidate_status" NOT NULL,
	"evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"category_slug" text NOT NULL,
	"status" "launch_candidate_status" DEFAULT 'DISCOVERED' NOT NULL,
	"confidence" text NOT NULL,
	"source" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"rejection_reason" text,
	"last_reviewed_at" timestamp with time zone,
	"stale_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"source_declaration_id" uuid,
	"source_service_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"capability" text,
	"category_slug" text,
	"interface_protocol" text NOT NULL,
	"endpoint" text,
	"http_method" text,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"pricing" jsonb,
	"currency_token" text,
	"network_chain_id" integer,
	"sla" jsonb,
	"authentication_requirements" jsonb,
	"protocol_support" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"availability" "availability_status" DEFAULT 'unknown' NOT NULL,
	"verification_level" "service_verification_level" DEFAULT 'DECLARED' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"source" text NOT NULL,
	"provenance" "provenance_kind" NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_verification_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"from_level" "service_verification_level" NOT NULL,
	"to_level" "service_verification_level" NOT NULL,
	"result" text NOT NULL,
	"protocol" text NOT NULL,
	"request_method" text,
	"http_status" integer,
	"latency_ms" double precision,
	"evidence" jsonb NOT NULL,
	"error" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targeted_discovery_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"candidate_id" uuid,
	"source_record_id" text NOT NULL,
	"rank" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"search_evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targeted_discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"chain_id" integer NOT NULL,
	"category_slug" text NOT NULL,
	"query" text NOT NULL,
	"status" "corpus_import_status" NOT NULL,
	"returned_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"rate_limit" integer,
	"rate_limit_remaining" integer,
	"rate_limit_reset_at" timestamp with time zone,
	"error" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activation_transitions" ADD CONSTRAINT "activation_transitions_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_service_id_marketplace_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."marketplace_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_candidate_transitions" ADD CONSTRAINT "launch_candidate_transitions_candidate_id_launch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."launch_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_candidates" ADD CONSTRAINT "launch_candidates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_services" ADD CONSTRAINT "marketplace_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_services" ADD CONSTRAINT "marketplace_services_source_declaration_id_service_declarations_id_fk" FOREIGN KEY ("source_declaration_id") REFERENCES "public"."service_declarations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_verification_observations" ADD CONSTRAINT "service_verification_observations_service_id_marketplace_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."marketplace_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targeted_discovery_records" ADD CONSTRAINT "targeted_discovery_records_run_id_targeted_discovery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."targeted_discovery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targeted_discovery_records" ADD CONSTRAINT "targeted_discovery_records_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targeted_discovery_records" ADD CONSTRAINT "targeted_discovery_records_candidate_id_launch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."launch_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activation_transition_time_idx" ON "activation_transitions" USING btree ("activation_id","observed_at");--> statement-breakpoint
CREATE INDEX "activation_service_status_idx" ON "activations" USING btree ("service_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "activation_chain_job_unique" ON "activations" USING btree ("chain_id","commerce_address","external_job_id");--> statement-breakpoint
CREATE INDEX "launch_candidate_transition_time_idx" ON "launch_candidate_transitions" USING btree ("candidate_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "launch_candidate_agent_category_unique" ON "launch_candidates" USING btree ("agent_id","category_slug");--> statement-breakpoint
CREATE INDEX "launch_candidate_category_status_idx" ON "launch_candidates" USING btree ("category_slug","status");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_service_source_unique" ON "marketplace_services" USING btree ("agent_id","source","source_service_id");--> statement-breakpoint
CREATE INDEX "marketplace_service_verification_idx" ON "marketplace_services" USING btree ("verification_level","category_slug");--> statement-breakpoint
CREATE INDEX "marketplace_service_agent_idx" ON "marketplace_services" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "service_verification_service_time_idx" ON "service_verification_observations" USING btree ("service_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "targeted_discovery_run_record_unique" ON "targeted_discovery_records" USING btree ("run_id","source_record_id");--> statement-breakpoint
CREATE INDEX "targeted_discovery_agent_idx" ON "targeted_discovery_records" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "targeted_discovery_category_time_idx" ON "targeted_discovery_runs" USING btree ("category_slug","started_at");