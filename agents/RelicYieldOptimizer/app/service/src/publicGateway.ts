/**
 * Layer B, the only public surface. It knows neither a wallet nor a protocol
 * contract. Its entire authority is forwarding two structured A2A messages
 * to the private executor with a service credential.
 */
export type GatewayConfig = Readonly<{
  privateAgentUrl: string;
  privateAgentBearerToken: string;
  relicApiUrl: string;
  relicInternalToken: string;
  allowInternalHttp?: boolean;
}>;

export type PublicNetwork = "bsc-testnet" | "bsc-mainnet";

function publicNetworkDetails(network: PublicNetwork) {
  return network === "bsc-mainnet"
    ? { label: "BSC Mainnet", tag: "bsc-mainnet" }
    : { label: "BSC Testnet", tag: "bsc-testnet" };
}

export function privateAgentEndpoint(config: GatewayConfig): URL {
  const endpoint = new URL(config.privateAgentUrl);
  if (endpoint.protocol !== "https:" && !config.allowInternalHttp)
    throw new Error("PRIVATE_AGENT_URL must use HTTPS outside Northflank private networking");
  return endpoint;
}

function relicApiEndpoint(config: GatewayConfig, jobId: string): URL {
  if (!/^\d+$/u.test(jobId)) throw new Error("A funded ERC-8183 job id is required");
  const endpoint = new URL(`/internal/yield-optimizer/funded-jobs/${jobId}/execution-request`, config.relicApiUrl);
  if (endpoint.protocol !== "https:" && !config.allowInternalHttp)
    throw new Error("RELIC_API_URL must use HTTPS outside Northflank private networking");
  return endpoint;
}

export function publicAgentCard(publicUrl: string, network: PublicNetwork = "bsc-testnet") {
  const baseUrl = publicUrl.replace(/\/$/u, "");
  const details = publicNetworkDetails(network);
  return {
    name: "Relic Yield Optimizer",
    description:
      `A constrained ${details.label} USDT supply optimizer. It can execute only buyer-mandated Venus supply and withdrawal operations.`,
    url: `${baseUrl}/apex`,
    version: "0.1.0",
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    capabilities: { streaming: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "negotiate",
        name: "Negotiate a constrained yield job",
        description: `Returns a signed quote for a bounded ${details.label} USDT yield operation.`,
        tags: ["erc8183", "yield", "venus", details.tag, "usdt"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "notify_funded",
        name: "Execute a funded constrained yield job",
        description: "Validates the buyer mandate, then starts the approved Venus supply or withdrawal job.",
        tags: ["erc8183", "yield", "venus", "execution"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
  };
}

export function isAllowedA2aSkill(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const message = body as Record<string, unknown>;
  if (message.method !== "message/send") return false;
  const params = message.params;
  if (params === null || typeof params !== "object" || Array.isArray(params)) return false;
  const userMessage = (params as Record<string, unknown>).message;
  if (userMessage === null || typeof userMessage !== "object" || Array.isArray(userMessage)) return false;
  const parts = (userMessage as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return false;
  return parts.some((part) => {
    if (part === null || typeof part !== "object" || Array.isArray(part)) return false;
    const typedPart = part as Record<string, unknown>;
    const data = typedPart.data;
    return typedPart.kind === "data" && data !== null && typeof data === "object" && !Array.isArray(data)
      && ["negotiate", "notify_funded"].includes(String((data as Record<string, unknown>).skill));
  });
}

/** Extract only the job identifier from a public funded notification. */
export function fundedJobId(body: unknown): string | null {
  if (!isAllowedA2aSkill(body)) return null;
  const parts = ((body as { params: { message: { parts: unknown[] } } }).params.message.parts);
  for (const part of parts) {
    const data = part && typeof part === "object" && !Array.isArray(part)
      ? (part as { kind?: unknown; data?: unknown }).data : undefined;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const value = data as Record<string, unknown>;
    if (value.skill !== "notify_funded") continue;
    const jobId = value.jobId ?? value.commerceJobId;
    if (typeof jobId === "string" && /^\d+$/u.test(jobId)) return jobId;
  }
  return null;
}

async function canonicalFundedRequest(jobId: string, config: GatewayConfig, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(relicApiEndpoint(config, jobId), {
    method: "POST",
    headers: { authorization: `Bearer ${config.relicInternalToken}` },
  });
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { throw new Error("Relic canonical execution endpoint returned non-JSON"); }
  if (!response.ok) {
    const detail = body && typeof body === "object" && !Array.isArray(body)
      ? String((body as { error?: unknown }).error ?? "request failed") : "request failed";
    throw new Error(`Relic canonical execution request failed (${String(response.status)}): ${detail}`);
  }
  return body;
}

export async function forwardA2aRequest(
  body: unknown,
  config: GatewayConfig,
  fetchImpl: typeof fetch = fetch,
) {
  if (!isAllowedA2aSkill(body)) {
    return { status: 400, body: { error: "Only negotiate and notify_funded A2A skills are accepted" } };
  }
  const jobId = fundedJobId(body);
  if (jobId === null) {
    return { status: 400, body: { error: "A funded notify_funded message with a numeric jobId is required for execution" } };
  }
  const endpoint = privateAgentEndpoint(config);
  const canonical = await canonicalFundedRequest(jobId, config, fetchImpl);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.privateAgentBearerToken}`,
    },
    body: JSON.stringify(canonical),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: { error: "Private executor returned a non-JSON response" } };
  }
}
