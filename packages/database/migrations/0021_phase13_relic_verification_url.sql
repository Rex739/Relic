ALTER TABLE "marketplace_services"
  ADD COLUMN IF NOT EXISTS "verification_url" text;

ALTER TABLE "agent_services"
  ADD COLUMN IF NOT EXISTS "verification_url" text;
