CREATE TYPE "public"."agent_execution_job_status" AS ENUM(
  'FUNDED',
  'POLICY_ACCEPTED',
  'APPROVAL_SUBMITTED',
  'APPROVED',
  'SUPPLY_SUBMITTED',
  'SUPPLIED',
  'WITHDRAW_SUBMITTED',
  'COMPLETED',
  'REJECTED',
  'RECOVERY_REQUIRED'
);

CREATE TABLE "agent_execution_jobs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE RESTRICT,
  "commerce_job_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" "agent_execution_job_status" NOT NULL DEFAULT 'FUNDED',
  "revision" integer NOT NULL DEFAULT 0,
  "approval_tx_hash" text,
  "supply_tx_hash" text,
  "withdraw_tx_hash" text,
  "recovery_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "agent_execution_job_idempotency_unique"
  ON "agent_execution_jobs" USING btree ("agent_id", "idempotency_key");
CREATE UNIQUE INDEX "agent_execution_job_commerce_unique"
  ON "agent_execution_jobs" USING btree ("agent_id", "commerce_job_id");
CREATE INDEX "agent_execution_job_status_time_idx"
  ON "agent_execution_jobs" USING btree ("status", "updated_at");
