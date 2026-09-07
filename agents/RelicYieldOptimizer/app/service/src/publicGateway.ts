/**
 * Layer B, the only public surface. It knows neither a wallet nor a protocol
 * contract. Its entire authority is forwarding two structured A2A messages
 * to the private executor with a service credential.
 */
export type GatewayConfig = Readonly<{
  privateAgentUrl: string;
  privateAgentBearerToken: string;
  allowInternalHttp?: boolean;
}>;

export function privateAgentEndpoint(config: GatewayConfig): URL {
  const endpoint = new URL(config.privateAgentUrl);
  if (endpoint.protocol !== "https:" && !config.allowInternalHttp)
    throw new Error("PRIVATE_AGENT_URL must use HTTPS outside Northflank private networking");
  return endpoint;
}

export function publicAgentCard(publicUrl: string) {
  const baseUrl = publicUrl.replace(/\/$/u, "");
  return {
    name: "Relic Yield Optimizer",
    description:
      "A constrained BSC Testnet USDT supply optimizer. It can execute only buyer-mandated Venus supply and withdrawal operations.",
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
        description: "Returns a signed quote for a bounded BSC Testnet USDT yield operation.",
        tags: ["erc8183", "yield", "venus", "bsc-testnet", "usdt"],
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

export async function forwardA2aRequest(
  body: unknown,
  config: GatewayConfig,
  fetchImpl: typeof fetch = fetch,
) {
  if (!isAllowedA2aSkill(body)) {
    return { status: 400, body: { error: "Only negotiate and notify_funded A2A skills are accepted" } };
  }
  const endpoint = privateAgentEndpoint(config);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.privateAgentBearerToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: { error: "Private executor returned a non-JSON response" } };
  }
}
