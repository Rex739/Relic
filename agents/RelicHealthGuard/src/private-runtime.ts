import type { IncomingMessage, ServerResponse } from "node:http";
import type { HealthGuardPrivateExecutor } from "./private-executor.js";

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};
async function body(request: IncomingMessage): Promise<unknown> {
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

const commerceJobId = (value: unknown): string => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Health Guard cycle request");
  const id = (value as { commerceJobId?: unknown }).commerceJobId;
  if (typeof id !== "string" || !/^\d+$/u.test(id)) throw new Error("Health Guard cycle requires a funded commerce job ID");
  return id;
};

/** Private-only worker boundary. A stable delivery key makes scheduler retry safe. */
export function healthGuardPrivateRuntimeHandler(
  executor: HealthGuardPrivateExecutor,
  bearerToken: string,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  if (!bearerToken.trim()) throw new Error("PRIVATE_AGENT_BEARER_TOKEN is required");
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://health-guard-private");
    if (request.method === "GET" && url.pathname === "/health")
      return json(response, 200, { status: "ok", service: "relic-health-guard", public: false });
    if (request.method === "GET" && url.pathname === "/readiness") {
      const readiness = await executor.readiness();
      return json(response, readiness.ready ? 200 : 503, readiness.ready ? { status: "ready" } : { status: "not_ready", detail: readiness.detail });
    }
    if (request.method === "POST" && url.pathname === "/cycles") {
      if (request.headers.authorization !== `Bearer ${bearerToken}`) return json(response, 401, { error: "unauthorized" });
      try {
        const input = await body(request);
        const jobId = commerceJobId(input);
        const deliveryKey = request.headers["x-relic-delivery-id"];
        if (typeof deliveryKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(deliveryKey))
          return json(response, 400, { error: "invalid_delivery_id" });
        const result = await executor.runCycle({
          commerceJobId: jobId,
          cycle: { id: deliveryKey, idempotencyKey: `health-guard-cycle:${jobId}:${deliveryKey}` },
        });
        return json(response, result.status, result.body);
      } catch (error) {
        return json(response, 400, { error: error instanceof Error ? error.message : "invalid_request" });
      }
    }
    return json(response, 404, { error: "not_found" });
  };
}
