ALTER TABLE "corpus_import_checkpoints" ADD COLUMN "access_mode" text DEFAULT 'anonymous' NOT NULL;--> statement-breakpoint
ALTER TABLE "corpus_import_checkpoints" ADD COLUMN "operational_mode" text DEFAULT 'anonymous' NOT NULL;--> statement-breakpoint
ALTER TABLE "corpus_import_checkpoints" ADD COLUMN "rate_limit" integer;--> statement-breakpoint
ALTER TABLE "corpus_import_checkpoints" ADD COLUMN "rate_limit_remaining" integer;--> statement-breakpoint
ALTER TABLE "corpus_import_checkpoints" ADD COLUMN "rate_limit_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corpus_import_checkpoints" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corpus_import_runs" ADD COLUMN "access_mode" text DEFAULT 'anonymous' NOT NULL;--> statement-breakpoint
ALTER TABLE "corpus_import_runs" ADD COLUMN "operational_mode" text DEFAULT 'anonymous' NOT NULL;--> statement-breakpoint
ALTER TABLE "corpus_import_runs" ADD COLUMN "request_budget" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "corpus_import_runs" ADD COLUMN "request_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corpus_import_runs" ADD COLUMN "degraded_reason" text;--> statement-breakpoint
ALTER TABLE "corpus_import_checkpoints" ADD CONSTRAINT "corpus_checkpoint_access_mode_check" CHECK ("access_mode" IN ('anonymous', 'authenticated'));--> statement-breakpoint
ALTER TABLE "corpus_import_checkpoints" ADD CONSTRAINT "corpus_checkpoint_operational_mode_check" CHECK ("operational_mode" IN ('anonymous', 'authenticated', 'pro_authenticated', 'rate_limited_degraded'));--> statement-breakpoint
ALTER TABLE "corpus_import_runs" ADD CONSTRAINT "corpus_run_access_mode_check" CHECK ("access_mode" IN ('anonymous', 'authenticated'));--> statement-breakpoint
ALTER TABLE "corpus_import_runs" ADD CONSTRAINT "corpus_run_operational_mode_check" CHECK ("operational_mode" IN ('anonymous', 'authenticated', 'pro_authenticated', 'rate_limited_degraded'));--> statement-breakpoint
ALTER TABLE "corpus_import_runs" ADD CONSTRAINT "corpus_run_request_budget_check" CHECK ("request_budget" > 0);--> statement-breakpoint
ALTER TABLE "corpus_import_runs" ADD CONSTRAINT "corpus_run_request_count_check" CHECK ("request_count" >= 0 AND "request_count" <= "request_budget");
