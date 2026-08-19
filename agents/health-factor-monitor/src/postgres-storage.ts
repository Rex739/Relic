import { StorageProvider } from "@bnbagent/sdk/storage";
import postgres, { type Sql } from "postgres";

const jobIdFromLocation = (location: string): string => {
  const match =
    /erc8183-job-(\d+)\.json(?:$|[?#])/.exec(location) ??
    /\/job\/(\d+)\/response(?:$|[?#])/.exec(location);
  if (!match?.[1])
    throw new Error("Deliverable location does not contain an ERC-8183 job ID");
  return BigInt(match[1]).toString();
};

export class PostgresArtifactStorage extends StorageProvider {
  override readonly usesFileUrl = true;
  readonly #agentSlug: string;
  readonly #sql: Sql;

  constructor(databaseUrl: string, agentSlug: string) {
    super();
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
    await this.#sql`
      insert into reference_agent_artifacts (agent_slug, job_id, filename, content)
      values (${this.#agentSlug}, ${jobId}, ${filename}, ${JSON.stringify(data)}::jsonb)
      on conflict (agent_slug, job_id) do update
      set filename = excluded.filename,
          content = excluded.content,
          updated_at = now()
    `;
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
