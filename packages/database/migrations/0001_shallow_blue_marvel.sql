CREATE TYPE "public"."indexer_status" AS ENUM('idle', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('match', 'mismatch', 'unavailable_direct', 'unavailable_secondary', 'stale_secondary', 'unverified_secondary');--> statement-breakpoint
CREATE TABLE "indexed_blocks" (
	"chain_id" integer NOT NULL,
	"registry_address" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"parent_hash" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_blocks_chain_id_registry_address_block_number_pk" PRIMARY KEY("chain_id","registry_address","block_number")
);
--> statement-breakpoint
CREATE TABLE "indexer_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"registry_address" text NOT NULL,
	"indexed_block" bigint NOT NULL,
	"indexed_block_hash" text,
	"safe_block" bigint NOT NULL,
	"status" "indexer_status" DEFAULT 'idle' NOT NULL,
	"last_successful_run_at" timestamp with time zone,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"chain_id" integer NOT NULL,
	"registry_address" text NOT NULL,
	"from_block" bigint,
	"to_block" bigint,
	"safe_block" bigint,
	"status" "indexer_status" NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metadata_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"metadata_uri" text NOT NULL,
	"content_hash" text,
	"payload" jsonb,
	"resolution_status" text NOT NULL,
	"error" jsonb,
	"observed_block" bigint,
	"observed_block_hash" text,
	"transaction_hash" text,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"previous_owner" text,
	"owner_address" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_chain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"event_name" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"transaction_index" integer NOT NULL,
	"log_index" integer NOT NULL,
	"external_agent_id" text,
	"decoded_payload" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	"status" "reconciliation_status" NOT NULL,
	"direct_value" jsonb,
	"secondary_value" jsonb,
	"secondary_provider" text NOT NULL,
	"secondary_observed_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "metadata_history" ADD CONSTRAINT "metadata_history_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "indexer_checkpoint_registry_unique" ON "indexer_checkpoints" USING btree ("chain_id","registry_address");--> statement-breakpoint
CREATE UNIQUE INDEX "metadata_history_observation_unique" ON "metadata_history" USING btree ("agent_id","metadata_uri","content_hash","observed_block");--> statement-breakpoint
CREATE INDEX "metadata_history_agent_time_idx" ON "metadata_history" USING btree ("agent_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_history_log_unique" ON "ownership_history" USING btree ("agent_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "ownership_history_agent_block_idx" ON "ownership_history" USING btree ("agent_id","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_chain_event_log_unique" ON "raw_chain_events" USING btree ("chain_id","contract_address","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "raw_chain_event_block_idx" ON "raw_chain_events" USING btree ("chain_id","contract_address","block_number");--> statement-breakpoint
CREATE INDEX "raw_chain_event_agent_idx" ON "raw_chain_events" USING btree ("chain_id","contract_address","external_agent_id");--> statement-breakpoint
CREATE INDEX "reconciliation_agent_status_idx" ON "reconciliation_records" USING btree ("agent_id","status");