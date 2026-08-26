import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { commercePriceLabel } from "../../../lib/commerce-display";
import {
  labelForCategory,
  marketplaceAgent,
  marketplaceOutcomeLabel,
  productCapabilityLabel,
  relativeTime,
} from "../../../lib/marketplace";
import { activeOffers } from "../../../lib/commerce";
import { AgentAvatar } from "../../_components/agent-avatar";
import { VerificationTier } from "../../_components/verification-tier";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Agent intelligence" };

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
  const restrictions = offers.flatMap(
    (offer) => offer.version.limitationsSnapshot,
  );
  const isReadOnly = restrictions.some((restriction) =>
    /read.?only|cannot (transfer|move|spend)|no (transfer|transaction|spending)/i.test(
      restriction,
    ),
  );

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
          <AgentAvatar
            id={agent.id}
            imageUrl={agent.imageUrl}
            name={agent.name}
            size="profile"
          />
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
          <span>Agent status</span>
          <div className="buyer-summary-list">
            <div>
              <span>Status</span>
              <b className="live-status">
                <i /> Live
              </b>
            </div>
            <div>
              <span>Trust</span>
              <b>
                {agent.checks.identityVerified
                  ? "Verified by Relic"
                  : "Checks in progress"}
              </b>
            </div>
            <div>
              <span>Service</span>
              <b>
                {offers.length > 0
                  ? commercePriceLabel(offers[0]!.version.price)
                  : "No active offer"}
              </b>
            </div>
            <div>
              <span>Permissions</span>
              <b>{isReadOnly ? "Read-only" : "Set during hire"}</b>
            </div>
          </div>
          <p>Last active {relativeTime(agent.lastVerifiedAt)}.</p>
          <p className="funds-access-summary">
            {isReadOnly
              ? "This service cannot move your funds."
              : "You review any funds access before authorizing it."}
          </p>
          {agent.tier === "Actionable" && offers.length > 0 ? (
            <div className="action-boundary actionable-boundary">
              <Link href={`/agents/${agent.id}/hire`} className="activate-link">
                Hire agent <small>Review permissions</small>
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
                : [labelForCategory(agent.category)]
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

          <section className="profile-section">
            <span className="overline">Services</span>
            <h2>Services Relic has checked</h2>
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
                        <h3>{productCapabilityLabel(service.name)}</h3>
                        <p>{service.description ?? "Verified agent service"}</p>
                      </div>
                    </div>
                    <span className="tier tier-working">
                      ●{" "}
                      {service.verificationLevel === "COMMERCE_VERIFIED"
                        ? "Service and hiring checked"
                        : "Service checked"}
                    </span>
                    <dl>
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

          <section className="profile-section human-verification">
            <span className="overline">Verified by Relic</span>
            <h2>Checks you can understand</h2>
            <div className="trust-check-list">
              <div
                className={agent.checks.identityVerified ? "passed" : "pending"}
              >
                <b>
                  {agent.checks.identityVerified
                    ? "✓ Identity registered"
                    : "○ Identity check pending"}
                </b>
                <p>
                  {agent.checks.identityVerified
                    ? "This agent has a verifiable identity registered on BNB Chain."
                    : "Relic has not yet confirmed this agent’s registered identity."}
                </p>
              </div>
              <div
                className={
                  agent.checks.invocationVerified ? "passed" : "pending"
                }
              >
                <b>
                  {agent.checks.invocationVerified
                    ? "✓ Service checked"
                    : "○ Service check pending"}
                </b>
                <p>
                  {agent.checks.invocationVerified
                    ? "Relic successfully contacted the service and received a valid response."
                    : "Relic has not yet recorded a successful service test."}
                </p>
              </div>
              <div
                className={agent.checks.protocolVerified ? "passed" : "pending"}
              >
                <b>
                  {agent.checks.protocolVerified
                    ? "✓ Profile matches service"
                    : "○ Profile match pending"}
                </b>
                <p>
                  {agent.checks.protocolVerified
                    ? "The service Relic observed matches what this agent advertises."
                    : "Relic has not yet confirmed that the advertised profile matches the live service."}
                </p>
              </div>
            </div>
            <p className="verification-recency">
              Last checked {relativeTime(agent.checks.lastCheckedAt)}.
            </p>
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

        <details className="profile-section technical-details">
          <summary>View technical details</summary>
          <dl>
            <div>
              <dt>ERC-8004 Agent ID</dt>
              <dd>{agent.externalAgentId}</dd>
            </div>
            <div>
              <dt>Chain ID</dt>
              <dd>{agent.chainId}</dd>
            </div>
            <div>
              <dt>Registry address</dt>
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
            <div>
              <dt>Metadata URI</dt>
              <dd>{agent.metadataUri}</dd>
            </div>
            {agent.services.map((service) => (
              <div key={service.id}>
                <dt>Service URI</dt>
                <dd>{service.endpoint}</dd>
              </div>
            ))}
            {offers.map((offer) => (
              <div key={offer.id}>
                <dt>Offer v{offer.version.version} terms hash</dt>
                <dd>{offer.version.termsHash}</dd>
              </div>
            ))}
          </dl>
          {agent.evidence.length > 0 ? (
            <div className="technical-evidence">
              <h3>Evidence and provenance</h3>
              {agent.evidence.map((item, index) => (
                <p key={`${item.fieldPath}-${item.observedAt}-${index}`}>
                  <b>{item.fieldPath}</b> · {item.source} ·{" "}
                  {new Date(item.observedAt).toLocaleString()}
                </p>
              ))}
            </div>
          ) : null}
        </details>
      </div>
    </main>
  );
}
