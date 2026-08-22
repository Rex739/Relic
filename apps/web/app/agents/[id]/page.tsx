import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatBaseUnits } from "@relic/domain";
import {
  labelForCategory,
  marketplaceAgent,
  provenanceLabel,
  relativeTime,
} from "../../../lib/marketplace";
import { activeOffers } from "../../../lib/commerce";
import { VerificationTier } from "../../_components/verification-tier";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Agent intelligence" };

const evidenceGroup = (fieldPath: string) => {
  const field = fieldPath.toLowerCase();
  if (
    /identity|chain|registry|agent.?id|owner|registration|transaction/.test(
      field,
    )
  )
    return "Identity";
  if (/service|endpoint|interface|protocol|capabilit|pricing/.test(field))
    return "Service";
  return "Metadata";
};

export default async function AgentIntelligencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const response = await marketplaceAgent(id);
  if (response.data === null && response.error?.includes("404")) notFound();
  if (response.data === null)
    return (
      <main className="page-shell profile-page">
        <div className="state-panel">
          <span>Connection interrupted</span>
          <h1>Agent intelligence is temporarily unavailable.</h1>
          <p>{response.error}</p>
          <Link href="/marketplace">Return to marketplace</Link>
        </div>
      </main>
    );
  const agent = response.data;
  const offers = await activeOffers(id);
  const evidenceGroups = ["Identity", "Metadata", "Service"].map((group) => ({
    group,
    items: agent.evidence.filter(
      (item) => evidenceGroup(item.fieldPath) === group,
    ),
  }));

  return (
    <main className="page-shell profile-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/marketplace">Marketplace</Link>
        <span>/</span>
        <Link
          href={`/categories/${agent.category === "health-factor-monitoring" ? "health-factor" : agent.category}`}
        >
          {labelForCategory(agent.category)}
        </Link>
        <span>/</span>
        <span>{agent.name}</span>
      </nav>
      <header className="profile-header">
        <div className="profile-identity">
          <div className="agent-avatar large">
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="profile-badges">
              <VerificationTier tier={agent.tier} />
              <span
                className={
                  agent.chainId === 97
                    ? "network-label testnet-tag"
                    : "network-label"
                }
              >
                {agent.network}
              </span>
              {agent.supplyType === "relic_reference" ? (
                <span className="operator-label">Relic-operated reference</span>
              ) : (
                <span className="operator-label">Third-party operator</span>
              )}
            </div>
            <h1>{agent.name}</h1>
            <p>{agent.description}</p>
            <div className="tag-row">
              <span>{labelForCategory(agent.category)}</span>
              {agent.protocols.slice(0, 5).map((protocol) => (
                <span key={protocol}>{protocol.toUpperCase()}</span>
              ))}
            </div>
          </div>
        </div>
        <aside className="profile-action">
          <span>Current operability</span>
          <strong>
            <i /> Available
          </strong>
          <p>
            Last independently checked {relativeTime(agent.lastVerifiedAt)}.
          </p>
          {agent.tier === "Actionable" && offers.length > 0 ? (
            <div className="action-boundary actionable-boundary">
              <span>Verified offer available</span>
              <b>Hireable on {agent.network}</b>
              <p>
                Review immutable commercial terms, configure a mandate, and
                authorize each distinct boundary separately.
              </p>
              <Link href={`/agents/${agent.id}/hire`} className="activate-link">
                Hire agent <small>Review verified offers</small>
              </Link>
            </div>
          ) : agent.tier === "Actionable" ? (
            <div className="action-boundary">
              <b>No active verified offer</b>
              <p>
                This service is Actionable, but its operator has not published
                currently valid terms. Hiring is unavailable.
              </p>
            </div>
          ) : (
            <div className="action-boundary">
              <b>Commerce not yet verified</b>
              <p>
                Relic has verified successful responses. Hiring remains
                unavailable until the commerce path is independently tested.
              </p>
            </div>
          )}
        </aside>
      </header>

      <div className="profile-layout">
        <div className="profile-main">
          {offers.length > 0 ? (
            <section className="profile-section commerce-offers">
              <span className="overline">Verified offers</span>
              <h2>Commercial terms published by the operator</h2>
              <p>
                Offer terms are operator-authored. Relic independently checks
                the bound identity, service eligibility, and evidence freshness.
              </p>
              {offers.map((offer) => (
                <article key={offer.id} className="offer-card">
                  <div>
                    <span>
                      {offer.version.billingModel.replaceAll("_", " ")}
                    </span>
                    <h3>{offer.version.capability}</h3>
                    <p>
                      {offer.version.limitationsSnapshot.join(" · ") ||
                        "No additional limitations published"}
                    </p>
                  </div>
                  <dl>
                    <div>
                      <dt>Price</dt>
                      <dd>
                        {formatBaseUnits(
                          offer.version.price.amountBaseUnits,
                          offer.version.price.decimals,
                        )}{" "}
                        {offer.version.price.symbol}
                      </dd>
                    </div>
                    <div>
                      <dt>Network</dt>
                      <dd>
                        {offer.version.chainId === 97
                          ? "BSC Testnet"
                          : "BSC Mainnet"}
                      </dd>
                    </div>
                    <div>
                      <dt>Offer version</dt>
                      <dd>v{offer.version.version}</dd>
                    </div>
                    <div>
                      <dt>Terms hash</dt>
                      <dd>{offer.version.termsHash.slice(0, 12)}…</dd>
                    </div>
                  </dl>
                  <Link href={`/agents/${agent.id}/hire?offer=${offer.id}`}>
                    Review and hire →
                  </Link>
                </article>
              ))}
            </section>
          ) : null}
          <section className="profile-section">
            <span className="overline">What this agent does</span>
            <h2>Verified capability, in plain language</h2>
            <p className="large-copy">{agent.description}</p>
            <div className="capability-list">
              {(agent.capabilities.length > 0
                ? agent.capabilities
                : agent.interfaces
              ).map((capability) => (
                <span key={capability}>
                  ✓ {capability.replaceAll("-", " ")}
                </span>
              ))}
            </div>
          </section>

          <section className="profile-section">
            <span className="overline">Relic verification</span>
            <h2>Why this agent is surfaced</h2>
            <div className="verification-grid">
              {[
                ["Identity", "Onchain verified", agent.checks.identityVerified],
                ["Endpoint", "Reachable", agent.checks.endpointReachable],
                [
                  "Protocol",
                  "Interface confirmed",
                  agent.checks.protocolVerified,
                ],
                [
                  "Invocation",
                  "Controlled test passed",
                  agent.checks.invocationVerified,
                ],
                [
                  "Commerce",
                  agent.checks.commerceVerified
                    ? "Lifecycle verified"
                    : "Not yet verified",
                  agent.checks.commerceVerified,
                ],
              ].map(([label, value, passed]) => (
                <div key={String(label)}>
                  <span>{label}</span>
                  <b className={passed ? "passed" : "pending"}>
                    {passed ? "✓" : "○"} {value}
                  </b>
                </div>
              ))}
            </div>
            {agent.surfacedBecause.length > 0 ? (
              <div className="surfaced-because">
                <b>Classification evidence</b>
                {agent.surfacedBecause.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
              </div>
            ) : null}
          </section>

          <section className="profile-section">
            <span className="overline">Verified services</span>
            <h2>Interfaces Relic has tested</h2>
            <div className="service-list">
              {agent.services.map((service) => (
                <article key={service.id}>
                  <div>
                    <span className="service-icon">↗</span>
                    <div>
                      <h3>{service.name}</h3>
                      <p>
                        {service.interface.toUpperCase()} ·{" "}
                        {service.availability}
                      </p>
                    </div>
                  </div>
                  <span className="tier tier-working">
                    ●{" "}
                    {service.verificationLevel === "COMMERCE_VERIFIED"
                      ? "Commerce verified"
                      : "Invocation verified"}
                  </span>
                  <dl>
                    <div>
                      <dt>Endpoint</dt>
                      <dd>{new URL(service.endpoint).host}</dd>
                    </div>
                    <div>
                      <dt>Pricing</dt>
                      <dd>
                        {service.pricing === null
                          ? "Not published"
                          : "Published"}
                      </dd>
                    </div>
                    <div>
                      <dt>Last inspected</dt>
                      <dd>{relativeTime(service.lastVerifiedAt)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          {agent.outcomes.length > 0 ? (
            <section className="profile-section">
              <span className="overline">Execution & commerce</span>
              <h2>Observed outcomes</h2>
              <div className="outcome-list">
                {agent.outcomes.map((outcome, index) => (
                  <article key={`${outcome.observedAt}-${index}`}>
                    <b>✓ {outcome.settlementState}</b>
                    <span>
                      {outcome.responseStatus ?? "Execution observed"}
                    </span>
                    <span>Cost {outcome.observedCost}</span>
                    <time>{new Date(outcome.observedAt).toLocaleString()}</time>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="evidence-rail">
          <section>
            <span className="overline">Evidence coverage</span>
            <h2>Fact provenance</h2>
            <p>
              Every important claim retains its source and observation time.
            </p>
            <div className="provenance-groups">
              {evidenceGroups.map(({ group, items }) => (
                <div className="provenance-group" key={group}>
                  <div className="provenance-group-heading">
                    <b>{group}</b>
                    <span>{items.length}</span>
                  </div>
                  {items.length === 0 ? (
                    <p>No recorded {group.toLowerCase()} facts.</p>
                  ) : (
                    <div className="evidence-list">
                      {items.map((item, index) => (
                        <div
                          key={`${item.fieldPath}-${item.observedAt}-${index}`}
                        >
                          <i />
                          <div>
                            <b title={item.fieldPath}>{item.label}</b>
                            <span>{provenanceLabel(item.provenance)}</span>
                            <span>Source: {item.source}</span>
                            <time>{relativeTime(item.observedAt)}</time>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
          <details className="technical-details">
            <summary>Technical identity</summary>
            <dl>
              <div>
                <dt>ERC-8004 agent</dt>
                <dd>{agent.externalAgentId}</dd>
              </div>
              <div>
                <dt>Chain</dt>
                <dd>{agent.chainId}</dd>
              </div>
              <div>
                <dt>Registry</dt>
                <dd>{agent.registryAddress}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{agent.ownerAddress}</dd>
              </div>
              <div>
                <dt>Registration block</dt>
                <dd>{agent.registrationBlock ?? "Not recorded"}</dd>
              </div>
            </dl>
          </details>
        </aside>
      </div>
    </main>
  );
}
