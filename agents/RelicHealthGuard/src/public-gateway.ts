import { randomUUID } from "node:crypto";

/** Layer B public surface. It contains no signing or protocol authority. */
export function publicAgentCard(publicUrl: string) {
  const base = publicUrl.replace(/\/$/u, "");
  return {
    name: "Relic Health Guard",
    description: "A constrained BSC Mainnet Venus USDT health-protection service. It may repay only a buyer-authorized debt position from that buyer's isolated rescue-wallet balance.",
    url: `${base}/apex`, version: "1.0.0", protocolVersion: "0.3.0", preferredTransport: "JSONRPC",
    capabilities: { streaming: false }, defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"],
    skills: [{
      id: "notify_funded", name: "Run a funded health-guard cycle",
      description: "Retrieves the canonical funded job and requests one policy-bounded Venus health observation/repayment cycle.",
      tags: ["erc8183", "venus", "bsc-mainnet", "usdt", "health-factor", "repay"],
      inputModes: ["application/json"], outputModes: ["application/json"],
    }],
  };
}

export function fundedJobId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const message = body as { method?: unknown; params?: { message?: { parts?: unknown[] } } };
  if (message.method !== "message/send" || !Array.isArray(message.params?.message?.parts)) return null;
  for (const part of message.params.message.parts) {
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    const value = part as { kind?: unknown; data?: { skill?: unknown; jobId?: unknown; commerceJobId?: unknown } };
    if (value.kind !== "data" || value.data?.skill !== "notify_funded") continue;
    const id = value.data.jobId ?? value.data.commerceJobId;
    if (typeof id === "string" && /^\d+$/u.test(id)) return id;
  }
  return null;
}

export type PublicGatewayConfig = Readonly<{
  privateAgentUrl: string;
  privateAgentBearerToken: string;
  allowInternalHttp?: boolean;
}>;

export function privateCycleEndpoint(config: PublicGatewayConfig): URL {
  const endpoint = new URL("/cycles", config.privateAgentUrl);
  if (endpoint.protocol !== "https:" && !config.allowInternalHttp)
    throw new Error("PRIVATE_AGENT_URL must use HTTPS outside private networking");
  return endpoint;
}

/**
 * The public gateway never forwards caller-supplied execution instructions.
 * It extracts one funded job ID, creates a delivery key, and lets the private
 * worker fetch the canonical mandate and encrypted buyer session from Relic.
 */
export async function forwardFundedNotification(
  body: unknown,
  config: PublicGatewayConfig,
  fetchImpl: typeof fetch = fetch,
  deliveryId = randomUUID(),
): Promise<{ status: number; body: unknown }> {
  const jobId = fundedJobId(body);
  if (jobId === null)
    return { status: 400, body: { error: "A funded notify_funded message with a numeric jobId is required" } };
  if (!config.privateAgentBearerToken.trim())
    throw new Error("PRIVATE_AGENT_BEARER_TOKEN is not configured");
  const response = await fetchImpl(privateCycleEndpoint(config), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.privateAgentBearerToken}`,
      "content-type": "application/json",
      "x-relic-delivery-id": deliveryId,
    },
    body: JSON.stringify({ commerceJobId: jobId }),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: { error: "Private Health Guard returned a non-JSON response" } };
  }
}
