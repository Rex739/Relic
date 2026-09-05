/**
 * Public Layer B for the Studio Grid Trader.
 *
 * Buyers and marketplace clients call this service anonymously. It forwards
 * only the two ERC-8183 A2A skills to the private Studio agent (Layer A),
 * using service-owned credentials. No buyer or seller supplies AWS IAM
 * credentials to use the marketplace endpoint.
 */

export type GatewayConfig = {
  privateAgentUrl: string;
  privateAgentBearerToken?: string;
  allowInsecurePrivateAgent?: boolean;
};

export function privateAgentEndpoint(config: GatewayConfig): URL {
  const endpoint = new URL(config.privateAgentUrl);
  if (endpoint.protocol !== "https:" && !config.allowInsecurePrivateAgent)
    throw new Error("PRIVATE_AGENT_URL must use HTTPS outside local development");
  if (!endpoint.pathname.endsWith("/")) endpoint.pathname += "/";
  return endpoint;
}

export function publicAgentCard(publicUrl: string) {
  return {
    name: "Relic BNB Grid Trader",
    description:
      "A rule-bound BNB/USDT Grid Trader. It accepts only fixed price, capital, duration, and frequency constraints through ERC-8183.",
    url: publicUrl.replace(/\/$/u, "") + "/apex",
    version: "1.0.0",
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    capabilities: { streaming: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "negotiate",
        name: "Negotiate a Grid Trader job",
        description:
          "Returns a signed ERC-8183 quote for a constrained BNB/USDT grid service.",
        tags: ["erc8183", "grid-trading", "bnb-usdt"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "notify_funded",
        name: "Start a funded Grid Trader job",
        description:
          "Verifies a funded job and starts its constrained grid work.",
        tags: ["erc8183", "grid-trading", "delivery"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
  };
}

const allowedSkill = (body: unknown) => {
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
    const data = (part as Record<string, unknown>).data;
    return (
      (part as Record<string, unknown>).kind === "data" &&
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      ["negotiate", "notify_funded"].includes(
        String((data as Record<string, unknown>).skill),
      )
    );
  });
};

export async function forwardA2aRequest(
  body: unknown,
  config: GatewayConfig,
  fetchImpl: typeof fetch = fetch,
) {
  if (!allowedSkill(body))
    return {
      status: 400,
      body: { error: "Only negotiate and notify_funded A2A skills are accepted" },
    };
  const endpoint = new URL("/", privateAgentEndpoint(config));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.privateAgentBearerToken)
    headers.authorization = `Bearer ${config.privateAgentBearerToken}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let responseBody: unknown = responseText;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    // Preserve the upstream body for diagnosis without exposing credentials.
  }
  return { status: response.status, body: responseBody };
}
