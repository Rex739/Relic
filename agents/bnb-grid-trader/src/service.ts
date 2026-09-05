import { createServer } from "node:http";

import { createGridPlan } from "./grid.js";

const port = Number(process.env.PORT ?? "3002");

const send = (response: import("node:http").ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const readJson = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/health")
    return send(response, 200, {
      status: "ok",
      service: "relic-bnb-grid-trader",
      chainId: 97,
      pair: "BNB/USDT",
      execution: "not_enabled_until_router_and_mandate-verification_are_configured",
    });
  if (request.method === "POST" && url.pathname === "/grid/plan") {
    try {
      return send(response, 200, createGridPlan(await readJson(request)));
    } catch (error) {
      return send(response, 400, {
        error: error instanceof Error ? error.message : "Invalid grid request",
      });
    }
  }
  return send(response, 404, { error: "not_found" });
}).listen(port, "0.0.0.0", () =>
  console.info(`Relic BNB Grid Trader listening on ${String(port)}`),
);
