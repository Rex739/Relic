CREATE TABLE IF NOT EXISTS "altana_session_authorizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mandate_id" uuid NOT NULL REFERENCES "mandates"("id") ON DELETE cascade,
  "principal_id" text NOT NULL,
  "chain_id" integer NOT NULL,
  "wallet_address" text,
  "session_address" text NOT NULL,
  "session_public_key" text NOT NULL,
  "encrypted_session_private_key" text NOT NULL,
  "permissions" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "grant_transaction_hash" text,
  "status" text NOT NULL DEFAULT 'PENDING',
  "granted_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "altana_session_authorization_mandate_unique"
  ON "altana_session_authorizations" ("mandate_id");
CREATE INDEX IF NOT EXISTS "altana_session_authorization_principal_status_idx"
  ON "altana_session_authorizations" ("principal_id", "status");
