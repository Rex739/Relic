import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { forwardFundedNotification, privateCycleEndpoint, publicAgentCard } from "./public-gateway.js";

const port = Number(process.env.PORT ?? "8004");
const publicUrl = process.env.PUBLIC_SERVICE_URL?.trim();
const privateAgentUrl = process.env.PRIVATE_AGENT_URL?.trim();
const privateAgentBearerToken = process.env.PRIVATE_AGENT_BEARER_TOKEN?.trim();

const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Uint8Array);
    length += value.length;
    if (length > 16 * 1024) throw new Error("Request body exceeds 16 KiB");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function config() {
  if (!privateAgentUrl) throw new Error("PRIVATE_AGENT_URL is not configured");
  if (!privateAgentBearerToken) throw new Error("PRIVATE_AGENT_BEARER_TOKEN is not configured");
  return {
    privateAgentUrl,
    privateAgentBearerToken,
    allowInternalHttp: process.env.ALLOW_INTERNAL_HTTP === "true",
  };
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://health-guard-gateway");
  if (request.method === "GET" && url.pathname === "/health")
    return send(response, 200, { status: "ok", service: "relic-health-guard-gateway", public: true });
  if (request.method === "GET" && url.pathname === "/ready") {
    try {
      privateCycleEndpoint(config());
      return send(response, 200, { status: "ready" });
    } catch (error) {
      return send(response, 503, { status: "not_ready", error: error instanceof Error ? error.message : "Gateway is not configured" });
    }
  }
  if (request.method === "GET" && url.pathname === "/.well-known/agent-card.json")
    return publicUrl
      ? send(response, 200, publicAgentCard(publicUrl))
      : send(response, 503, { error: "PUBLIC_SERVICE_URL is not configured" });
  if (request.method === "POST" && url.pathname === "/apex") {
    try {
      const result = await forwardFundedNotification(await jsonBody(request), config());
      return send(response, result.status, result.body);
    } catch (error) {
      return send(response, 502, { error: error instanceof Error ? error.message : "Private Health Guard invocation failed" });
    }
  }
  return send(response, 404, { error: "not_found" });
}).listen(port, "0.0.0.0", () => console.info(`Relic Health Guard gateway listening on ${String(port)}`));
