CREATE TABLE "authorization_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"principal_id" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "authorization_challenges" ADD CONSTRAINT "authorization_challenges_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_challenge_nonce_unique" ON "authorization_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "authorization_challenge_agreement_expiry_idx" ON "authorization_challenges" USING btree ("agreement_id","expires_at");--> statement-breakpoint
ALTER TABLE public.authorization_challenges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.authorization_challenges FROM anon, authenticated;
