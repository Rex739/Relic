import { sql } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";

type CountRow = { key: string; count: number };

const counts = (rows: CountRow[]) =>
  Object.fromEntries(rows.map((row) => [row.key, Number(row.count)]));

const withZeroes = (rows: CountRow[], keys: readonly string[]) => ({
  ...Object.fromEntries(keys.map((key) => [key, 0])),
  ...counts(rows),
});

export class DrizzleCorpusAnalytics {
  constructor(private readonly database: RelicDatabase) {}

  async report(chainId = 56): Promise<Record<string, unknown>> {
    const [
      totals,
      importState,
      profile,
      services,
      readiness,
      categories,
      provenance,
      reputation,
      endpoint,
      duplicates,
      malformed,
      owners,
      publishers,
      verification,
      conflicts,
      examples,
    ] = await Promise.all([
      this.database.execute<{
        agents: number;
        owners: number;
      }>(sql`
        select count(distinct csr.agent_id)::int as agents,
               count(distinct lower(ai.owner_address))::int as owners
        from corpus_source_records csr
        join agent_identities ai on ai.agent_id = csr.agent_id
        where csr.provider = '8004scan' and csr.chain_id = ${chainId}
      `),
      this.database.execute<{
        total_reported: number | null;
        next_page: number | null;
        page_size: number | null;
      }>(sql`
        select total_reported, next_page, page_size
        from corpus_import_checkpoints
        where provider = '8004scan' and chain_id = ${chainId}
        order by updated_at desc limit 1
      `),
      this.database.execute<CountRow>(sql`
        select key, count(*)::int as count from (
          select csr.agent_id,
            case when a.name is not null and length(trim(a.name)) > 0 then 'with_name' else 'without_name' end as key
          from corpus_source_records csr join agents a on a.id = csr.agent_id
          where csr.provider = '8004scan' and csr.chain_id = ${chainId}
          union all
          select csr.agent_id, case when a.description is not null and length(trim(a.description)) > 0 then 'with_description' else 'without_description' end
          from corpus_source_records csr join agents a on a.id = csr.agent_id
          where csr.provider = '8004scan' and csr.chain_id = ${chainId}
          union all
          select csr.agent_id, case when a.image_url is not null and length(trim(a.image_url)) > 0 then 'with_image' else 'without_image' end
          from corpus_source_records csr join agents a on a.id = csr.agent_id
          where csr.provider = '8004scan' and csr.chain_id = ${chainId}
          union all
          select csr.agent_id, case when exists(select 1 from metadata_history mh where mh.agent_id = csr.agent_id and mh.resolution_status = 'resolved') then 'resolvable_metadata' else 'metadata_not_verified_resolvable' end
          from corpus_source_records csr where csr.provider = '8004scan' and csr.chain_id = ${chainId}
          union all
          select distinct csr.agent_id, 'broken_metadata'
          from corpus_source_records csr join metadata_history mh on mh.agent_id = csr.agent_id
          where csr.provider = '8004scan' and csr.chain_id = ${chainId} and mh.resolution_status = 'failed'
          union all
          select csr.agent_id, 'empty_metadata'
          from corpus_source_records csr join agents a on a.id = csr.agent_id
          where csr.provider = '8004scan' and csr.chain_id = ${chainId}
            and length(trim(coalesce(a.name, ''))) = 0
            and length(trim(coalesce(a.description, ''))) = 0
            and length(trim(coalesce(a.image_url, ''))) = 0
        ) p group by key
      `),
      this.database.execute<CountRow>(sql`
        with corpus as (select agent_id from corpus_source_records where provider='8004scan' and chain_id=${chainId}),
        per_agent as (
          select c.agent_id, count(sd.id)::int as declarations,
            count(distinct sd.normalized_type)::int as types,
            bool_or(sd.malformed) as malformed
          from corpus c left join service_declarations sd on sd.agent_id=c.agent_id group by c.agent_id
        )
        select key, count(*)::int as count from (
          select agent_id, case when declarations > 0 then 'with_declarations' else 'no_services' end key from per_agent
          union all select agent_id, 'multiple_interfaces' from per_agent where types > 1
          union all select agent_id, 'malformed_declarations' from per_agent where malformed
          union all select distinct c.agent_id, sd.normalized_type from corpus c join service_declarations sd on sd.agent_id=c.agent_id
        ) s group by key
      `),
      this.database.execute<CountRow>(sql`
        select aqp.readiness as key, count(*)::int as count
        from agent_quality_profiles aqp join corpus_source_records csr on csr.agent_id=aqp.agent_id
        where csr.provider='8004scan' and csr.chain_id=${chainId}
        group by aqp.readiness
      `),
      this.database.execute<CountRow>(sql`
        with corpus as (select agent_id from corpus_source_records where provider='8004scan' and chain_id=${chainId})
        select tt.slug as key, count(distinct c.agent_id)::int as count
        from corpus c join agent_taxonomy at on at.agent_id=c.agent_id
        join taxonomy_terms tt on tt.id=at.term_id and tt.kind='category'
        group by tt.slug
        union all
        select 'uncategorized', count(*)::int from corpus c
        where not exists (
          select 1 from agent_taxonomy at join taxonomy_terms tt on tt.id=at.term_id
          where at.agent_id=c.agent_id and tt.kind='category'
        )
      `),
      this.database.execute<CountRow>(sql`
        with corpus as (select agent_id from corpus_source_records where provider='8004scan' and chain_id=${chainId}),
        evidence as (
          select fe.provenance::text as key from fact_evidence fe join corpus c on c.agent_id=fe.agent_id
          union all
          select 'independently_observed' from endpoint_observations eo join corpus c on c.agent_id=eo.agent_id
        )
        select key, count(*)::int as count from evidence group by key
      `),
      this.database.execute<CountRow>(sql`
        with corpus as (select agent_id from corpus_source_records where provider='8004scan' and chain_id=${chainId})
        select case when coalesce(ri.feedback_count,0) > 0 then 'with_feedback' else 'without_feedback' end as key,
          count(*)::int as count
        from corpus c left join reputation_inventory ri on ri.agent_id=c.agent_id and ri.source='8004scan'
        group by key
      `),
      this.database.execute<CountRow>(sql`
        select eo.status as key, count(*)::int as count
        from endpoint_observations eo join corpus_source_records csr on csr.agent_id=eo.agent_id
        where csr.provider='8004scan' and csr.chain_id=${chainId}
        group by eo.status
      `),
      this.database.execute<CountRow>(sql`
        select ds.kind as key, count(distinct ds.fingerprint)::int as count
        from duplicate_signals ds join corpus_source_records csr on csr.agent_id=ds.agent_id
        where csr.provider='8004scan' and csr.chain_id=${chainId}
        group by ds.kind
      `),
      this.database.execute<{ count: number }>(sql`
        select count(*)::int as count from ingestion_records
        where provider='8004scan' and status='failed'
      `),
      this.database.execute<CountRow>(sql`
        select agents_per_owner::text as key, count(*)::int as count from (
          select lower(ai.owner_address), count(*)::int agents_per_owner
          from corpus_source_records csr join agent_identities ai on ai.agent_id=csr.agent_id
          where csr.provider='8004scan' and csr.chain_id=${chainId}
          group by lower(ai.owner_address)
        ) o group by agents_per_owner order by agents_per_owner
      `),
      this.database.execute<{ owner: string; agents: number }>(sql`
        select lower(ai.owner_address) as owner, count(*)::int as agents
        from corpus_source_records csr join agent_identities ai on ai.agent_id=csr.agent_id
        where csr.provider='8004scan' and csr.chain_id=${chainId}
        group by lower(ai.owner_address) order by agents desc, owner limit 10
      `),
      this.database.execute<CountRow>(sql`
        with corpus as (select agent_id from corpus_source_records where provider='8004scan' and chain_id=${chainId})
        select coalesce(vq.status::text,'unverified') as key, count(*)::int as count
        from corpus c left join verification_queue vq on vq.agent_id=c.agent_id
        group by coalesce(vq.status::text,'unverified')
      `),
      this.database.execute<{ agents: number; observations: number }>(sql`
        select count(distinct vo.agent_id)::int as agents, count(*)::int as observations
        from verification_observations vo join corpus_source_records csr on csr.agent_id=vo.agent_id
        where csr.provider='8004scan' and csr.chain_id=${chainId}
          and vo.mismatches <> '{}'::jsonb and vo.mismatches <> '[]'::jsonb
      `),
      this.database.execute<{
        id: string;
        token_id: string;
        name: string | null;
        readiness: string | null;
        completeness: number | null;
        services: number;
        feedbacks: number;
      }>(sql`
        select a.id::text as id, ai.external_agent_id as token_id, a.name,
          aqp.readiness::text as readiness, aqp.completeness_percent as completeness,
          count(distinct sd.id)::int as services, coalesce(max(ri.feedback_count),0)::int as feedbacks
        from corpus_source_records csr
        join agents a on a.id=csr.agent_id
        join agent_identities ai on ai.agent_id=a.id
        left join agent_quality_profiles aqp on aqp.agent_id=a.id
        left join service_declarations sd on sd.agent_id=a.id
        left join reputation_inventory ri on ri.agent_id=a.id and ri.source='8004scan'
        where csr.provider='8004scan' and csr.chain_id=${chainId}
        group by a.id, ai.external_agent_id, a.name, aqp.readiness, aqp.completeness_percent
        order by aqp.completeness_percent desc nulls last, ai.external_agent_id
        limit 10
      `),
    ]);
    const total = Number(totals[0]?.agents ?? 0);
    const reported = importState[0]?.total_reported ?? null;
    return {
      generatedAt: new Date().toISOString(),
      chainId,
      sourceScope:
        "real persisted 8004scan BSC corpus plus Relic/direct observations",
      total: {
        importedAgents: total,
        uniqueOwners: Number(totals[0]?.owners ?? 0),
        sourceReportedAgents: reported,
        importCoveragePercent:
          reported == null || reported === 0
            ? null
            : Number(((total / reported) * 100).toFixed(4)),
        nextPage: importState[0]?.next_page ?? null,
        pageSize: importState[0]?.page_size ?? null,
        verification: counts(verification),
      },
      profile: withZeroes(profile, [
        "with_name",
        "without_name",
        "with_description",
        "without_description",
        "with_image",
        "without_image",
        "resolvable_metadata",
        "metadata_not_verified_resolvable",
        "broken_metadata",
        "empty_metadata",
      ]),
      services: {
        ...withZeroes(services, [
          "with_declarations",
          "no_services",
          "a2a",
          "mcp",
          "http-api",
          "oasf",
          "email",
          "x402",
          "multiple_interfaces",
          "malformed_declarations",
        ]),
        other_interfaces: services
          .filter((row) => row.key.startsWith("other:"))
          .reduce((total, row) => total + Number(row.count), 0),
      },
      readiness: withZeroes(readiness, [
        "NOT_READY",
        "PARTIAL",
        "DISCOVERABLE",
        "ACTIONABLE",
      ]),
      categories: withZeroes(categories, [
        "rebalancing",
        "grid-trading",
        "yield-optimisation",
        "health-factor-monitoring",
        "uncategorized",
      ]),
      provenance: withZeroes(provenance, [
        "onchain_verified",
        "independently_observed",
        "agent_reported",
        "developer_declared",
        "secondary_unverified",
      ]),
      reputation: counts(reputation),
      quality: {
        endpointAvailability: counts(endpoint),
        duplicateGroups: counts(duplicates),
        malformedRecords: Number(malformed[0]?.count ?? 0),
      },
      ownership: {
        agentsPerOwnerDistribution: counts(owners),
        largestPublishers: publishers.map((row) => ({
          owner: row.owner,
          agents: Number(row.agents),
        })),
      },
      conflicts: {
        agents: Number(conflicts[0]?.agents ?? 0),
        observations: Number(conflicts[0]?.observations ?? 0),
      },
      examples,
    };
  }
}
