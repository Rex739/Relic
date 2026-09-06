import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { forwardA2aRequest, privateAgentEndpoint, publicAgentCard } from "./publicGateway.js";

const port = Number(process.env.PORT ?? "8003");
const publicUrl = process.env.PUBLIC_SERVICE_URL?.trim();
const privateAgentUrl = process.env.PRIVATE_AGENT_URL?.trim();

const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const jsonBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Uint8Array);
    length += value.length;
    if (length > 64 * 1024) throw new Error("Request body exceeds 64 KiB");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const config = () => {
  if (!privateAgentUrl) throw new Error("PRIVATE_AGENT_URL is not configured");
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.PRIVATE_AGENT_BEARER_TOKEN?.trim()
  ) {
    throw new Error(
      "PRIVATE_AGENT_BEARER_TOKEN is required when running the public gateway in production",
    );
  }
  return {
    privateAgentUrl,
    ...(process.env.PRIVATE_AGENT_BEARER_TOKEN
      ? { privateAgentBearerToken: process.env.PRIVATE_AGENT_BEARER_TOKEN }
      : {}),
    allowInsecurePrivateAgent:
      process.env.NODE_ENV !== "production" ||
      process.env.ALLOW_INTERNAL_HTTP === "true",
  };
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/health")
    return send(response, 200, {
      status: "ok",
      service: "relic-lp-range-rebalancer-public-gateway",
      public: true,
      privateAgentConfigured: Boolean(privateAgentUrl),
    });
  if (request.method === "GET" && url.pathname === "/ready") {
    try {
      if (!privateAgentUrl) throw new Error("PRIVATE_AGENT_URL is not configured");
      privateAgentEndpoint(config());
      return send(response, 200, { status: "ready" });
    } catch (error) {
      return send(response, 503, {
        status: "not_ready",
        error: error instanceof Error ? error.message : "Gateway is not configured",
      });
    }
  }
  if (request.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
    if (!publicUrl) return send(response, 503, { error: "PUBLIC_SERVICE_URL is not configured" });
    return send(response, 200, publicAgentCard(publicUrl));
  }
  if (request.method === "POST" && url.pathname === "/apex") {
    try {
      const result = await forwardA2aRequest(await jsonBody(request), config());
      return send(response, result.status, result.body);
    } catch (error) {
      return send(response, 502, {
        error: error instanceof Error ? error.message : "Private agent invocation failed",
      });
    }
  }
  return send(response, 404, { error: "not_found" });
}).listen(port, "0.0.0.0", () =>
  console.info(`Relic LP Range Rebalancer public gateway listening on ${String(port)}`),
);
