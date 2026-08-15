CREATE TYPE "public"."activation_lifecycle_state" AS ENUM('PREPARING', 'NEGOTIATING', 'AWAITING_AUTHORIZATION', 'ONCHAIN_CREATED', 'ACTIVE', 'DELIVERED', 'SETTLING', 'COMPLETED', 'REJECTED', 'REFUNDED', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('SUBMITTED', 'IDENTITY_CHECK', 'METADATA_CHECK', 'SERVICE_DISCOVERY', 'SERVICE_VERIFICATION', 'COMMERCE_PREFLIGHT', 'ACTIONABLE', 'BLOCKED', 'REJECTED', 'STALE');--> statement-breakpoint
CREATE TYPE "public"."supply_type" AS ENUM('third_party', 'partner', 'relic_reference');--> statement-breakpoint
CREATE TABLE "activation_lifecycle_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activation_id" uuid NOT NULL,
	"from_state" "activation_lifecycle_state",
	"to_state" "activation_lifecycle_state" NOT NULL,
	"evidence" jsonb NOT NULL,
	"transaction_hash" text,
	"block_number" bigint,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"external_agent_id" text NOT NULL,
	"supply_type" "supply_type" DEFAULT 'third_party' NOT NULL,
	"submitter_address" text,
	"status" "submission_status" DEFAULT 'SUBMITTED' NOT NULL,
	"ownership_verified_at" timestamp with time zone,
	"agent_id" uuid,
	"candidate_id" uuid,
	"developer_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"invocation_successful" boolean NOT NULL,
	"commerce_successful" boolean NOT NULL,
	"execution_duration_ms" double precision,
	"response_status" text,
	"delivered_at" timestamp with time zone,
	"settlement_state" text NOT NULL,
	"observed_cost" text NOT NULL,
	"protocol_evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"nonce_hash" text NOT NULL,
	"message" text NOT NULL,
	"expected_owner" text NOT NULL,
	"signer_address" text,
	"signature_digest" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"from_status" "submission_status",
	"to_status" "submission_status" NOT NULL,
	"evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "lifecycle_state" "activation_lifecycle_state" DEFAULT 'PREPARING' NOT NULL;--> statement-breakpoint
ALTER TABLE "launch_candidates" ADD COLUMN "supply_type" "supply_type" DEFAULT 'third_party' NOT NULL;--> statement-breakpoint
ALTER TABLE "activation_lifecycle_transitions" ADD CONSTRAINT "activation_lifecycle_transitions_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_submissions" ADD CONSTRAINT "agent_submissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_submissions" ADD CONSTRAINT "agent_submissions_candidate_id_launch_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."launch_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_outcomes" ADD CONSTRAINT "marketplace_outcomes_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_outcomes" ADD CONSTRAINT "marketplace_outcomes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_outcomes" ADD CONSTRAINT "marketplace_outcomes_service_id_marketplace_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."marketplace_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_challenges" ADD CONSTRAINT "ownership_challenges_submission_id_agent_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."agent_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_transitions" ADD CONSTRAINT "submission_transitions_submission_id_agent_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."agent_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activation_lifecycle_transition_time_idx" ON "activation_lifecycle_transitions" USING btree ("activation_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_submission_chain_identity_unique" ON "agent_submissions" USING btree ("chain_id","external_agent_id");--> statement-breakpoint
CREATE INDEX "agent_submission_type_status_idx" ON "agent_submissions" USING btree ("supply_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_outcome_activation_unique" ON "marketplace_outcomes" USING btree ("activation_id");--> statement-breakpoint
CREATE INDEX "marketplace_outcome_supply_metrics_idx" ON "marketplace_outcomes" USING btree ("agent_id","commerce_successful");--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_challenge_nonce_hash_unique" ON "ownership_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "ownership_challenge_submission_expiry_idx" ON "ownership_challenges" USING btree ("submission_id","expires_at");--> statement-breakpoint
CREATE INDEX "submission_transition_time_idx" ON "submission_transitions" USING btree ("submission_id","observed_at");