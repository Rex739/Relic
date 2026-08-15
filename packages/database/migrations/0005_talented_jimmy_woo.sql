CREATE TABLE "activation_preflights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid,
	"chain_id" integer NOT NULL,
	"status" "activation_status" NOT NULL,
	"commerce_address" text NOT NULL,
	"payment_token" text,
	"contract_deployed" boolean NOT NULL,
	"transaction_attempted" boolean DEFAULT false NOT NULL,
	"evidence" jsonb NOT NULL,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activation_preflights" ADD CONSTRAINT "activation_preflights_service_id_marketplace_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."marketplace_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activation_preflight_status_time_idx" ON "activation_preflights" USING btree ("status","created_at");