CREATE TABLE "kernel_session_authorizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mandate_id" uuid NOT NULL REFERENCES "mandates"("id") ON DELETE CASCADE,
  "principal_id" text NOT NULL,
  "chain_id" integer NOT NULL,
  "owner_address" text,
  "smart_account_address" text,
  "session_address" text NOT NULL,
  "session_public_key" text NOT NULL,
  "encrypted_session_private_key" text NOT NULL,
  "encrypted_permission_account" text,
  "permissions" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "owner_confirmed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "kernel_session_authorization_mandate_unique" ON "kernel_session_authorizations" USING btree ("mandate_id");
CREATE INDEX "kernel_session_authorization_principal_status_idx" ON "kernel_session_authorizations" USING btree ("principal_id", "status");
