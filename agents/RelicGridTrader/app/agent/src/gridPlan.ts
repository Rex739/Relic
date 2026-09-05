/**
 * Deterministic Grid Trader value layer.
 *
 * This module is intentionally independent of the LLM and the signing code.
 * A funded ERC-8183 job receives a validated plan; future router execution
 * consumes this exact plan only after mandate and contract checks pass.
 */

type GridRequest = {
  pair: "BNB/USDT";
  capitalCap: string;
  lowerPrice: string;
  upperPrice: string;
  gridLevels: number;
  durationHours: number;
};

const decimal = /^\d+(?:\.\d+)?$/u;

const asDecimal = (value: unknown, label: string) => {
  const text = String(value ?? "").trim();
  if (!decimal.test(text)) throw new Error(`${label} must be a positive decimal`);
  return text;
};

const asInteger = (value: unknown, label: string, min: number, max: number) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${label} must be an integer between ${String(min)} and ${String(max)}`);
  return number;
};

const scaled = (value: string, decimals = 8) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`);
};

const display = (value: bigint, decimals = 8) => {
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

export function parseGridRequest(prompt: string): GridRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(prompt);
  } catch {
    throw new Error("Grid Trader requires a JSON request with price and capital limits");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Grid Trader request must be a JSON object");
  const value = parsed as Record<string, unknown>;
  if (value.pair !== "BNB/USDT")
    throw new Error("This Grid Trader supports BNB/USDT only");
  return {
    pair: "BNB/USDT",
    capitalCap: asDecimal(value.capitalCap, "capitalCap"),
    lowerPrice: asDecimal(value.lowerPrice, "lowerPrice"),
    upperPrice: asDecimal(value.upperPrice, "upperPrice"),
    gridLevels: asInteger(value.gridLevels, "gridLevels", 5, 8),
    durationHours: asInteger(value.durationHours, "durationHours", 1, 168),
  };
}

export function createGridDeliverable(prompt: string, now = new Date()) {
  const request = parseGridRequest(prompt);
  const capital = scaled(request.capitalCap);
  const lower = scaled(request.lowerPrice);
  const upper = scaled(request.upperPrice);
  if (capital <= 0n) throw new Error("capitalCap must be greater than zero");
  if (lower <= 0n) throw new Error("lowerPrice must be greater than zero");
  if (upper <= lower) throw new Error("upperPrice must be greater than lowerPrice");
  const intervals = BigInt(request.gridLevels - 1);
  const step = (upper - lower) / intervals;
  if (step <= 0n) throw new Error("Price range is too narrow for this grid");
  const levels = Array.from({ length: request.gridLevels }, (_, index) =>
    display(index === request.gridLevels - 1 ? upper : lower + step * BigInt(index)),
  );
  const expiresAt = new Date(
    now.getTime() + request.durationHours * 3_600_000,
  ).toISOString();
  return {
    schema: "relic.result.v1",
    status: "success",
    severity: "info",
    summary: "Grid configuration accepted",
    explanation:
      "The agent will trade only after the execution layer verifies the Relic mandate, exact router allowlist, active session, and capital cap.",
    metrics: [
      { key: "pair", label: "Trading pair", value: request.pair },
      { key: "capitalCap", label: "Maximum trading capital", value: request.capitalCap },
      { key: "priceRange", label: "Price range", value: `${request.lowerPrice}–${request.upperPrice} USDT` },
      { key: "gridLevels", label: "Grid levels", value: String(request.gridLevels) },
      { key: "priceStep", label: "Price step", value: `${display(step)} USDT` },
      { key: "expiresAt", label: "Stops at", value: expiresAt },
    ],
    grid: {
      levels,
      minimumSecondsBetweenExecutions: 900,
      maximumExecutions: request.gridLevels * 2,
      stopConditions: [
        "Approved capital cap reached",
        "Requested run time ended",
        "Buyer paused or cancelled the order",
        "Price remains outside the requested range",
      ],
    },
    evidence: { source: "deterministic-grid-policy", observedAt: now.toISOString() },
  };
}
