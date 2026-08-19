import { z } from "zod";

export const scanAgentSchema = z
  .object({
    id: z.string().min(1),
    agent_id: z.string().optional(),
    token_id: z.union([z.string(), z.number()]).transform(String),
    chain_id: z.number().int(),
    contract_address: z.string(),
    owner_address: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    image_url: z.string().nullable().optional(),
    supported_protocols: z.array(z.string()).default([]),
    x402_supported: z.boolean().nullable().optional(),
    is_verified: z.boolean().nullable().optional(),
    star_count: z.number().int().nonnegative().nullable().optional(),
    total_feedbacks: z.number().int().nonnegative().nullable().optional(),
    average_score: z.number().nullable().optional(),
    total_score: z.number().nullable().optional(),
    health_score: z.number().nullable().optional(),
    created_at: z.string().nullable().optional(),
    created_block_number: z.number().int().nullable().optional(),
    created_tx_hash: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    raw_metadata: z.unknown().optional(),
  })
  .passthrough();

const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

const listResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.unknown()),
  meta: z.object({ pagination: paginationSchema }),
});

const responseSchema = z.object({
  success: z.literal(true),
  data: scanAgentSchema,
});

const searchResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.unknown()),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type ScanAgent = z.infer<typeof scanAgentSchema>;

export interface ScanRateLimit {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
}

export interface ScanAgentPage {
  agents: unknown[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  rateLimit: ScanRateLimit;
}

export interface ScanAgentSearchResult {
  agents: unknown[];
  query: string;
  rateLimit: ScanRateLimit;
}

export interface Scan8004Options {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

const integerHeader = (value: string | null) => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

export class Scan8004Provider {
  readonly #apiKey: string | undefined;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #now: () => number;
  #notBefore = 0;
  #lastRateLimit: ScanRateLimit = {
    limit: null,
    remaining: null,
    resetAt: null,
  };

  constructor(options: Scan8004Options = {}) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl ?? "https://8004scan.io/api/v1/public";
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#now = options.now ?? Date.now;
  }

  get lastRateLimit(): ScanRateLimit {
    return this.#lastRateLimit;
  }

  async listAgents(options: {
    chainId: number;
    page: number;
    limit: number;
    sortBy?: "created_at" | "token_id";
    sortOrder?: "asc" | "desc";
  }): Promise<ScanAgentPage> {
    const query = new URLSearchParams({
      chainId: String(options.chainId),
      isTestnet: "false",
      page: String(options.page),
      limit: String(options.limit),
      sortBy: options.sortBy ?? "token_id",
      sortOrder: options.sortOrder ?? "asc",
    });
    const response = await this.#request(`/agents?${query.toString()}`);
    if (!response.ok)
      throw new Error(`8004scan request failed with HTTP ${response.status}`);
    const parsed = listResponseSchema.parse(await response.json());
    return {
      agents: parsed.data,
      page: parsed.meta.pagination.page,
      pageSize: parsed.meta.pagination.limit,
      total: parsed.meta.pagination.total,
      hasMore: parsed.meta.pagination.hasMore,
      rateLimit: this.#lastRateLimit,
    };
  }

  parseAgent(value: unknown): ScanAgent {
    return scanAgentSchema.parse(value);
  }

  async searchAgents(options: {
    query: string;
    chainId: number;
    limit: number;
    semanticWeight?: number;
  }): Promise<ScanAgentSearchResult> {
    if (options.query.trim() === "")
      throw new Error("8004scan search query cannot be empty");
    if (
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100
    )
      throw new Error("8004scan search limit must be between 1 and 100");
    const semanticWeight = options.semanticWeight ?? 0.45;
    if (semanticWeight < 0 || semanticWeight > 1)
      throw new Error("8004scan semantic weight must be between 0 and 1");
    const query = new URLSearchParams({
      q: options.query,
      chainId: String(options.chainId),
      limit: String(options.limit),
      semanticWeight: String(semanticWeight),
    });
    const response = await this.#request(`/agents/search?${query.toString()}`);
    if (!response.ok)
      throw new Error(`8004scan search failed with HTTP ${response.status}`);
    const parsed = searchResponseSchema.parse(await response.json());
    return {
      agents: parsed.data,
      query: options.query,
      rateLimit: this.#lastRateLimit,
    };
  }

  async searchAgentsKeyword(options: {
    query: string;
    chainId: number;
    limit: number;
    page?: number;
  }): Promise<ScanAgentSearchResult> {
    if (options.query.trim() === "")
      throw new Error("8004scan keyword query cannot be empty");
    if (
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100
    )
      throw new Error("8004scan keyword limit must be between 1 and 100");
    const query = new URLSearchParams({
      chainId: String(options.chainId),
      isTestnet: "false",
      page: String(options.page ?? 1),
      limit: String(options.limit),
      search: options.query,
      sortBy: "created_at",
      sortOrder: "desc",
    });
    const response = await this.#request(`/agents?${query.toString()}`);
    if (!response.ok)
      throw new Error(
        `8004scan keyword search failed with HTTP ${response.status}`,
      );
    const parsed = listResponseSchema.parse(await response.json());
    return {
      agents: parsed.data,
      query: options.query,
      rateLimit: this.#lastRateLimit,
    };
  }

  async getAgent(chainId: number, agentId: string): Promise<ScanAgent | null> {
    const response = await this.#request(
      `/agents/${encodeURIComponent(String(chainId))}/${encodeURIComponent(agentId)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`8004scan request failed with HTTP ${response.status}`);
    return responseSchema.parse(await response.json()).data;
  }

  async #request(path: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const throttleMs = Math.max(0, this.#notBefore - this.#now());
      if (throttleMs > 0) await this.#sleep(throttleMs);
      try {
        const response = await this.#fetch(`${this.#baseUrl}${path}`, {
          headers:
            this.#apiKey === undefined
              ? { accept: "application/json" }
              : { accept: "application/json", "x-api-key": this.#apiKey },
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        this.#captureRateLimit(response.headers);
        if (response.status !== 429 && response.status < 500) return response;
        lastError = new Error(
          `8004scan request failed with HTTP ${response.status}`,
        );
        if (attempt < this.#maxRetries)
          await this.#sleep(this.#retryDelay(response, attempt));
      } catch (error) {
        lastError = error;
        if (attempt < this.#maxRetries) await this.#sleep(500 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  #captureRateLimit(headers: Headers): void {
    const resetAt = headers.get("x-ratelimit-reset");
    this.#lastRateLimit = {
      limit: integerHeader(headers.get("x-ratelimit-limit")),
      remaining: integerHeader(headers.get("x-ratelimit-remaining")),
      resetAt,
    };
    if (this.#lastRateLimit.remaining === 0 && resetAt !== null) {
      const reset = Date.parse(resetAt);
      if (Number.isFinite(reset))
        this.#notBefore = Math.max(this.#notBefore, reset);
    }
  }

  #retryDelay(response: Response, attempt: number): number {
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0)
      return retryAfter * 1_000;
    const resetAt = response.headers.get("x-ratelimit-reset");
    if (resetAt !== null) {
      const reset = Date.parse(resetAt);
      if (Number.isFinite(reset)) return Math.max(0, reset - this.#now());
    }
    return 500 * 2 ** attempt;
  }
}
