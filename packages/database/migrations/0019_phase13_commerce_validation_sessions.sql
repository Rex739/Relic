DO $$ BEGIN
  CREATE TYPE "commerce_validation_session_status" AS ENUM (
    'OPEN',
    'CLAIMED',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "commerce_validation_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "offer_id" uuid NOT NULL REFERENCES "agent_offers"("id") ON DELETE restrict,
  "offer_version_id" uuid NOT NULL REFERENCES "agent_offer_versions"("id") ON DELETE restrict,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE restrict,
  "service_id" uuid NOT NULL REFERENCES "marketplace_services"("id") ON DELETE restrict,
  "chain_id" integer NOT NULL,
  "seller_principal_id" text NOT NULL,
  "buyer_principal_id" text,
  "mandate_id" uuid REFERENCES "mandates"("id") ON DELETE restrict,
  "agreement_id" uuid REFERENCES "commerce_agreements"("id") ON DELETE restrict,
  "handoff_token_hash" text NOT NULL,
  "status" "commerce_validation_session_status" DEFAULT 'OPEN' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "completed_activation_id" uuid REFERENCES "activations"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "commerce_validation_session_token_unique"
  ON "commerce_validation_sessions" ("handoff_token_hash");
CREATE INDEX IF NOT EXISTS "commerce_validation_session_offer_status_idx"
  ON "commerce_validation_sessions" ("offer_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "commerce_validation_session_buyer_idx"
  ON "commerce_validation_sessions" ("buyer_principal_id", "status");
