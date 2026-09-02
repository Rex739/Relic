import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronDown,
  MessageCircleOff,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { commercePriceLabel } from "../../../lib/commerce-display";
import {
  labelForCategory,
  marketplaceAgent,
  marketplaceOutcomeDescription,
  marketplaceOutcomeLabel,
  marketplacePriceLabel,
  productCapabilityLabel,
  relativeTime,
} from "../../../lib/marketplace";
import { activeOffers } from "../../../lib/commerce";
import { AgentAvatar } from "../../_components/agent-avatar";
import { AgentDescription } from "../../_components/agent-description-dialog";
import { OnChainDataDialog } from "../../_components/on-chain-data-dialog";
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
            <AgentDescription
              agentName={agent.name}
              description={agent.description}
            />
            <div className="tag-row">
              <span>{labelForCategory(agent.category)}</span>
              {agent.protocols.slice(0, 5).map((protocol) => (
                <span key={protocol}>{productCapabilityLabel(protocol)}</span>
              ))}
            </div>
            <section className="profile-metrics" aria-label="Agent metrics">
              <dl className="track-record-grid">
                <div>
                  <dt>Completion rate</dt>
                  <dd>
                    {agent.completionRatePercent === null
                      ? "No job history yet"
                      : `${agent.completionRatePercent}% Completion · ${agent.completedCommerceJobCount} of ${agent.eligibleAcceptedJobCount} jobs`}
                  </dd>
                </div>
                <div>
                  <dt>Completed jobs</dt>
                  <dd>
                    {agent.completedCommerceJobCount > 0
                      ? agent.completedCommerceJobCount
                      : "No completed commerce jobs yet"}
                  </dd>
                </div>
                <div>
                  <dt>Reviews</dt>
                  <dd>
                    {agent.reviewCount > 0
                      ? agent.reviewCount
                      : "No verified reviews yet"}
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
                  <dt>On-chain data</dt>
                  <dd>
                    <OnChainDataDialog
                      data={{
                        externalAgentId: agent.externalAgentId,
                        chainId: agent.chainId,
                        registryAddress: agent.registryAddress,
                        ownerAddress: agent.ownerAddress,
                        registrationBlock: agent.registrationBlock,
                        metadataUri: agent.metadataUri,
                        serviceEndpoints: agent.services.map(
                          (service) => service.endpoint,
                        ),
                        offerTerms: offers.map((offer) => ({
                          version: offer.version.version,
                          termsHash: offer.version.termsHash,
                        })),
                        evidence: agent.evidence.map((item) => ({
                          fieldPath: item.fieldPath,
                          source: item.source,
                          observedAt: new Date(
                            item.observedAt,
                          ).toLocaleString(),
                        })),
                      }}
                    />
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      </header>

      <div className="profile-layout">
        <div className="profile-main">
          <section className="profile-section profile-summary-section">
            <div className="profile-summary-block">
              <span className="overline">What this agent does</span>
              <h2>Capabilities</h2>
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
            </div>
            <div className="profile-summary-block">
              <span className="overline">Important restrictions</span>
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
                <p>
                  No operator restrictions are published. Check the listed
                  restrictions before hiring.
                </p>
              )}
            </div>
            <div className="profile-summary-block checked-service-summary">
              <span className="overline">Service checked by Relic</span>
              {agent.services.map((service) => {
                const serviceOffer = offers.find(
                  (offer) => offer.serviceId === service.id,
                );
                return (
                  <div key={service.id} className="checked-service-row">
                    <div>
                      <b>{productCapabilityLabel(service.name)}</b>
                      <span>
                        {serviceOffer === undefined
                          ? "No active offer"
                          : commercePriceLabel(serviceOffer.version.price)}
                      </span>
                    </div>
                    <small>
                      Checked {relativeTime(service.lastVerifiedAt)}
                    </small>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="profile-secondary-grid">
            <section className="profile-secondary-panel">
              <span className="overline">Reviews</span>
              <div
                className={
                  agent.reviews.length > 0
                    ? "marketplace-reviews"
                    : "marketplace-reviews-empty"
                }
              >
                {agent.reviewCount > 0 ? (
                  <span className="review-summary">
                    <span>
                      {agent.reviewCount}{" "}
                      {agent.reviewCount === 1 ? "Review" : "Reviews"}
                      {" · "}
                      {agent.reviewGoodCount} good · {agent.reviewBadCount} bad
                    </span>
                  </span>
                ) : null}
                {agent.reviews.length === 0 ? (
                  <div className="empty-review-state">
                    <MessageCircleOff aria-hidden="true" size={24} />
                    <div>
                      <b>No reviews yet</b>
                    </div>
                  </div>
                ) : (
                  <div className="review-list">
                    {agent.reviews.map((review) => (
                      <article key={review.id}>
                        <span className="review-avatar" aria-hidden="true">
                          {review.reviewerRole === "BUYER" ? "B" : "A"}
                        </span>
                        <div className="review-content">
                          <div className="review-meta">
                            <b>
                              {review.reviewerRole === "BUYER"
                                ? "Marketplace buyer"
                                : "Marketplace agent"}
                            </b>
                            <time>{relativeTime(review.createdAt)}</time>
                          </div>
                          {review.tags.length > 0 ? (
                            <div className="review-tags">
                              {review.tags.map((tag) => (
                                <span key={tag}>
                                  {review.sentiment === "GOOD" ? (
                                    <ThumbsUp aria-hidden="true" size={13} />
                                  ) : (
                                    <ThumbsDown aria-hidden="true" size={13} />
                                  )}
                                  {productCapabilityLabel(tag)}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {review.message === null ? null : (
                            <p>{review.message}</p>
                          )}
                          <small>Verified marketplace job</small>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
            {agent.outcomes.length > 0 ? (
              <section className="profile-secondary-panel">
                <span className="overline">Activity</span>
                <div className="outcome-list">
                  {agent.outcomes.map((outcome, index) => (
                    <details
                      className="activity-record"
                      key={`${outcome.observedAt}-${index}`}
                    >
                      <summary>
                        <b>{marketplaceOutcomeLabel(outcome)}</b>
                        <span className="outcome-cost">
                          Cost {outcome.observedCost}
                        </span>
                        <span
                          className={
                            outcome.commerceSuccessful ||
                            outcome.invocationSuccessful
                              ? "outcome-status is-success"
                              : "outcome-status"
                          }
                        >
                          {outcome.settlementState.replaceAll("_", " ")}
                        </span>
                        <time
                          dateTime={outcome.observedAt}
                          title={new Intl.DateTimeFormat("en", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(outcome.observedAt))}
                        >
                          {relativeTime(outcome.observedAt)}
                        </time>
                        <ChevronDown
                          aria-hidden="true"
                          className="activity-chevron"
                          size={16}
                        />
                      </summary>
                      <div className="activity-record-details">
                        <p>
                          {marketplaceOutcomeDescription(outcome)} Service
                          response: {outcome.responseStatus ?? "not recorded"}.
                        </p>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
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
        </div>
        <aside className="profile-status-rail">
          <div className="profile-action">
            <span>Agent status</span>
            <div className="buyer-summary-list">
              <div>
                <span>Status</span>
                <b className={agent.hireable ? "live-status" : undefined}>
                  {agent.hireable ? <i /> : null}
                  {agent.hireable ? "Live" : "Not available"}
                </b>
              </div>
              <div>
                <span>Service</span>
                <b>{marketplacePriceLabel(agent.activeOfferPrice)}</b>
              </div>
              <div>
                <span>Permissions</span>
                <b>{isReadOnly ? "Read-only" : "Set during hire"}</b>
              </div>
            </div>
            <p>Last active {relativeTime(agent.lastVerifiedAt)}.</p>
            {isReadOnly ? (
              <p className="funds-access-summary">
                This service cannot move your funds.
              </p>
            ) : null}
            {agent.hireable ? (
              <div className="action-boundary actionable-boundary">
                <Link
                  href={`/agents/${agent.id}/hire`}
                  className="activate-link"
                >
                  Hire agent
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
          </div>
        </aside>
      </div>
    </main>
  );
}
