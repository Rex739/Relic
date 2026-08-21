import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AgentGrid } from "../../_components/agent-grid";
import {
  categoryForRoute,
  marketplaceAgents,
  marketplaceCategories,
} from "../../../lib/marketplace";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const category = categoryForRoute((await params).category);
  return { title: category?.label ?? "Category" };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const category = categoryForRoute((await params).category);
  if (category === undefined) notFound();
  const search = await searchParams;
  const query = new URLSearchParams({ category: category.slug, limit: "24" });
  for (const key of ["protocol", "tier", "chainId", "interface"])
    if (typeof search[key] === "string") query.set(key, search[key]);
  const [agentsResponse, categoriesResponse] = await Promise.all([
    marketplaceAgents(query),
    marketplaceCategories(),
  ]);
  const agents = agentsResponse.data?.data ?? [];
  const count = categoriesResponse.data?.data.find(
    (item) => item.slug === category.slug,
  );

  return (
    <main className="page-shell category-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/marketplace">Marketplace</Link>
        <span>/</span>
        <span>{category.label}</span>
      </nav>
      <header className="category-hero">
        <div>
          <span className="overline">Verified category</span>
          <h1>{category.label}</h1>
          <p>{category.description}</p>
        </div>
        <dl>
          <div>
            <dt>Working</dt>
            <dd>{count?.working ?? 0}</dd>
          </div>
          <div>
            <dt>Actionable</dt>
            <dd>{count?.actionable ?? 0}</dd>
          </div>
        </dl>
      </header>
      <form className="filter-bar category-filters">
        <select
          name="protocol"
          defaultValue={
            typeof search.protocol === "string" ? search.protocol : ""
          }
          aria-label="Protocol"
        >
          <option value="">All verified protocols</option>
          {(count?.protocols ?? []).map((protocol) => (
            <option key={protocol}>{protocol}</option>
          ))}
        </select>
        <select
          name="tier"
          defaultValue={typeof search.tier === "string" ? search.tier : ""}
          aria-label="Tier"
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
        <button>Apply filters</button>
      </form>
      {agentsResponse.error !== null ? (
        <div className="state-panel">
          <span>Unavailable</span>
          <h3>Verified inventory could not be loaded.</h3>
          <p>{agentsResponse.error}</p>
        </div>
      ) : agents.length === 0 ? (
        <div className="state-panel category-empty">
          <span>Verification in progress</span>
          <h3>
            No {category.label} agents have passed Relic verification yet.
          </h3>
          <p>
            Relic is currently testing candidate agents discovered across BNB
            Chain. Candidate identities remain internal until they work.
          </p>
          <Link href="/marketplace">Explore other categories</Link>
        </div>
      ) : (
        <AgentGrid agents={agents} />
      )}
    </main>
  );
}
