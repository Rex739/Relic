ALTER TABLE marketplace_services
  ADD COLUMN IF NOT EXISTS listing_status text NOT NULL DEFAULT 'NEEDS_VERIFICATION',
  ADD COLUMN IF NOT EXISTS listing_status_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS listing_is_hireable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS listing_status_updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS marketplace_services_listing_status_idx
  ON marketplace_services (listing_status, listing_is_hireable);

CREATE OR REPLACE FUNCTION refresh_marketplace_listing_status(service_uuid uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  service_row marketplace_services%ROWTYPE;
  has_current_offer boolean;
  has_paused_offer boolean;
  has_replaced_owner_offer boolean;
  next_status text;
  next_reasons jsonb;
BEGIN
  SELECT * INTO service_row FROM marketplace_services WHERE id = service_uuid;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM agent_offers offer
    JOIN agent_offer_versions version
      ON version.offer_id = offer.id AND version.version = offer.current_version
    WHERE offer.agent_id = service_row.agent_id
      AND offer.service_id = service_row.id
      AND offer.status = 'ACTIVE'
      AND version.effective_at <= now()
      AND (version.expires_at IS NULL OR version.expires_at > now())
      AND (
        NOT EXISTS (
          SELECT 1 FROM seller_agent_authorizations current_owner
          WHERE current_owner.agent_id = offer.agent_id
            AND current_owner.revoked_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM seller_agent_authorizations owner
          WHERE owner.agent_id = offer.agent_id
            AND owner.principal_id = offer.operator_principal_id
            AND owner.revoked_at IS NULL
        )
      )
  ) INTO has_current_offer;

  SELECT EXISTS (
    SELECT 1 FROM agent_offers offer
    WHERE offer.agent_id = service_row.agent_id
      AND offer.service_id = service_row.id
      AND offer.status = 'PAUSED'
      AND (
        NOT EXISTS (
          SELECT 1 FROM seller_agent_authorizations current_owner
          WHERE current_owner.agent_id = offer.agent_id
            AND current_owner.revoked_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM seller_agent_authorizations owner
          WHERE owner.agent_id = offer.agent_id
            AND owner.principal_id = offer.operator_principal_id
            AND owner.revoked_at IS NULL
        )
      )
  ) INTO has_paused_offer;

  SELECT EXISTS (
    SELECT 1 FROM agent_offers offer
    WHERE offer.agent_id = service_row.agent_id
      AND offer.service_id = service_row.id
      AND offer.status = 'ACTIVE'
      AND EXISTS (
        SELECT 1 FROM seller_agent_authorizations current_owner
        WHERE current_owner.agent_id = offer.agent_id
          AND current_owner.revoked_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM seller_agent_authorizations offer_owner
        WHERE offer_owner.agent_id = offer.agent_id
          AND offer_owner.principal_id = offer.operator_principal_id
          AND offer_owner.revoked_at IS NULL
      )
  ) INTO has_replaced_owner_offer;

  IF service_row.endpoint IS NULL
     OR service_row.endpoint !~ '^https://'
     OR service_row.availability <> 'available' THEN
    next_status := 'UNAVAILABLE';
    next_reasons := '["service_endpoint_unavailable"]'::jsonb;
  ELSIF service_row.verification_level NOT IN ('SCHEMA_UNDERSTOOD', 'INVOCATION_VERIFIED', 'COMMERCE_VERIFIED')
     OR service_row.last_verified_at IS NULL
     OR service_row.last_verified_at < now() - interval '7 days' THEN
    next_status := 'NEEDS_VERIFICATION';
    next_reasons := '["fresh_service_verification_required"]'::jsonb;
  ELSIF has_current_offer THEN
    next_status := 'LIVE';
    next_reasons := '[]'::jsonb;
  ELSIF has_replaced_owner_offer THEN
    next_status := 'OWNERSHIP_CHANGED';
    next_reasons := '["previous_seller_offer_requires_replacement"]'::jsonb;
  ELSIF has_paused_offer THEN
    next_status := 'PAUSED';
    next_reasons := '["offer_is_paused"]'::jsonb;
  ELSE
    next_status := 'READY_FOR_OFFER';
    next_reasons := '["active_marketplace_offer_required"]'::jsonb;
  END IF;

  UPDATE marketplace_services
  SET listing_status = next_status,
      listing_status_reasons = next_reasons,
      listing_is_hireable = next_status = 'LIVE',
      listing_status_updated_at = now()
  WHERE id = service_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_listing_status_from_service()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_marketplace_listing_status(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_listing_status_from_offer()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_marketplace_listing_status(NEW.service_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_listing_status_from_offer_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE service_uuid uuid;
BEGIN
  SELECT service_id INTO service_uuid FROM agent_offers WHERE id = NEW.offer_id;
  IF service_uuid IS NOT NULL THEN
    PERFORM refresh_marketplace_listing_status(service_uuid);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_listing_status_from_authorization()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE service_record record;
BEGIN
  IF NEW.agent_id IS NOT NULL THEN
    FOR service_record IN SELECT id FROM marketplace_services WHERE agent_id = NEW.agent_id LOOP
      PERFORM refresh_marketplace_listing_status(service_record.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_service_listing_status_trigger
AFTER INSERT OR UPDATE OF endpoint, availability, verification_level, last_verified_at
ON marketplace_services
FOR EACH ROW EXECUTE FUNCTION refresh_listing_status_from_service();

CREATE TRIGGER agent_offer_listing_status_trigger
AFTER INSERT OR UPDATE OF status, current_version
ON agent_offers
FOR EACH ROW EXECUTE FUNCTION refresh_listing_status_from_offer();

CREATE TRIGGER agent_offer_version_listing_status_trigger
AFTER INSERT OR UPDATE OF effective_at, expires_at
ON agent_offer_versions
FOR EACH ROW EXECUTE FUNCTION refresh_listing_status_from_offer_version();

CREATE TRIGGER seller_authorization_listing_status_trigger
AFTER INSERT OR UPDATE OF principal_id, agent_id, revoked_at
ON seller_agent_authorizations
FOR EACH ROW EXECUTE FUNCTION refresh_listing_status_from_authorization();

SELECT refresh_marketplace_listing_status(id) FROM marketplace_services;
