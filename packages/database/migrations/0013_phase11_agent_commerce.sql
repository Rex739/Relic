CREATE TYPE "public"."activation_purpose" AS ENUM('VERIFICATION', 'USER_COMMERCE');--> statement-breakpoint
CREATE TYPE "public"."activation_reconciliation_state" AS ENUM('PENDING', 'CURRENT', 'STALE', 'REORGED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."authorization_type" AS ENUM('DEVELOPMENT_PRINCIPAL', 'WALLET_SIGNATURE', 'DELEGATED_AUTHORIZATION', 'SESSION_KEY', 'SMART_ACCOUNT_PERMISSION');--> statement-breakpoint
CREATE TYPE "public"."authorization_verification_status" AS ENUM('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."commerce_agreement_status" AS ENUM('DRAFT', 'TERMS_ACCEPTED', 'AUTHORIZATION_REQUIRED', 'AUTHORIZED', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."commerce_artifact_type" AS ENUM('NEGOTIATED_TERMS', 'ACCEPTED_TERMS', 'AUTHORIZATION', 'JOB_SPECIFICATION', 'DELIVERY', 'EVALUATION', 'SETTLEMENT', 'REJECTION', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."commerce_finality_state" AS ENUM('UNCONFIRMED', 'CONFIRMED', 'FINALIZED', 'REORGED');--> statement-breakpoint
CREATE TYPE "public"."commerce_operation_state" AS ENUM('CREATED', 'READY', 'AWAITING_SIGNATURE', 'SUBMITTED', 'PENDING', 'CONFIRMED', 'FINALIZED', 'FAILED', 'REPLACED', 'REORGED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."commerce_operation_type" AS ENUM('PREPARE_JOB', 'CREATE_JOB', 'REGISTER_JOB', 'SET_BUDGET', 'FUND', 'SUBMIT_DELIVERY', 'SETTLE', 'REJECT', 'CLAIM_REFUND', 'CANCEL');--> statement-breakpoint
CREATE TYPE "public"."commerce_value_movement_type" AS ENUM('FUNDING', 'ESCROW_LOCK', 'PAYMENT', 'REFUND', 'FEE', 'ESCROW_RELEASE');--> statement-breakpoint
CREATE TYPE "public"."offer_billing_model" AS ENUM('ONE_TIME', 'PER_EXECUTION', 'SUBSCRIPTION');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'DEACTIVATED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('PENDING', 'FUNDED', 'DELIVERED', 'EVALUATED', 'SETTLED', 'REJECTED', 'REFUNDED', 'FAILED', 'REORGED');--> statement-breakpoint
CREATE TABLE "agent_offer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"offer_version_id" uuid,
	"event_type" text NOT NULL,
	"actor_principal_id" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_offer_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"chain_id" integer NOT NULL,
	"capability" text NOT NULL,
	"billing_model" "offer_billing_model" NOT NULL,
	"price_base_units" numeric(78, 0) NOT NULL,
	"payment_token_address" text NOT NULL,
	"payment_token_decimals" integer NOT NULL,
	"currency_symbol" text NOT NULL,
	"terms_content" text NOT NULL,
	"terms_hash" text NOT NULL,
	"capability_snapshot" jsonb NOT NULL,
	"limitations_snapshot" jsonb NOT NULL,
	"evidence_reference" jsonb NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_principal_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"status" "offer_status" DEFAULT 'DRAFT' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorization_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" text NOT NULL,
	"agreement_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"mandate_version" integer NOT NULL,
	"execution_request_id" uuid,
	"authorization_type" "authorization_type" NOT NULL,
	"signer_address" text,
	"chain_id" integer NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"signature" text,
	"message_hash" text NOT NULL,
	"action_hash" text,
	"terms_hash" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"verification_status" "authorization_verification_status" DEFAULT 'PENDING' NOT NULL,
	"evidence_reference" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorization_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authorization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"verification_status" "authorization_verification_status" NOT NULL,
	"evidence" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_agreement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"agreement_version_id" uuid,
	"from_status" "commerce_agreement_status",
	"to_status" "commerce_agreement_status" NOT NULL,
	"event_type" text NOT NULL,
	"actor_principal_id" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_agreement_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "commerce_agreement_status" NOT NULL,
	"offer_version_id" uuid NOT NULL,
	"mandate_id" uuid,
	"mandate_version" integer,
	"terms_hash" text NOT NULL,
	"terms_snapshot" text NOT NULL,
	"pricing_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"offer_version_id" uuid NOT NULL,
	"mandate_id" uuid,
	"mandate_version" integer,
	"authorization_artifact_id" uuid,
	"status" "commerce_agreement_status" DEFAULT 'DRAFT' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"chain_id" integer NOT NULL,
	"terms_hash" text NOT NULL,
	"terms_snapshot" text NOT NULL,
	"pricing_snapshot" jsonb NOT NULL,
	"amount_base_units" numeric(78, 0) NOT NULL,
	"payment_token_address" text NOT NULL,
	"payment_token_decimals" integer NOT NULL,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"activation_id" uuid,
	"execution_request_id" uuid,
	"artifact_type" "commerce_artifact_type" NOT NULL,
	"source" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_reference" text,
	"safe_content" jsonb,
	"provenance" "provenance_kind" NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"activation_id" uuid,
	"execution_request_id" uuid,
	"operation_type" "commerce_operation_type" NOT NULL,
	"state" "commerce_operation_state" DEFAULT 'CREATED' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"prepared_payload_hash" text,
	"signer_address" text,
	"nonce" bigint,
	"transaction_hash" text,
	"block_number" bigint,
	"block_hash" text,
	"confirmation_count" integer DEFAULT 0 NOT NULL,
	"finality_state" "commerce_finality_state" DEFAULT 'UNCONFIRMED' NOT NULL,
	"replacement_operation_id" uuid,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"failure" jsonb,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_reputation_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"agreement_id" uuid,
	"activation_id" uuid,
	"kind" text NOT NULL,
	"value" jsonb NOT NULL,
	"provenance" "provenance_kind" NOT NULL,
	"evidence_reference" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_value_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"activation_id" uuid,
	"execution_request_id" uuid,
	"source_operation_id" uuid,
	"movement_type" "commerce_value_movement_type" NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" text NOT NULL,
	"token_decimals" integer NOT NULL,
	"amount_base_units" numeric(78, 0) NOT NULL,
	"payer_address" text,
	"payee_address" text,
	"transaction_hash" text,
	"log_index" integer,
	"block_number" bigint,
	"block_hash" text,
	"finality_state" "commerce_finality_state" DEFAULT 'UNCONFIRMED' NOT NULL,
	"provenance" "provenance_kind" NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"activation_id" uuid,
	"execution_request_id" uuid,
	"status" "settlement_status" DEFAULT 'PENDING' NOT NULL,
	"expected_amount_base_units" numeric(78, 0) NOT NULL,
	"funded_amount_base_units" numeric(78, 0) DEFAULT '0' NOT NULL,
	"settled_amount_base_units" numeric(78, 0) DEFAULT '0' NOT NULL,
	"refunded_amount_base_units" numeric(78, 0) DEFAULT '0' NOT NULL,
	"fee_amount_base_units" numeric(78, 0) DEFAULT '0' NOT NULL,
	"token_address" text NOT NULL,
	"token_decimals" integer NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"nonce_hash" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"session_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "purpose" "activation_purpose" DEFAULT 'VERIFICATION' NOT NULL;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "commerce_agreement_id" uuid;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "execution_request_id" uuid;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "mandate_id" uuid;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "mandate_version" integer;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "principal_id" text;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "accepted_terms_hash" text;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "budget_base_units" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "payment_token_decimals" integer;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "authorization_id" uuid;--> statement-breakpoint
ALTER TABLE "activations" ADD COLUMN "reconciliation_state" "activation_reconciliation_state" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_offer_events" ADD CONSTRAINT "agent_offer_events_offer_id_agent_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."agent_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_offer_events" ADD CONSTRAINT "agent_offer_events_offer_version_id_agent_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."agent_offer_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_offer_versions" ADD CONSTRAINT "agent_offer_versions_offer_id_agent_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."agent_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_offers" ADD CONSTRAINT "agent_offers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_offers" ADD CONSTRAINT "agent_offers_service_id_marketplace_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."marketplace_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_artifacts" ADD CONSTRAINT "authorization_artifacts_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_artifacts" ADD CONSTRAINT "authorization_artifacts_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_artifacts" ADD CONSTRAINT "authorization_artifacts_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_events" ADD CONSTRAINT "authorization_events_authorization_id_authorization_artifacts_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."authorization_artifacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreement_events" ADD CONSTRAINT "commerce_agreement_events_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreement_events" ADD CONSTRAINT "commerce_agreement_events_agreement_version_id_commerce_agreement_versions_id_fk" FOREIGN KEY ("agreement_version_id") REFERENCES "public"."commerce_agreement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreement_versions" ADD CONSTRAINT "commerce_agreement_versions_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreement_versions" ADD CONSTRAINT "commerce_agreement_versions_offer_version_id_agent_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."agent_offer_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreement_versions" ADD CONSTRAINT "commerce_agreement_versions_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreements" ADD CONSTRAINT "commerce_agreements_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreements" ADD CONSTRAINT "commerce_agreements_service_id_marketplace_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."marketplace_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreements" ADD CONSTRAINT "commerce_agreements_offer_id_agent_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."agent_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreements" ADD CONSTRAINT "commerce_agreements_offer_version_id_agent_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."agent_offer_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_agreements" ADD CONSTRAINT "commerce_agreements_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_artifacts" ADD CONSTRAINT "commerce_artifacts_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_artifacts" ADD CONSTRAINT "commerce_artifacts_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_artifacts" ADD CONSTRAINT "commerce_artifacts_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_operations" ADD CONSTRAINT "commerce_operations_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_operations" ADD CONSTRAINT "commerce_operations_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_operations" ADD CONSTRAINT "commerce_operations_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_reputation_observations" ADD CONSTRAINT "commerce_reputation_observations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_reputation_observations" ADD CONSTRAINT "commerce_reputation_observations_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_reputation_observations" ADD CONSTRAINT "commerce_reputation_observations_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_value_movements" ADD CONSTRAINT "commerce_value_movements_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_value_movements" ADD CONSTRAINT "commerce_value_movements_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_value_movements" ADD CONSTRAINT "commerce_value_movements_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_value_movements" ADD CONSTRAINT "commerce_value_movements_source_operation_id_commerce_operations_id_fk" FOREIGN KEY ("source_operation_id") REFERENCES "public"."commerce_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_execution_request_id_execution_requests_id_fk" FOREIGN KEY ("execution_request_id") REFERENCES "public"."execution_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_offer_event_time_idx" ON "agent_offer_events" USING btree ("offer_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_offer_version_unique" ON "agent_offer_versions" USING btree ("offer_id","version");--> statement-breakpoint
CREATE INDEX "agent_offer_version_terms_idx" ON "agent_offer_versions" USING btree ("terms_hash");--> statement-breakpoint
CREATE INDEX "agent_offer_agent_status_idx" ON "agent_offers" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "agent_offer_operator_status_idx" ON "agent_offers" USING btree ("operator_principal_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_nonce_unique" ON "authorization_artifacts" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "authorization_agreement_status_idx" ON "authorization_artifacts" USING btree ("agreement_id","verification_status");--> statement-breakpoint
CREATE INDEX "authorization_action_hash_idx" ON "authorization_artifacts" USING btree ("action_hash");--> statement-breakpoint
CREATE INDEX "authorization_event_time_idx" ON "authorization_events" USING btree ("authorization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "commerce_agreement_event_time_idx" ON "commerce_agreement_events" USING btree ("agreement_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_agreement_version_unique" ON "commerce_agreement_versions" USING btree ("agreement_id","version");--> statement-breakpoint
CREATE INDEX "commerce_agreement_principal_status_idx" ON "commerce_agreements" USING btree ("principal_id","status");--> statement-breakpoint
CREATE INDEX "commerce_agreement_offer_idx" ON "commerce_agreements" USING btree ("offer_version_id");--> statement-breakpoint
CREATE INDEX "commerce_agreement_mandate_idx" ON "commerce_agreements" USING btree ("mandate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_artifact_content_unique" ON "commerce_artifacts" USING btree ("agreement_id","artifact_type","content_hash");--> statement-breakpoint
CREATE INDEX "commerce_artifact_activation_idx" ON "commerce_artifacts" USING btree ("activation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_operation_idempotency_unique" ON "commerce_operations" USING btree ("agreement_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_operation_attempt_unique" ON "commerce_operations" USING btree ("agreement_id","operation_type","attempt");--> statement-breakpoint
CREATE INDEX "commerce_operation_worker_idx" ON "commerce_operations" USING btree ("state","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "commerce_operation_transaction_idx" ON "commerce_operations" USING btree ("transaction_hash");--> statement-breakpoint
CREATE INDEX "commerce_reputation_agent_kind_time_idx" ON "commerce_reputation_observations" USING btree ("agent_id","kind","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_value_chain_event_unique" ON "commerce_value_movements" USING btree ("chain_id","transaction_hash","log_index","movement_type");--> statement-breakpoint
CREATE INDEX "commerce_value_agreement_type_idx" ON "commerce_value_movements" USING btree ("agreement_id","movement_type");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_agreement_activation_unique" ON "settlement_records" USING btree ("agreement_id","activation_id");--> statement-breakpoint
CREATE INDEX "settlement_status_time_idx" ON "settlement_records" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_challenge_nonce_unique" ON "wallet_auth_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "wallet_challenge_address_expiry_idx" ON "wallet_auth_challenges" USING btree ("wallet_address","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_session_token_unique" ON "wallet_sessions" USING btree ("session_token_hash");--> statement-breakpoint
CREATE INDEX "wallet_session_principal_expiry_idx" ON "wallet_sessions" USING btree ("principal_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activation_execution_unique" ON "activations" USING btree ("execution_request_id");--> statement-breakpoint
CREATE INDEX "activation_agreement_lifecycle_idx" ON "activations" USING btree ("commerce_agreement_id","lifecycle_state");--> statement-breakpoint

-- Preserve existing Phase 05 verification jobs without attributing them to users.
UPDATE public.activations SET purpose = 'VERIFICATION' WHERE purpose = 'VERIFICATION';--> statement-breakpoint

ALTER TABLE public.activations
  ADD CONSTRAINT activations_commerce_agreement_id_fk
    FOREIGN KEY (commerce_agreement_id) REFERENCES public.commerce_agreements(id) ON DELETE RESTRICT,
  ADD CONSTRAINT activations_execution_request_id_fk
    FOREIGN KEY (execution_request_id) REFERENCES public.execution_requests(id) ON DELETE RESTRICT,
  ADD CONSTRAINT activations_mandate_id_fk
    FOREIGN KEY (mandate_id) REFERENCES public.mandates(id) ON DELETE RESTRICT,
  ADD CONSTRAINT activations_authorization_id_fk
    FOREIGN KEY (authorization_id) REFERENCES public.authorization_artifacts(id) ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE public.commerce_agreements
  ADD CONSTRAINT commerce_agreements_authorization_artifact_id_fk
    FOREIGN KEY (authorization_artifact_id) REFERENCES public.authorization_artifacts(id) ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE public.commerce_operations
  ADD CONSTRAINT commerce_operations_replacement_operation_id_fk
    FOREIGN KEY (replacement_operation_id) REFERENCES public.commerce_operations(id) ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE public.agent_offer_versions
  ADD CONSTRAINT agent_offer_versions_price_nonnegative CHECK (price_base_units >= 0),
  ADD CONSTRAINT agent_offer_versions_decimals_range CHECK (payment_token_decimals BETWEEN 0 AND 77),
  ADD CONSTRAINT agent_offer_versions_chain_supported CHECK (chain_id IN (56, 97));--> statement-breakpoint

ALTER TABLE public.commerce_agreements
  ADD CONSTRAINT commerce_agreements_amount_nonnegative CHECK (amount_base_units >= 0),
  ADD CONSTRAINT commerce_agreements_decimals_range CHECK (payment_token_decimals BETWEEN 0 AND 77),
  ADD CONSTRAINT commerce_agreements_chain_supported CHECK (chain_id IN (56, 97));--> statement-breakpoint

ALTER TABLE public.commerce_value_movements
  ADD CONSTRAINT commerce_value_movements_amount_nonnegative CHECK (amount_base_units >= 0),
  ADD CONSTRAINT commerce_value_movements_decimals_range CHECK (token_decimals BETWEEN 0 AND 77),
  ADD CONSTRAINT commerce_value_movements_chain_supported CHECK (chain_id IN (56, 97));--> statement-breakpoint

ALTER TABLE public.settlement_records
  ADD CONSTRAINT settlement_expected_nonnegative CHECK (expected_amount_base_units >= 0),
  ADD CONSTRAINT settlement_funded_nonnegative CHECK (funded_amount_base_units >= 0),
  ADD CONSTRAINT settlement_settled_nonnegative CHECK (settled_amount_base_units >= 0),
  ADD CONSTRAINT settlement_refunded_nonnegative CHECK (refunded_amount_base_units >= 0),
  ADD CONSTRAINT settlement_fee_nonnegative CHECK (fee_amount_base_units >= 0),
  ADD CONSTRAINT settlement_decimals_range CHECK (token_decimals BETWEEN 0 AND 77);--> statement-breakpoint

-- Commerce and wallet-session state is server-side only. No Supabase public
-- Data API role receives access, matching the hardened posture from migration 0008.
ALTER TABLE public.wallet_auth_challenges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.wallet_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.agent_offers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.agent_offer_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.agent_offer_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.commerce_agreements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.commerce_agreement_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.commerce_agreement_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.authorization_artifacts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.authorization_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.commerce_operations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.commerce_value_movements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.settlement_records ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.commerce_artifacts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.commerce_reputation_observations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE
  public.wallet_auth_challenges,
  public.wallet_sessions,
  public.agent_offers,
  public.agent_offer_versions,
  public.agent_offer_events,
  public.commerce_agreements,
  public.commerce_agreement_versions,
  public.commerce_agreement_events,
  public.authorization_artifacts,
  public.authorization_events,
  public.commerce_operations,
  public.commerce_value_movements,
  public.settlement_records,
  public.commerce_artifacts,
  public.commerce_reputation_observations
FROM anon, authenticated;
