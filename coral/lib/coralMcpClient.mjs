export function requireCoralRuntime() {
  const connectionUrl = process.env.CORAL_CONNECTION_URL;
  if (!connectionUrl) {
    throw new Error("CORAL_CONNECTION_URL is required and must be supplied by Coral Server at runtime.");
  }

  return {
    connectionUrl,
    agentId: process.env.CORAL_AGENT_ID ?? "unknown-agent",
    sessionId: process.env.CORAL_SESSION_ID ?? "unknown-session",
    apiUrl: process.env.CORAL_API_URL ?? "http://localhost:5555",
  };
}

export async function createMcpClient(connectionUrl) {
  let requestId = 0;

  async function rpc(method, params = {}) {
    const response = await fetch(connectionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++requestId,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Coral MCP ${method} failed with HTTP ${response.status}.`);
    }

    const text = await response.text();
    const payload = parseMcpResponse(text);
    if (payload.error) {
      throw new Error(`Coral MCP ${method} failed: ${payload.error.message ?? JSON.stringify(payload.error)}`);
    }
    return payload.result;
  }

  return {
    async listTools() {
      const result = await rpc("tools/list");
      return result?.tools ?? [];
    },
    async callTool(name, args) {
      return normalizeToolResult(await rpc("tools/call", { name, arguments: args }));
    },
  };
}

export function selectTool(tools, fragments) {
  const lowered = fragments.map((fragment) => fragment.toLowerCase());
  const tool = tools.find((candidate) => {
    const name = String(candidate.name ?? "").toLowerCase();
    return lowered.every((fragment) => name.includes(fragment));
  });

  if (!tool?.name) {
    throw new Error(`Required Coral MCP tool not found: ${fragments.join(" ")}`);
  }

  return tool.name;
}

function parseMcpResponse(text) {
  if (text.trim().startsWith("data:")) {
    const dataLine = text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"));
    return JSON.parse(dataLine.slice("data:".length).trim());
  }

  return JSON.parse(text);
}

function normalizeToolResult(result) {
  const text = result?.content?.find?.((item) => item?.type === "text" && typeof item.text === "string")?.text;
  if (!text) {
    return result;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ...result, text };
  }
}
