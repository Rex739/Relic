import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

export interface ReferenceAgentMount {
  readonly slug: string;
  close(): Promise<void>;
  handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean>;
  ready(): boolean;
}

export const referenceRuntimeReadiness = (
  acceptingRequests: boolean,
  agents: ReferenceAgentMount[],
) => {
  const ready = acceptingRequests && agents.every((agent) => agent.ready());
  return {
    ready,
    body: {
      status: ready ? "ready" : "not_ready",
      agents: ready ? agents.map((agent) => agent.slug) : [],
    },
  } as const;
};

const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const closeServer = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

export async function startReferenceRuntime(
  port: number,
  agents: ReferenceAgentMount[],
) {
  let acceptingRequests = true;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health")
      return send(response, 200, {
        status: "ok",
        service: "relic-reference-runtime",
      });
    if (request.method === "GET" && url.pathname === "/ready") {
      const readiness = referenceRuntimeReadiness(acceptingRequests, agents);
      return send(response, readiness.ready ? 200 : 503, readiness.body);
    }
    try {
      for (const agent of agents)
        if (await agent.handle(request, response, url)) return;
      return send(response, 404, { error: "not_found" });
    } catch (error) {
      console.error(
        `[reference-runtime] request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return send(response, 400, { error: "request_failed" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve());
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      acceptingRequests = false;
      await closeServer(server);
      await Promise.all(agents.map((agent) => agent.close()));
    },
  };
}
