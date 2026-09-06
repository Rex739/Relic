import { createServer } from "node:http";

import { createLpRangeRebalancePlan } from "./rebalance.js";

const port = Number(process.env.PORT ?? "3003");

const send = (
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) => {
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
  if (request.method === "GET" && url.pathname === "/health") {
    return send(response, 200, {
      status: "ok",
      service: "relic-bnb-lp-range-rebalancer",
      chainId: 97,
      pair: "BNB/USDT",
      execution: "requires_verified_mandate_and_altana_session",
    });
  }
  if (request.method === "POST" && url.pathname === "/lp-range/plan") {
    try {
      return send(response, 200, createLpRangeRebalancePlan(await readJson(request)));
    } catch (error) {
      return send(response, 400, {
        error: error instanceof Error ? error.message : "Invalid rebalance request",
      });
    }
  }
  return send(response, 404, { error: "not_found" });
}).listen(port, "0.0.0.0", () =>
  console.info(`Relic BNB LP Range Rebalancer listening on ${String(port)}`),
);
