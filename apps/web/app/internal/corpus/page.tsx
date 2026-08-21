import type { Metadata } from "next";

import {
  categories,
  internalMarketplaceStatus,
} from "../../../lib/marketplace";

export const metadata: Metadata = { title: "Corpus operations" };
export const dynamic = "force-dynamic";

export default async function CorpusOperationsPage() {
  const response = await internalMarketplaceStatus();
  const status = response.data?.data;
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
        </>
      )}
    </main>
  );
}
