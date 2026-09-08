CREATE TYPE "public"."health_guard_cycle_status" AS ENUM(
  'OBSERVED',
  'NO_ACTION',
  'POLICY_ACCEPTED',
  'APPROVAL_SUBMITTED',
  'APPROVED',
  'REPAY_SUBMITTED',
  'COMPLETED',
  'RECOVERY_REQUIRED'
);

CREATE TABLE "health_guard_cycles" (
  "id" uuid PRIMARY KEY NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE RESTRICT,
  "commerce_job_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" "health_guard_cycle_status" NOT NULL DEFAULT 'OBSERVED',
  "revision" integer NOT NULL DEFAULT 0,
  "observed_at" timestamp with time zone NOT NULL,
  "health_factor_wad" numeric(78, 0) NOT NULL,
  "outstanding_debt_base_units" numeric(78, 0) NOT NULL,
  "rescue_wallet_balance_base_units" numeric(78, 0) NOT NULL,
  "decision_reason" text,
  "repay_amount_base_units" numeric(78, 0),
  "approval_tx_hash" text,
  "repayment_tx_hash" text,
  "recovery_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "health_guard_cycle_idempotency_unique"
  ON "health_guard_cycles" USING btree ("agent_id", "idempotency_key");
CREATE INDEX "health_guard_cycle_job_status_time_idx"
  ON "health_guard_cycles" USING btree ("agent_id", "commerce_job_id", "status", "updated_at");
