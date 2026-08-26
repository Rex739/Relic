import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { commercePriceLabel } from "../../../lib/commerce-display";
import {
  labelForCategory,
  marketplaceAgent,
  marketplaceOutcomeLabel,
  productCapabilityLabel,
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
                <span key={protocol}>{productCapabilityLabel(protocol)}</span>
              ))}
            </div>
          </div>
        </div>
        <aside className="profile-action">
          <span>Service status</span>
          <strong>
            <i /> Live
          </strong>
          <p>
            Last independently checked {relativeTime(agent.lastVerifiedAt)}.
          </p>
          {agent.tier === "Actionable" && offers.length > 0 ? (
            <div className="action-boundary actionable-boundary">
              <span>Available to hire</span>
              <b>{commercePriceLabel(offers[0]!.version.price)}</b>
              <p>
                Review the service, choose permissions, and confirm with your
                wallet.
              </p>
              <Link href={`/agents/${agent.id}/hire`} className="activate-link">
                Hire agent <small>Start setup</small>
              </Link>
              <Link
                href={`/compare?ids=${agent.id}`}
                className="profile-compare-link"
              >
                Compare agent
              </Link>
            </div>
          ) : agent.tier === "Actionable" ? (
            <div className="action-boundary">
              <b>No active verified offer</b>
              <p>
                This agent works, but the operator has no currently available
                service offer.
              </p>
            </div>
          ) : (
            <div className="action-boundary">
              <b>Commerce not yet verified</b>
              <p>
                Relic recently reached this agent successfully. Hiring remains
                unavailable until its service setup has been tested.
              </p>
            </div>
          )}
        </aside>
      </header>

      <div className="profile-layout">
        <div className="profile-main">
          <section className="profile-section track-record-section">
            <div className="section-heading compact-heading">
              <div>
                <span className="overline">Track record</span>
                <h2>Recent, attributable history</h2>
              </div>
              <span className="live-status">
                <i /> Last active {relativeTime(agent.lastVerifiedAt)}
              </span>
            </div>
            <dl className="track-record-grid">
              <div>
                <dt>Completed jobs</dt>
                <dd>
                  {agent.completedCommerceJobCount > 0
                    ? agent.completedCommerceJobCount
                    : "No completed commerce jobs yet"}
                </dd>
              </div>
              <div>
                <dt>Verified service checks</dt>
                <dd>
                  {agent.verifiedInvocationCount > 0
                    ? agent.verifiedInvocationCount
                    : "No verified invocations yet"}
                </dd>
              </div>
              <div>
                <dt>Deliveries submitted</dt>
                <dd>
                  {agent.deliveryCompletedCount > 0
                    ? agent.deliveryCompletedCount
                    : "No deliveries yet"}
                </dd>
              </div>
              <div>
                <dt>Settlements completed</dt>
                <dd>
                  {agent.settlementCompletedCount > 0
                    ? agent.settlementCompletedCount
                    : "No settlements yet"}
                </dd>
              </div>
              <div>
                <dt>Unsuccessful commerce jobs</dt>
                <dd>
                  {agent.unsuccessfulCommerceJobCount > 0
                    ? agent.unsuccessfulCommerceJobCount
                    : "No failed, cancelled, rejected, or refunded jobs"}
                </dd>
              </div>
            </dl>
            <p className="data-integrity-note">
              Verification checks and user jobs are kept separate. Relic does
              not infer ratings or success rates from missing history.
            </p>
          </section>
          {offers.length > 0 ? (
            <section className="profile-section commerce-offers">
              <span className="overline">Services</span>
              <h2>Choose what you want this agent to do</h2>
              <p>
                Current service offers published by the operator and checked by
                Relic.
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
                      <dd>{commercePriceLabel(offer.version.price)}</dd>
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
                    Hire this service →
                  </Link>
                </article>
              ))}
            </section>
          ) : null}
          <section className="profile-section">
            <span className="overline">What this agent does</span>
            <h2>Capabilities</h2>
            <p className="large-copy">{agent.description}</p>
            <div className="capability-list">
              {(agent.capabilities.length > 0
                ? agent.capabilities
                : agent.interfaces
              ).map((capability) => (
                <span key={capability}>
                  ✓ {productCapabilityLabel(capability)}
                </span>
              ))}
            </div>
          </section>

          <section className="profile-section restrictions-section">
            <span className="overline">What this agent cannot do</span>
            <h2>Operating restrictions</h2>
            {offers.some(
              (offer) => offer.version.limitationsSnapshot.length > 0,
            ) ? (
              <div className="restriction-list">
                {[
                  ...new Set(
                    offers.flatMap(
                      (offer) => offer.version.limitationsSnapshot,
                    ),
                  ),
                ].map((restriction) => (
                  <span key={restriction}>× {restriction}</span>
                ))}
              </div>
            ) : (
              <p className="large-copy">
                No operator restrictions are published. Review the service terms
                and permissions before hiring.
              </p>
            )}
          </section>

          <details className="profile-section verification-details">
            <summary>Verification details</summary>
            <span className="overline">Relic checks</span>
            <h2>Why this agent is listed</h2>
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
          </details>

          <section className="profile-section">
            <span className="overline">Verified services</span>
            <h2>Interfaces Relic has tested</h2>
            <div className="service-list">
              {agent.services.map((service) => {
                const serviceOffer = offers.find(
                  (offer) => offer.serviceId === service.id,
                );
                return (
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
                        <dt>Current offer</dt>
                        <dd>
                          {serviceOffer === undefined
                            ? "No active offer"
                            : commercePriceLabel(serviceOffer.version.price)}
                        </dd>
                      </div>
                      <div>
                        <dt>Last inspected</dt>
                        <dd>{relativeTime(service.lastVerifiedAt)}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>

          {agent.outcomes.length > 0 ? (
            <section className="profile-section">
              <span className="overline">Recent activity</span>
              <h2>What happened recently</h2>
              <div className="outcome-list">
                {agent.outcomes.map((outcome, index) => (
                  <article key={`${outcome.observedAt}-${index}`}>
                    <b>{marketplaceOutcomeLabel(outcome)}</b>
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
            <span className="overline">Verification details</span>
            <h2>Sources and recency</h2>
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
