CREATE TABLE "reference_agent_artifacts" (
	"agent_slug" text NOT NULL,
	"job_id" bigint NOT NULL,
	"filename" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_agent_artifacts_agent_slug_job_id_pk" PRIMARY KEY("agent_slug","job_id")
);
--> statement-breakpoint
CREATE INDEX "reference_agent_artifacts_updated_idx" ON "reference_agent_artifacts" USING btree ("updated_at");