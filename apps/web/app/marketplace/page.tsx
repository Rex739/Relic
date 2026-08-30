import type { Metadata } from "next";
import Link from "next/link";

import { AgentGrid } from "../_components/agent-grid";
import { IntentSearch } from "../_components/intent-search";
import {
  categories,
  marketplaceAgents,
  marketplaceCategories,
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
  ])
    if (typeof search[key] === "string") params.set(key, search[key]);
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
      </section>

      <section className="page-shell category-section">
        <div className="section-heading">
          <div>
            <span className="overline">Browse by category</span>
            <h2>What do you want done?</h2>
          </div>
          <p>
            All four BNB competition categories, backed by real inventory data.
          </p>
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

      <section className="inventory-section" id="inventory">
        <div className="page-shell">
          <div className="section-heading inventory-heading">
            <div>
              <span className="overline">Agent inventory</span>
              <h2>
                {params.has("category")
                  ? "Agents matching your task"
                  : "Available agents"}
              </h2>
            </div>
            <span className="result-count">
              {pagination?.total ?? 0} public agent
              {pagination?.total === 1 ? "" : "s"}
            </span>
          </div>
          <form className="filter-bar" action="/marketplace">
            <input
              name="text"
              defaultValue={typeof search.text === "string" ? search.text : ""}
              placeholder="Search verified capability"
              aria-label="Search agents"
            />
            <select
              name="category"
              defaultValue={
                typeof search.category === "string" ? search.category : ""
              }
              aria-label="Category"
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option value={category.slug} key={category.slug}>
                  {category.label}
                </option>
              ))}
            </select>
            <select
              name="tier"
              defaultValue={typeof search.tier === "string" ? search.tier : ""}
              aria-label="Verification tier"
            >
              <option value="">Working + Actionable</option>
              <option>Working</option>
              <option>Actionable</option>
            </select>
            <select
              name="chainId"
              defaultValue={
                typeof search.chainId === "string" ? search.chainId : ""
              }
              aria-label="Network"
            >
              <option value="">All networks</option>
              <option value="56">BNB Chain</option>
              <option value="97">BNB Chain Testnet</option>
            </select>
            <button type="submit">Apply filters</button>
          </form>
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
                No usable agent currently satisfies all of those requirements.
              </h3>
              <p>
                Relax a filter or explore another category. Relic will not
                substitute agents that have not passed its checks.
              </p>
              <Link href="/marketplace">Clear filters</Link>
            </div>
          ) : (
            <AgentGrid agents={agents} />
          )}
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
