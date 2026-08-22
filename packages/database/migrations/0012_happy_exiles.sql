CREATE TYPE "public"."execution_policy_decision" AS ENUM('ALLOW', 'REQUIRE_APPROVAL', 'DENY');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('REQUESTED', 'EVALUATING', 'APPROVAL_REQUIRED', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'DENIED', 'EXPIRED', 'CANCELLED', 'BLOCKED_STALE_AGENT');--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_request_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"mandate_version" integer NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(78, 18) NOT NULL,
	"state" text NOT NULL,
	"released_amount" numeric(78, 18) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_request_id" uuid NOT NULL,
	"principal_id" text NOT NULL,
	"normalized_hash" text NOT NULL,
	"approved" boolean NOT NULL,
	"authorization_kind" text DEFAULT 'DEVELOPMENT_API' NOT NULL,
	"wallet_authorization" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_policy_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_request_id" uuid NOT NULL,
	"decision" "execution_policy_decision" NOT NULL,
	"normalized_hash" text NOT NULL,
	"mandate_version" integer NOT NULL,
	"reasons" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_request_id" uuid NOT NULL,
	"source" text NOT NULL,
	"outcome" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"cost" numeric(78, 18),
	"transaction_hash" text,
	"job_id" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"mandate_version" integer NOT NULL,
	"agent_id" uuid NOT NULL,
	"principal_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"raw_request" jsonb NOT NULL,
	"normalized_action" jsonb NOT NULL,
	"normalized_hash" text NOT NULL,
	"status" "execution_status" DEFAULT 'REQUESTED' NOT NULL,
	"decision" "execution_policy_decision",
	"decision_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_request_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"executor_kind" text NOT NULL,
	"status" "execution_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_approvals" ADD CONSTRAINT "execution_approvals_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_policy_decisions" ADD CONSTRAINT "execution_policy_decisions_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_receipts" ADD CONSTRAINT "execution_receipts_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_requests" ADD CONSTRAINT "execution_requests_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_requests" ADD CONSTRAINT "execution_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_execution_unique" ON "budget_reservations" USING btree ("execution_request_id");--> statement-breakpoint
CREATE INDEX "budget_mandate_state_idx" ON "budget_reservations" USING btree ("mandate_id","mandate_version","state");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_approval_once_unique" ON "execution_approvals" USING btree ("execution_request_id");--> statement-breakpoint
CREATE INDEX "execution_approval_hash_idx" ON "execution_approvals" USING btree ("normalized_hash");--> statement-breakpoint
CREATE INDEX "execution_policy_request_idx" ON "execution_policy_decisions" USING btree ("execution_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_receipt_request_unique" ON "execution_receipts" USING btree ("execution_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_principal_idempotency_unique" ON "execution_requests" USING btree ("principal_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_normalized_hash_unique" ON "execution_requests" USING btree ("principal_id","normalized_hash");--> statement-breakpoint
CREATE INDEX "execution_mandate_time_idx" ON "execution_requests" USING btree ("mandate_id","created_at");--> statement-breakpoint
CREATE INDEX "execution_status_time_idx" ON "execution_requests" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_run_attempt_unique" ON "executions" USING btree ("execution_request_id","attempt");
--> statement-breakpoint

-- Execution control is server-side policy state, never a Supabase Data API surface.
ALTER TABLE public.execution_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.execution_policy_decisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.execution_approvals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.execution_receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.budget_reservations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE
  public.execution_requests,
  public.execution_policy_decisions,
  public.execution_approvals,
  public.executions,
  public.execution_receipts,
  public.budget_reservations
FROM anon, authenticated;
