CREATE TABLE IF NOT EXISTS "seller_marketplace_profiles" (
  "agent_id" uuid PRIMARY KEY NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "description" text NOT NULL,
  "image_url" text,
  "updated_by_principal_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "seller_marketplace_profile_principal_idx"
  ON "seller_marketplace_profiles" USING btree ("updated_by_principal_id");
