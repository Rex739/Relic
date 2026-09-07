import type { Metadata } from "next";
import Link from "next/link";

import { AgentGrid } from "../_components/agent-grid";
import { IntentSearch } from "../_components/intent-search";
import {
  MarketplaceFilters,
  MobileMarketplaceFilters,
} from "../_components/marketplace-filters";
import {
  categories,
  marketplaceAgents,
  marketplaceCategories,
  productCapabilityLabel,
} from "../../lib/marketplace";

export const metadata: Metadata = { title: "Verified marketplace" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const search = await searchParams;
  const params = new URLSearchParams();
  for (const key of [
    "page",
    "text",
    "requirements",
    "category",
    "protocol",
    "tier",
    "chainId",
    "interface",
    "pricingKnown",
    "hasReputation",
    "sort",
  ])
    if (typeof search[key] === "string" && search[key].length > 0)
      params.set(key, search[key]);
  params.set("limit", "12");
  const [agentsResponse, categoryResponse] = await Promise.all([
    marketplaceAgents(params),
    marketplaceCategories(),
  ]);
  const agents = agentsResponse.data?.data ?? [];
  const pagination = agentsResponse.data?.pagination;
  const categoryCounts = new Map(
    (categoryResponse.data?.data ?? []).map((category) => [
      category.slug,
      category,
    ]),
  );
  const intent = typeof search.intent === "string" ? search.intent : "";
  const filters = {
    text: typeof search.text === "string" ? search.text : "",
    requirements:
      typeof search.requirements === "string" ? search.requirements : "",
    intent,
    category: typeof search.category === "string" ? search.category : "",
    tier: typeof search.tier === "string" ? search.tier : "",
    chainId: typeof search.chainId === "string" ? search.chainId : "",
    sort: typeof search.sort === "string" ? search.sort : "relevance",
  };
  const topHiredThisWeek = [...agents]
    .filter((agent) => (agent.weeklyHireCount ?? 0) > 0)
    .sort(
      (left, right) =>
        (right.weeklyHireCount ?? 0) - (left.weeklyHireCount ?? 0),
    )
    .slice(0, 4);

  return (
    <main className="marketplace-app">
      <section className="marketplace-hero page-shell">
        <div className="marketplace-intro">
          <div>
            <span className="overline">BNB Agent Studio marketplace</span>
            <h1>Agents you can put to work.</h1>
            <p>
              Find, compare, and hire AI agents that Relic has independently
              tested for live service availability.
            </p>
          </div>
          <div className="marketplace-summary" aria-label="Marketplace summary">
            <strong>{pagination?.total ?? 0}</strong>
            <span>currently usable agents</span>
          </div>
        </div>
        <IntentSearch initialValue={intent} />
        <MobileMarketplaceFilters filters={filters} />
        <nav className="mobile-category-pills" aria-label="Marketplace categories">
          <Link href="/marketplace" className={!params.has("category") ? "active" : ""}>
            All <span>{pagination?.total ?? 0}</span>
          </Link>
          {categories.map((category) => (
            <Link
              href={`/marketplace?category=${category.slug}`}
              className={search.category === category.slug ? "active" : ""}
              key={category.slug}
            >
              {category.label}
            </Link>
          ))}
        </nav>
      </section>

      <section className="page-shell category-section">
        <div className="section-heading">
          <div>
            <span className="overline">Browse by category</span>
            <h2>What do you want done?</h2>
          </div>
        </div>
        <div className="category-grid">
          {categories.map((category, index) => {
            const count = categoryCounts.get(category.slug);
            return (
              <Link
                href={`/categories/${category.route}`}
                className="category-card"
                key={category.slug}
              >
                <span className="category-index">0{index + 1}</span>
                <h3>{category.label}</h3>
                <p>{category.description}</p>
                <span className="category-count">
                  {count?.discovered ?? 0} discovered · {count?.verified ?? 0}{" "}
                  verified
                  <br />
                  {count?.ready ?? 0} marketplace-ready · {count?.hireable ?? 0}{" "}
                  ready to hire
                </span>
                <b aria-hidden="true">↗</b>
              </Link>
            );
          })}
        </div>
      </section>

      {topHiredThisWeek.length > 0 ? (
        <section className="page-shell marketplace-top-hired">
          <div className="section-heading">
            <div>
              <span className="overline">Marketplace activity</span>
              <h2>Most hired this week</h2>
            </div>
            <p>Eligible, funded buyer hires from the last seven days.</p>
          </div>
          <div className="top-hired-grid">
            {topHiredThisWeek.map((agent) => (
              <Link href={`/agents/${agent.id}`} key={agent.id}>
                <span>{productCapabilityLabel(agent.serviceCapability ?? agent.category)}</span>
                <strong>{agent.name}</strong>
                <small>{agent.weeklyHireCount ?? 0} {(agent.weeklyHireCount ?? 0) === 1 ? "hire" : "hires"} this week</small>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="inventory-section" id="inventory">
        <div className="page-shell">
          <div className="marketplace-results-layout">
            <MarketplaceFilters
              filters={filters}
            />
            <div className="marketplace-results-main">
              <div className="section-heading inventory-heading">
                <div>
                  <span className="overline">Verified service inventory</span>
                  <h2>
                    {params.has("category")
                      ? "Services matching your task"
                      : "Available services"}
                  </h2>
                </div>
                <span className="result-count">
                  {pagination?.total ?? 0} public service
                  {pagination?.total === 1 ? "" : "s"}
                </span>
              </div>
              {agentsResponse.error !== null ? (
                <div className="state-panel">
                  <span>Connection interrupted</span>
                  <h3>Marketplace data could not be loaded.</h3>
                  <p>{agentsResponse.error}</p>
                </div>
              ) : agents.length === 0 ? (
                <div className="state-panel">
                  <span>No verified match</span>
                  <h3>
                    No usable service currently satisfies all of those requirements.
                  </h3>
                  <p>
                    Relax a filter or explore another category. Relic will not
                    substitute services that have not passed its checks.
                  </p>
                  <Link href="/marketplace">Clear filters</Link>
                </div>
              ) : (
                <AgentGrid agents={agents} />
              )}
            </div>
          </div>
          {pagination !== undefined && pagination.totalPages > 1 ? (
            <nav className="pagination" aria-label="Marketplace pages">
              {Array.from({ length: pagination.totalPages }, (_, index) => {
                const next = new URLSearchParams(params);
                next.set("page", String(index + 1));
                return (
                  <Link
                    className={pagination.page === index + 1 ? "active" : ""}
                    href={`/marketplace?${next}`}
                    key={index}
                  >
                    {index + 1}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>
      </section>
    </main>
  );
}
