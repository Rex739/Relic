CREATE TYPE "public"."mandate_approval_mode" AS ENUM('OBSERVE_ONLY', 'ASK_BEFORE_EXECUTION', 'PRE_AUTHORIZED');--> statement-breakpoint
CREATE TYPE "public"."mandate_authorization_boundary" AS ENUM('POLICY_ONLY', 'WALLET_AUTHORIZED');--> statement-breakpoint
CREATE TYPE "public"."mandate_principal_type" AS ENUM('DEVELOPMENT_SESSION', 'ACCOUNT', 'WALLET');--> statement-breakpoint
CREATE TYPE "public"."mandate_status" AS ENUM('DRAFT', 'REVIEWED', 'ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED', 'FAILED_ACTIVATION', 'SUPERSEDED');--> statement-breakpoint
CREATE TABLE "mandate_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"mandate_version_id" uuid,
	"event_type" text NOT NULL,
	"security_sensitive" boolean DEFAULT false NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_references" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandate_evidence_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_version_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"external_agent_id" text NOT NULL,
	"registry_address" text NOT NULL,
	"service_id" uuid NOT NULL,
	"service_endpoint" text NOT NULL,
	"verification_tier" text NOT NULL,
	"verification_timestamp" timestamp with time zone NOT NULL,
	"chain_id" integer NOT NULL,
	"capability_set" jsonb NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandate_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" "mandate_status" DEFAULT 'DRAFT' NOT NULL,
	"service_id" uuid NOT NULL,
	"objective" text NOT NULL,
	"allowed_capabilities" jsonb NOT NULL,
	"denied_capabilities" jsonb NOT NULL,
	"allowed_assets" jsonb NOT NULL,
	"allowed_protocols" jsonb NOT NULL,
	"allowed_contracts" jsonb NOT NULL,
	"per_action_limit" jsonb,
	"aggregate_limit" jsonb,
	"execution_frequency" jsonb,
	"start_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approval_mode" "mandate_approval_mode" NOT NULL,
	"risk_constraints" jsonb NOT NULL,
	"stop_conditions" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" text NOT NULL,
	"principal_type" "mandate_principal_type" NOT NULL,
	"agent_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"status" "mandate_status" DEFAULT 'DRAFT' NOT NULL,
	"authorization_boundary" "mandate_authorization_boundary" DEFAULT 'POLICY_ONLY' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"active_version" integer,
	"attention_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mandate_events" ADD CONSTRAINT "mandate_events_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_events" ADD CONSTRAINT "mandate_events_mandate_version_id_mandate_versions_id_fk" FOREIGN KEY ("mandate_version_id") REFERENCES "public"."mandate_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_evidence_bindings" ADD CONSTRAINT "mandate_evidence_bindings_mandate_version_id_mandate_versions_id_fk" FOREIGN KEY ("mandate_version_id") REFERENCES "public"."mandate_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_evidence_bindings" ADD CONSTRAINT "mandate_evidence_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_evidence_bindings" ADD CONSTRAINT "mandate_evidence_bindings_service_id_marketplace_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."marketplace_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_versions" ADD CONSTRAINT "mandate_versions_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_versions" ADD CONSTRAINT "mandate_versions_service_id_marketplace_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."marketplace_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mandate_event_time_idx" ON "mandate_events" USING btree ("mandate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "mandate_event_security_idx" ON "mandate_events" USING btree ("security_sensitive","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_evidence_version_unique" ON "mandate_evidence_bindings" USING btree ("mandate_version_id");--> statement-breakpoint
CREATE INDEX "mandate_evidence_agent_service_idx" ON "mandate_evidence_bindings" USING btree ("agent_id","service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_version_unique" ON "mandate_versions" USING btree ("mandate_id","version");--> statement-breakpoint
CREATE INDEX "mandate_version_state_idx" ON "mandate_versions" USING btree ("mandate_id","state");--> statement-breakpoint
CREATE INDEX "mandate_version_expiry_idx" ON "mandate_versions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mandate_principal_status_idx" ON "mandates" USING btree ("principal_id","status");--> statement-breakpoint
CREATE INDEX "mandate_agent_status_idx" ON "mandates" USING btree ("agent_id","status");--> statement-breakpoint

-- Mandates are server-side authorization records, not a Supabase Data API
-- surface. Preserve the hardened public-schema posture established in 0008.
ALTER TABLE public.mandates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.mandate_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.mandate_evidence_bindings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.mandate_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE
  public.mandates,
  public.mandate_versions,
  public.mandate_evidence_bindings,
  public.mandate_events
FROM anon, authenticated;
