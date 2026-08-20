ALTER TABLE "corpus_source_records" ADD COLUMN "enrichment_rule_version" text;--> statement-breakpoint
ALTER TABLE "corpus_source_records" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corpus_source_records" ADD COLUMN "enrichment_error" jsonb;