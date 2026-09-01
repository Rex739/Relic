ALTER TABLE "agent_submissions" ADD COLUMN "registry_address" text;--> statement-breakpoint
ALTER TABLE "agent_submissions" ADD COLUMN "relic_principal_id" text;--> statement-breakpoint
UPDATE "agent_submissions"
SET "registry_address" = CASE "chain_id"
  WHEN 56 THEN '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
  WHEN 97 THEN '0x8004A818BFB912233c491871b3d84c89A494BD9e'
END
WHERE "registry_address" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_submissions" ALTER COLUMN "registry_address" SET NOT NULL;--> statement-breakpoint
DROP INDEX "agent_submission_chain_identity_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "agent_submission_chain_identity_unique" ON "agent_submissions" USING btree ("chain_id","registry_address","external_agent_id");--> statement-breakpoint

ALTER TABLE "ownership_challenges" ADD COLUMN "principal_id" text;--> statement-breakpoint
ALTER TABLE "ownership_challenges" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "ownership_challenges" ADD COLUMN "registry_address" text;--> statement-breakpoint
ALTER TABLE "ownership_challenges" ADD COLUMN "external_agent_id" text;--> statement-breakpoint
ALTER TABLE "ownership_challenges" ADD COLUMN "issued_at" timestamp with time zone;--> statement-breakpoint
UPDATE "ownership_challenges" challenge
SET
  "chain_id" = submission."chain_id",
  "registry_address" = submission."registry_address",
  "external_agent_id" = submission."external_agent_id",
  "issued_at" = challenge."created_at"
FROM "agent_submissions" submission
WHERE challenge."submission_id" = submission."id";--> statement-breakpoint

CREATE TABLE "seller_agent_authorizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "principal_id" text NOT NULL,
  "submission_id" uuid NOT NULL,
  "agent_id" uuid,
  "chain_id" integer NOT NULL,
  "registry_address" text NOT NULL,
  "external_agent_id" text NOT NULL,
  "verified_owner" text NOT NULL,
  "challenge_id" uuid NOT NULL,
  "verified_at" timestamp with time zone NOT NULL,
  "last_owner_checked_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revocation_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "seller_agent_authorizations" ADD CONSTRAINT "seller_agent_authorizations_submission_id_agent_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."agent_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_agent_authorizations" ADD CONSTRAINT "seller_agent_authorizations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_agent_authorizations" ADD CONSTRAINT "seller_agent_authorizations_challenge_id_ownership_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."ownership_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_agent_authorization_challenge_unique" ON "seller_agent_authorizations" USING btree ("challenge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_agent_authorization_active_identity_unique" ON "seller_agent_authorizations" USING btree ("chain_id","registry_address","external_agent_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "seller_agent_authorization_principal_idx" ON "seller_agent_authorizations" USING btree ("principal_id","revoked_at");--> statement-breakpoint
CREATE INDEX "seller_agent_authorization_identity_idx" ON "seller_agent_authorizations" USING btree ("chain_id","registry_address","external_agent_id");--> statement-breakpoint

ALTER TABLE public.seller_agent_authorizations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.seller_agent_authorizations FROM anon, authenticated;
