import type { Metadata } from "next";

import {
  categories,
  internalMarketplaceStatus,
  marketplaceAgents,
  marketplaceCategories,
  readinessInventory,
} from "../../../lib/marketplace";

export const metadata: Metadata = { title: "Corpus operations" };
export const dynamic = "force-dynamic";

export default async function CorpusOperationsPage() {
  const [response, categoryResponse, ...inventoryResponses] = await Promise.all(
    [
      internalMarketplaceStatus(),
      marketplaceCategories(),
      ...categories.map((category) => {
        const query = new URLSearchParams({
          category: category.slug,
          limit: "48",
        });
        return marketplaceAgents(query);
      }),
    ],
  );
  const status = response.data?.data;
  const inventory = readinessInventory(inventoryResponses);
  const readinessError =
    categoryResponse.error ?? (inventory.ok ? null : inventory.error);
  const publicCategories = new Map(
    (categoryResponse.data?.data ?? []).map((category) => [
      category.slug,
      category,
    ]),
  );
  return (
    <main className="page-shell operations-page">
      <span className="overline">Internal operations</span>
      <h1>Discovery is not the marketplace.</h1>
      <p className="hero-copy">
        Relic keeps the full registration universe internal and promotes only
        independently workable supply.
      </p>
      {status === undefined ? (
        <div className="state-panel">
          <span>Unavailable</span>
          <h3>Corpus status could not be loaded.</h3>
          <p>{response.error}</p>
        </div>
      ) : (
        <>
          <section className="funnel-stats">
            <article>
              <span>BSC registrations discovered</span>
              <strong>{status.discovered.toLocaleString()}</strong>
              <p>Internal intelligence corpus</p>
            </article>
            <article>
              <span>Directly verified identities</span>
              <strong>{status.directlyVerified.toLocaleString()}</strong>
              <p>Onchain verification queue passed</p>
            </article>
            <article className="public-stat">
              <span>Relic workable agents</span>
              <strong>{status.publicMarketplace.toLocaleString()}</strong>
              <p>Visible in public marketplace</p>
            </article>
            <article className="actionable-stat">
              <span>Relic actionable agents</span>
              <strong>{status.actionable.toLocaleString()}</strong>
              <p>Commerce lifecycle evidence</p>
            </article>
          </section>
          <section className="operations-grid">
            <article>
              <h2>Corpus pipeline</h2>
              <dl>
                <div>
                  <dt>Enriched</dt>
                  <dd>{status.enriched}</dd>
                </div>
                <div>
                  <dt>Pending enrichment</dt>
                  <dd>{status.pendingEnrichment}</dd>
                </div>
                <div>
                  <dt>Verification queue</dt>
                  <dd>{status.verificationQueue}</dd>
                </div>
                <div>
                  <dt>Service-declared candidates</dt>
                  <dd>{status.serviceDeclared}</dd>
                </div>
                <div>
                  <dt>Invocation verified</dt>
                  <dd>{status.invocationVerified}</dd>
                </div>
                <div>
                  <dt>Stale / unreachable</dt>
                  <dd>{status.staleOrUnreachable}</dd>
                </div>
              </dl>
            </article>
            <article>
              <h2>Candidate categories</h2>
              <dl>
                {categories.map((category) => (
                  <div key={category.slug}>
                    <dt>{category.label}</dt>
                    <dd>{status.categoryCandidates[category.slug] ?? 0}</dd>
                  </div>
                ))}
              </dl>
              <p className="operations-note">
                Candidate counts are internal. They do not represent workable
                marketplace inventory.
              </p>
            </article>
          </section>
          <section className="category-readiness-section">
            <div className="section-heading">
              <div>
                <span className="overline">Category readiness</span>
                <h2>Supply promotion by competition category</h2>
              </div>
              <p>
                Internal candidates stay separate from agents that have passed
                public marketplace and hiring checks.
              </p>
            </div>
            {readinessError === null ? (
              <div className="category-readiness-grid">
                {categories.map((category, index) => {
                  const publicCount = publicCategories.get(category.slug);
                  const publicInventory = inventory.ok
                    ? inventory.items[index]!
                    : { data: [], pagination: { total: 0 } };
                  const publicAgents = publicInventory.data;
                  const hireable = publicAgents.filter(
                    (agent) => agent.hireable,
                  ).length;
                  const publicTotal =
                    publicInventory.pagination?.total ?? publicAgents.length;
                  return (
                    <article key={category.slug}>
                      <span className="category-index">0{index + 1}</span>
                      <h3>{category.label}</h3>
                      <dl>
                        <div>
                          <dt>Internal candidates</dt>
                          <dd>
                            {status.categoryCandidates[category.slug] ?? 0}
                          </dd>
                        </div>
                        <div>
                          <dt>Public</dt>
                          <dd>{publicTotal}</dd>
                        </div>
                        <div>
                          <dt>Working</dt>
                          <dd>{publicCount?.working ?? 0}</dd>
                        </div>
                        <div>
                          <dt>Actionable</dt>
                          <dd>{publicCount?.actionable ?? 0}</dd>
                        </div>
                        <div>
                          <dt>Hireable</dt>
                          <dd>{hireable}</dd>
                        </div>
                      </dl>
                      <p>
                        {hireable > 0
                          ? "Ready for buyer activation with current verified service and offer evidence."
                          : publicTotal > 0
                            ? "Publicly usable supply exists, but no current offer passes hiring checks."
                            : "Candidates remain internal until service, invocation, and eligibility evidence is current."}
                      </p>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="state-panel" role="alert">
                <span>Readiness unavailable</span>
                <h3>Category inventory could not be loaded.</h3>
                <p>{readinessError}</p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
