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
