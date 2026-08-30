CREATE TYPE "public"."marketplace_review_role" AS ENUM('BUYER', 'AGENT');--> statement-breakpoint
CREATE TYPE "public"."marketplace_review_sentiment" AS ENUM('GOOD', 'BAD');--> statement-breakpoint
CREATE TYPE "public"."marketplace_review_subject_type" AS ENUM('AGENT', 'BUYER');--> statement-breakpoint
CREATE TABLE "marketplace_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activation_id" uuid NOT NULL,
	"commerce_agreement_id" uuid NOT NULL,
	"reviewer_principal_id" text NOT NULL,
	"reviewer_role" "marketplace_review_role" NOT NULL,
	"subject_type" "marketplace_review_subject_type" NOT NULL,
	"subject_agent_id" uuid,
	"subject_principal_id" text,
	"sentiment" "marketplace_review_sentiment" NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text,
	"marketplace_history_eligible" boolean DEFAULT true NOT NULL,
	"eligibility_provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_activation_id_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_commerce_agreement_id_commerce_agreements_id_fk" FOREIGN KEY ("commerce_agreement_id") REFERENCES "public"."commerce_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_subject_agent_id_agents_id_fk" FOREIGN KEY ("subject_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_review_role_subject_unique" ON "marketplace_reviews" USING btree ("activation_id","reviewer_role","subject_type");--> statement-breakpoint
CREATE INDEX "marketplace_review_agent_time_idx" ON "marketplace_reviews" USING btree ("subject_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "marketplace_review_buyer_time_idx" ON "marketplace_reviews" USING btree ("subject_principal_id","created_at");