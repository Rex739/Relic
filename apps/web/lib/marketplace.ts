import type {
  InternalMarketplaceStatus,
  PublicCategoryCount,
  PublicMarketplaceAgent,
  PublicMarketplaceAgentDetail,
  PublicMarketplaceResult,
} from "@relic/domain";
import { formatDisplayBaseUnits } from "./commerce-display";

export const categories = [
  {
    slug: "rebalancing",
    route: "rebalancing",
    label: "Rebalancing",
    description:
      "Keep liquidity and portfolio positions inside explicit operating bounds.",
  },
  {
    slug: "grid-trading",
    route: "grid-trading",
    label: "Grid Trading",
    description:
      "Build and monitor rule-bound grid strategies with independently tested interfaces.",
  },
  {
    slug: "yield-optimisation",
    route: "yield-optimisation",
    label: "Yield Optimisation",
    description:
      "Compare and manage yield opportunities with risk and execution evidence in view.",
  },
  {
    slug: "health-factor-monitoring",
    route: "health-factor",
    label: "Health Factor Monitoring",
    description:
      "Watch lending positions and surface liquidation risk before it becomes urgent.",
  },
] as const;

const interfaceLabels: Record<string, string> = {
  erc8183: "Managed agent service",
  a2a: "Agent-to-agent service",
  mcp: "Tool-enabled service",
};

export function productCapabilityLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    interfaceLabels[normalized] ??
    value
      .replaceAll("_", " ")
      .replaceAll("-", " ")
      .replace(/\b\w/g, (character) => character.toUpperCase())
  );
}

export type IntentUnderstanding = {
  category?: string;
  asset?: string;
  protocol?: string;
  risk?: "conservative" | "balanced" | "aggressive";
};

export function understandMarketplaceIntent(
  input: string,
): IntentUnderstanding {
  const text = input.toLowerCase();
  const category =
    /health factor|liquidat|borrow|collateral|venus position/.test(text)
      ? "health-factor-monitoring"
      : /grid|range order|ladder/.test(text)
        ? "grid-trading"
        : /yield|earn|idle|lend|apy|return/.test(text)
          ? "yield-optimisation"
          : /rebalance|liquidity position|lp position|range boundary/.test(text)
            ? "rebalancing"
            : undefined;
  const asset = ["USDT", "USDC", "BNB", "ETH", "BTC"].find((candidate) =>
    new RegExp(`\\b${candidate.toLowerCase()}\\b`).test(text),
  );
  const protocol = ["Venus", "PancakeSwap", "Aave"].find((candidate) =>
    text.includes(candidate.toLowerCase()),
  );
  const risk = /conservative|low risk|capital preserv/.test(text)
    ? "conservative"
    : /aggressive|high risk|maximi[sz]e/.test(text)
      ? "aggressive"
      : /balanced|moderate/.test(text)
        ? "balanced"
        : undefined;
  return {
    ...(category === undefined ? {} : { category }),
    ...(asset === undefined ? {} : { asset }),
    ...(protocol === undefined ? {} : { protocol }),
    ...(risk === undefined ? {} : { risk }),
  };
}

export function intentSearchParams(input: string) {
  const understood = understandMarketplaceIntent(input);
  const params = new URLSearchParams();
  if (understood.category !== undefined)
    params.set("category", understood.category);
  const requirements = [
    understood.asset,
    understood.protocol,
    understood.risk,
  ].filter((item): item is string => item !== undefined);
  if (requirements.length > 0)
    params.set("requirements", requirements.join(","));
  params.set("intent", input.trim());
  return params;
}

const apiUrl = () =>
  (
    process.env.RELIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");

async function api<T>(
  path: string,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await fetch(`${apiUrl()}${path}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok)
      return {
        data: null,
        error: `Marketplace API returned ${response.status}`,
      };
    return { data: (await response.json()) as T, error: null };
  } catch {
    return {
      data: null,
      error: "Marketplace data is temporarily unavailable.",
    };
  }
}

export const marketplaceAgents = (params: URLSearchParams) =>
  api<{
    data: PublicMarketplaceAgent[];
    pagination: Omit<PublicMarketplaceResult, "items">;
  }>(`/v1/marketplace/agents?${params.toString()}`);

export const marketplaceCategories = () =>
  api<{ data: PublicCategoryCount[] }>("/v1/marketplace/categories");

export const marketplaceAgent = (id: string) =>
  api<PublicMarketplaceAgentDetail>(
    `/v1/marketplace/agents/${encodeURIComponent(id)}`,
  );

export const compareAgents = (ids: string[]) =>
  api<{ data: PublicMarketplaceAgent[] }>(
    `/v1/marketplace/compare?ids=${encodeURIComponent(ids.join(","))}`,
  );

export const internalMarketplaceStatus = () =>
  api<{ data: InternalMarketplaceStatus }>("/internal/marketplace-status");

export const categoryForRoute = (route: string) =>
  categories.find((category) => category.route === route);

export const relativeTime = (value: string) => {
  const milliseconds = Date.now() - Date.parse(value);
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const labelForCategory = (slug: string) =>
  categories.find((category) => category.slug === slug)?.label ?? slug;

export const provenanceLabel = (value: string) =>
  ({
    onchain_verified: "Onchain verified",
    independently_observed: "Independently observed",
    developer_declared: "Developer declared",
    agent_reported: "Agent reported",
    secondary_unverified: "Secondary / unverified",
  })[value] ?? value.replaceAll("_", " ");

export function marketplacePriceLabel(
  price: PublicMarketplaceAgent["activeOfferPrice"],
) {
  if (price === null) return "No active offer";
  if (BigInt(price.amountBaseUnits) === 0n) return "Free";
  return `${formatDisplayBaseUnits(price.amountBaseUnits, price.decimals)} ${price.symbol}`;
}

export function marketplaceOutcomeLabel(
  outcome: PublicMarketplaceAgentDetail["outcomes"][number],
) {
  const settlement = outcome.settlementState.toUpperCase();
  if (settlement === "SETTLED") return "Settlement completed";
  if (["FAILED", "CANCELLED", "REJECTED", "REFUNDED"].includes(settlement))
    return `Commerce ${settlement.toLowerCase()}`;
  if (outcome.deliveredAt !== null) return "Delivery submitted";
  if (outcome.commerceSuccessful) return "Commerce job completed";
  if (outcome.invocationSuccessful) return "Verified service check";
  return "Service check unsuccessful";
}

export type ReadinessInventoryResponse = {
  data: {
    data: PublicMarketplaceAgent[];
    pagination?: { total: number };
  } | null;
  error: string | null;
};

export function readinessInventory(responses: ReadinessInventoryResponse[]) {
  const failed = responses.find(
    (response) => response.error !== null || response.data === null,
  );
  if (failed !== undefined)
    return {
      ok: false as const,
      error: failed.error ?? "Category inventory response was empty",
    };
  return {
    ok: true as const,
    items: responses.map((response) => response.data!),
  };
}
