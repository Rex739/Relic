-- Relic uses a direct server-side Postgres connection. These tables are not a
-- public Data API surface, so API roles receive no direct table privileges.
-- The owner connection and Supabase's bypass-RLS service_role remain usable.

ALTER TABLE public.activation_lifecycle_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_preflights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_quality_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classification_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpus_import_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpus_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpus_source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicate_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endpoint_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fact_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexed_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexer_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexer_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_candidate_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_chain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_agent_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_verification_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.targeted_discovery_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.targeted_discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomy_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.activation_lifecycle_transitions,
  public.activation_preflights,
  public.activation_transitions,
  public.activations,
  public.agent_identities,
  public.agent_quality_profiles,
  public.agent_services,
  public.agent_submissions,
  public.agent_taxonomy,
  public.agents,
  public.availability_observations,
  public.classification_evidence,
  public.corpus_import_checkpoints,
  public.corpus_import_runs,
  public.corpus_source_records,
  public.duplicate_signals,
  public.endpoint_observations,
  public.fact_evidence,
  public.indexed_blocks,
  public.indexer_checkpoints,
  public.indexer_runs,
  public.ingestion_records,
  public.launch_candidate_transitions,
  public.launch_candidates,
  public.marketplace_outcomes,
  public.marketplace_services,
  public.metadata_history,
  public.ownership_challenges,
  public.ownership_history,
  public.performance_metrics,
  public.raw_chain_events,
  public.reconciliation_records,
  public.reference_agent_artifacts,
  public.reputation_inventory,
  public.reputation_signals,
  public.service_declarations,
  public.service_verification_observations,
  public.submission_transitions,
  public.targeted_discovery_records,
  public.targeted_discovery_runs,
  public.taxonomy_terms,
  public.verification_observations,
  public.verification_queue
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE public.reconciliation_records_id_seq
FROM anon, authenticated;

-- Relic migrations run as postgres. Harden only that creator role's defaults;
-- leave Supabase-managed role configuration unchanged.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
