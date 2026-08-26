import type { StorageProvider } from "@bnbagent/sdk/storage";
import postgres, { type Sql } from "postgres";

const jobIdFromLocation = (location: string): string => {
  const match =
    /erc8183-job-(\d+)\.json(?:$|[?#])/.exec(location) ??
    /\/job\/(\d+)\/response(?:$|[?#])/.exec(location);
  if (!match?.[1])
    throw new Error("Deliverable location does not contain an ERC-8183 job ID");
  return BigInt(match[1]).toString();
};

export class PostgresArtifactStorage implements StorageProvider {
  readonly usesFileUrl = true;
  readonly #agentSlug: string;
  readonly #sql: Sql;

  constructor(databaseUrl: string, agentSlug: string) {
    this.#agentSlug = agentSlug;
    this.#sql = postgres(databaseUrl, {
      max: 2,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  async verify() {
    await this.#sql`select 1 from reference_agent_artifacts limit 1`;
  }

  async upload(data: Record<string, unknown>, filename?: string) {
    if (!filename)
      throw new Error("A deterministic deliverable filename is required");
    const jobId = jobIdFromLocation(filename);
    const inserted = await this.#sql<Array<{ inserted: boolean }>>`
      insert into reference_agent_artifacts (agent_slug, job_id, filename, content)
      values (${this.#agentSlug}, ${jobId}, ${filename}, ${JSON.stringify(data)}::jsonb)
      on conflict (agent_slug, job_id) do nothing
      returning true as inserted
    `;
    if (inserted.length === 0) {
      const existing = await this.#sql<Array<{ matches: boolean }>>`
        select filename = ${filename}
          and content = ${JSON.stringify(data)}::jsonb as matches
        from reference_agent_artifacts
        where agent_slug = ${this.#agentSlug} and job_id = ${jobId}
        limit 1
      `;
      if (existing[0]?.matches !== true)
        throw new Error(
          `Immutable deliverable already exists for ERC-8183 job ${jobId}`,
        );
    }
    return `file:///${filename}`;
  }

  async download(location: string) {
    const jobId = jobIdFromLocation(location);
    const rows = await this.#sql<Array<{ content: string }>>`
      select content::text as content
      from reference_agent_artifacts
      where agent_slug = ${this.#agentSlug} and job_id = ${jobId}
      limit 1
    `;
    const row = rows[0];
    if (!row)
      throw new Error(`No persisted deliverable exists for job ${jobId}`);
    return JSON.parse(row.content) as Record<string, unknown>;
  }

  async exists(location: string) {
    const jobId = jobIdFromLocation(location);
    const rows = await this.#sql<Array<{ present: boolean }>>`
      select exists(
        select 1 from reference_agent_artifacts
        where agent_slug = ${this.#agentSlug} and job_id = ${jobId}
      ) as present
    `;
    return rows[0]?.present === true;
  }

  async close() {
    await this.#sql.end();
  }
}
