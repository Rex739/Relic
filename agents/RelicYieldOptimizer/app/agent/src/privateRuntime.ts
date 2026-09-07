import type { IncomingMessage, ServerResponse } from "node:http";

export interface PrivateYieldExecutor {
  readiness(): Promise<{ ready: boolean; detail?: string }>;
  handleA2a(body: unknown): Promise<{ status: number; body: unknown }>;
}

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Uint8Array);
    length += value.length;
    if (length > 64 * 1024) throw new Error("Request body exceeds 64 KiB");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/**
 * Layer A's private HTTP boundary. It is intentionally not public-facing and
 * will never accept a request without the shared internal bearer secret.
 */
export function privateRuntimeHandler(
  executor: PrivateYieldExecutor,
  bearerToken: string,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  if (!bearerToken.trim()) throw new Error("PRIVATE_AGENT_BEARER_TOKEN is required");
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://private-agent");
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { status: "ok", service: "relic-yield-optimizer-agent", public: false });
    }
    if (request.method === "GET" && url.pathname === "/readiness") {
      const readiness = await executor.readiness();
      return json(response, readiness.ready ? 200 : 503, readiness.ready ? { status: "ready" } : { status: "not_ready", detail: readiness.detail });
    }
    if (request.method === "POST" && url.pathname === "/") {
      if (request.headers.authorization !== `Bearer ${bearerToken}`) {
        return json(response, 401, { error: "unauthorized" });
      }
      try {
        const result = await executor.handleA2a(await requestBody(request));
        return json(response, result.status, result.body);
      } catch (error) {
        return json(response, 400, { error: error instanceof Error ? error.message : "invalid_request" });
      }
    }
    return json(response, 404, { error: "not_found" });
  };
}
