type FetchLike = typeof fetch;

/** Lists only Relic-validated, funded, active Mainnet Health Guard jobs. */
export class FundedHealthGuardJobDirectory {
  public constructor(
    private readonly config: Readonly<{ apiUrl: string; bearerToken: string }>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!/^https?:\/\//u.test(config.apiUrl)) throw new Error("RELIC_API_URL must be an HTTP(S) URL");
    if (!config.bearerToken.trim()) throw new Error("RELIC_HEALTH_GUARD_INTERNAL_TOKEN is required");
  }

  async list(limit = 100): Promise<readonly string[]> {
    const response = await this.fetchImpl(
      new URL(`/internal/health-guard/funded-jobs?limit=${encodeURIComponent(String(limit))}`, this.config.apiUrl).toString(),
      { headers: { authorization: `Bearer ${this.config.bearerToken}` } },
    );
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text) as unknown; } catch { throw new Error("Health Guard job directory returned non-JSON"); }
    if (!response.ok) throw new Error(`Health Guard job directory failed (${String(response.status)})`);
    if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray((body as { jobIds?: unknown }).jobIds))
      throw new Error("Health Guard job directory returned malformed jobs");
    const ids = (body as { jobIds: unknown[] }).jobIds;
    if (!ids.every((id) => typeof id === "string" && /^\d+$/u.test(id)))
      throw new Error("Health Guard job directory returned an invalid job ID");
    return ids as string[];
  }
}
