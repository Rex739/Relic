CREATE TYPE "public"."availability_status" AS ENUM('unknown', 'available', 'degraded', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provenance_kind" AS ENUM('onchain_verified', 'independently_observed', 'agent_reported', 'developer_declared');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_kind" AS ENUM('category', 'capability', 'tag', 'protocol', 'asset', 'chain');--> statement-breakpoint
CREATE TABLE "agent_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"standard" text NOT NULL,
	"namespace" text NOT NULL,
	"chain_id" integer NOT NULL,
	"registry_address" text NOT NULL,
	"external_agent_id" text NOT NULL,
	"owner_address" text NOT NULL,
	"registration_status" text NOT NULL,
	"registration_transaction" text,
	"registration_block" bigint,
	"registered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"capability" text,
	"description" text,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"pricing" jsonb,
	"endpoint" text,
	"sla" jsonb,
	"status" "availability_status" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_taxonomy" (
	"agent_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_taxonomy_agent_id_term_id_pk" PRIMARY KEY("agent_id","term_id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"website_url" text,
	"metadata_uri" text NOT NULL,
	"developer_identity" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" "availability_status" NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"last_successful_contact_at" timestamp with time zone,
	"latency_ms" double precision,
	"uptime_ratio" double precision,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"field_path" text NOT NULL,
	"provenance" "provenance_kind" NOT NULL,
	"source" text NOT NULL,
	"source_uri" text,
	"observed_at" timestamp with time zone NOT NULL,
	"chain_id" integer,
	"transaction_hash" text,
	"block_number" bigint,
	"content_hash" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"source_key" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "ingestion_status" NOT NULL,
	"error" jsonb,
	"normalized_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"unit" text,
	"window" text,
	"measured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reputation_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" jsonb NOT NULL,
	"scale" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxonomy_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "taxonomy_kind" NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_taxonomy" ADD CONSTRAINT "agent_taxonomy_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_taxonomy" ADD CONSTRAINT "agent_taxonomy_term_id_taxonomy_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."taxonomy_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_observations" ADD CONSTRAINT "availability_observations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_evidence" ADD CONSTRAINT "fact_evidence_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_records" ADD CONSTRAINT "ingestion_records_normalized_agent_id_agents_id_fk" FOREIGN KEY ("normalized_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_metrics" ADD CONSTRAINT "performance_metrics_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_signals" ADD CONSTRAINT "reputation_signals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identity_chain_unique" ON "agent_identities" USING btree ("namespace","chain_id","registry_address","external_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identity_agent_unique" ON "agent_identities" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_identity_owner_idx" ON "agent_identities" USING btree ("chain_id","owner_address");--> statement-breakpoint
CREATE INDEX "agent_services_agent_idx" ON "agent_services" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agents_name_idx" ON "agents" USING btree ("name");--> statement-breakpoint
CREATE INDEX "agents_updated_at_idx" ON "agents" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "availability_agent_time_idx" ON "availability_observations" USING btree ("agent_id","observed_at");--> statement-breakpoint
CREATE INDEX "fact_evidence_agent_field_idx" ON "fact_evidence" USING btree ("agent_id","field_path");--> statement-breakpoint
CREATE INDEX "ingestion_provider_source_idx" ON "ingestion_records" USING btree ("provider","source_key","fetched_at");--> statement-breakpoint
CREATE INDEX "performance_agent_key_time_idx" ON "performance_metrics" USING btree ("agent_id","key","measured_at");--> statement-breakpoint
CREATE INDEX "reputation_agent_kind_time_idx" ON "reputation_signals" USING btree ("agent_id","kind","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomy_kind_slug_unique" ON "taxonomy_terms" USING btree ("kind","slug");--> statement-breakpoint
INSERT INTO "taxonomy_terms" ("kind", "slug", "label", "is_core") VALUES
('category', 'rebalancing', 'Rebalancing', true),
('category', 'grid-trading', 'Grid Trading', true),
('category', 'yield-optimisation', 'Yield Optimisation', true),
('category', 'health-factor-monitoring', 'Health Factor Monitoring', true);
