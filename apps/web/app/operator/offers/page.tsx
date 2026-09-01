import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import {
  erc8183PaymentTokens,
  formatBaseUnits,
  type AgentOffer,
  type SellerAgentReadiness,
} from "@relic/domain";

import {
  operatorAgreements,
  operatorOffers,
  operatorReadiness,
} from "../../../lib/commerce";
import { labelForCategory } from "../../../lib/marketplace";
import { usableAgentImageUrl } from "../../../lib/agent-presentation";
import { buttonVariants } from "../../../components/ui/button";
import {
  createOfferAction,
  reviseOfferAction,
  transitionOfferAction,
  updateSellerProfileAction,
  updateSellerServiceEndpointAction,
} from "../../operator-actions";
import { CreateOfferDialog } from "../../_components/create-offer-dialog";
import { AccountSidebar } from "../../_components/account-sidebar";
import { OfferDetailsEditor } from "../../_components/offer-details-editor";
import { SellerProfileEditor } from "../../_components/seller-profile-editor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My listings" };

type OfferableSellerAgent = Omit<SellerAgentReadiness, "serviceId"> & {
  serviceId: string;
};

const canCreateOffer = (
  agent: SellerAgentReadiness,
): agent is OfferableSellerAgent =>
  agent.serviceId !== null &&
  !agent.testDeployment &&
  agent.requirements.identity.state === "complete" &&
  agent.requirements.service.state === "complete" &&
  agent.requirements.verification.state === "complete" &&
  agent.requirements.offer.state !== "complete";

const setupBlockers = (agent: SellerAgentReadiness) => {
  const readiness = [
    agent.requirements.identity,
    agent.requirements.service,
    agent.requirements.verification,
  ].filter((requirement) => requirement.state !== "complete");
  return agent.testDeployment
    ? [
        ...readiness,
        {
          state: "blocked" as const,
          label: "Production-ready agent required",
          explanation:
            "This agent identifies itself as a test deployment and cannot be listed for buyers.",
          nextAction: "Use a production-ready agent",
        },
      ]
    : readiness;
};

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const { agent: externalAgentId } = await searchParams;
  let offers: Awaited<ReturnType<typeof operatorOffers>> = [];
  let history: Awaited<ReturnType<typeof operatorAgreements>> = [];
  let readiness: SellerAgentReadiness[] = [];
  let error: string | null = null;
  try {
    [offers, history, readiness] = await Promise.all([
      operatorOffers(),
      operatorAgreements(),
      operatorReadiness(),
    ]);
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : "Operator data unavailable";
  }
  if (error !== null)
    return (
      <main className="page-shell operator-page">
        <header className="operations-header">
          <span className="overline">Verified seller controls</span>
          <h1>My listings</h1>
          <p>
            Connect the wallet registered as the agent owner to view readiness
            and manage marketplace offers.
          </p>
        </header>
        <div className="state-panel">
          <h2>Connect the operator wallet.</h2>
          <p>{error}</p>
        </div>
      </main>
    );
  const ownedOffers = offers.filter(
    (offer): offer is AgentOffer => offer !== null,
  );
  const currentOffers = ownedOffers.filter(
    (offer) => offer.status !== "DEACTIVATED" && offer.status !== "EXPIRED",
  );
  const archivedOffers = ownedOffers.filter(
    (offer) => offer.status === "DEACTIVATED" || offer.status === "EXPIRED",
  );
  const currentOfferKeys = new Set(
    currentOffers.map((offer) => `${offer.agentId}:${offer.serviceId}`),
  );
  const currentOfferByAgentId = new Map(
    currentOffers.map((offer) => [offer.agentId, offer]),
  );
  const selectedReadiness =
    externalAgentId === undefined
      ? readiness
      : readiness.filter((agent) => agent.externalAgentId === externalAgentId);
  const selectedAgentIds = new Set(
    selectedReadiness.map((agent) => agent.agentId),
  );
  const visibleCurrentOffers =
    externalAgentId === undefined
      ? currentOffers
      : currentOffers.filter((offer) => selectedAgentIds.has(offer.agentId));
  const visibleArchivedOffers =
    externalAgentId === undefined
      ? archivedOffers
      : archivedOffers.filter((offer) => selectedAgentIds.has(offer.agentId));
  const offerableAgents = selectedReadiness
    .filter(canCreateOffer)
    .filter(
      (agent) => !currentOfferKeys.has(`${agent.agentId}:${agent.serviceId}`),
    );
  const selectedAgentHasCurrentOffer = selectedReadiness.some((agent) =>
    currentOfferByAgentId.has(agent.agentId),
  );
  const selectedAgent = selectedReadiness[0] ?? null;
  const selectedSetupBlockers =
    selectedAgent === null ? [] : setupBlockers(selectedAgent);
  return (
    <main className="page-shell operator-page">
      <header className="operations-header">
        <span className="overline">Verified seller controls</span>
        <h1>My listings</h1>
        <p>
          Configure the agents you offer on Relic. Each listing keeps its
          verified service and offer history together.
        </p>
      </header>
      <div className="account-workspace">
        <AccountSidebar />
        <div className="account-workspace-content">
          {!readiness.some(
            (agent) => agent.requirements.identity.state === "complete",
          ) ? (
            <section className="seller-entry-card">
              <div>
                <span className="overline">New seller</span>
                <h2>List your agent</h2>
                <p>
                  Claim a real ERC-8004 identity before managing services or
                  offers.
                </p>
              </div>
              <Link
                className={buttonVariants({ size: "lg" })}
                href="/account/mylistings/new"
              >
                <ShieldCheck aria-hidden="true" size={18} strokeWidth={2} />
                Verify agent ownership
              </Link>
            </section>
          ) : null}
          {externalAgentId === undefined && readiness.length > 0 ? (
            <section className="profile-section seller-agent-list-section">
              <div className="section-heading">
                <div>
                  <span className="overline">Your agents</span>
                  <h2>Your agents</h2>
                </div>
                <p>Choose an agent to configure its marketplace listing.</p>
              </div>
              <div className="seller-agent-list">
                {readiness.map((agent) => {
                  const currentOffer = currentOfferByAgentId.get(agent.agentId);
                  const canSetUpOffer = canCreateOffer(agent);
                  const blockers = setupBlockers(agent);
                  const status = agent.hireable
                    ? "Ready to hire"
                    : currentOffer
                      ? currentOffer.status === "ACTIVE"
                        ? "Offer active"
                        : "Draft"
                    : canSetUpOffer
                      ? "Ready to configure"
                      : blockers[0]?.label ?? "Setup required";
                  return (
                    <article
                      className="seller-agent-list-item"
                      key={agent.agentId}
                    >
                      <div className="seller-agent-list-main">
                        <img
                          alt=""
                          className="seller-agent-avatar"
                          src={usableAgentImageUrl(agent.imageUrl)}
                        />
                        <div>
                          <h3>{agent.name}</h3>
                          <span className="overline">
                            {labelForCategory(agent.category)}
                          </span>
                          <p>
                            {agent.description ||
                              `ERC-8004 agent #${agent.externalAgentId}`}
                          </p>
                          <dl className="seller-agent-facts">
                            <div>
                              <dt>Agent ID</dt>
                              <dd>#{agent.externalAgentId}</dd>
                            </div>
                            <div>
                              <dt>Network</dt>
                              <dd>
                                {agent.chainId === 97
                                  ? "BNB Testnet"
                                  : "BNB Chain"}
                              </dd>
                            </div>
                            <div>
                              <dt>Service</dt>
                              <dd>
                                {agent.requirements.service.state ===
                                  "complete" &&
                                agent.requirements.verification.state ===
                                  "complete"
                                  ? "Verified"
                                  : "Needs attention"}
                              </dd>
                            </div>
                            <div>
                              <dt>Price</dt>
                              <dd>
                                {agent.verifiedPrice === null
                                  ? "Set during offer setup"
                                  : `${formatBaseUnits(agent.verifiedPrice.amountBaseUnits, agent.verifiedPrice.decimals)} ${agent.verifiedPrice.symbol}`}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                      <div className="seller-agent-list-action">
                        <span className="seller-agent-status">{status}</span>
                        <Link
                          className={buttonVariants({ size: "sm" })}
                          href={`/account/mylistings?agent=${encodeURIComponent(agent.externalAgentId)}`}
                        >
                          Configure
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
          {externalAgentId === undefined || selectedAgent === null ? null : (
            <>
              <Link className="listing-back-link" href="/account/mylistings">
                ← Back to My listings
              </Link>
              <SellerProfileEditor
                action={updateSellerProfileAction.bind(
                  null,
                  selectedAgent.agentId,
                )}
                agent={selectedAgent}
                serviceAction={
                  selectedAgent.serviceId === null
                    ? undefined
                    : updateSellerServiceEndpointAction.bind(
                        null,
                        selectedAgent.agentId,
                        selectedAgent.serviceId,
                      )
                }
                offerAction={offerableAgents.map((agent) => (
                  <CreateOfferDialog
                    action={createOfferAction}
                    agent={agent}
                    key={agent.agentId}
                    paymentToken={erc8183PaymentTokens[agent.chainId]}
                  />
                ))}
              />
            </>
          )}
          {externalAgentId === undefined ? null : (
            <section
              className="profile-section seller-offer-management"
              id="marketplace-offers"
            >
              <div className="section-heading">
                <div>
                  <span className="overline">Marketplace offers</span>
                  <h2>Offer details</h2>
                </div>
                <p>
                  {selectedAgent?.hireable
                    ? "This agent is live and ready for buyers to hire. Completed buyer work will appear in its track record."
                    : offerableAgents.length > 0
                    ? "Save the marketplace profile, then create the first offer when you are ready."
                    : selectedAgentHasCurrentOffer
                      ? "Edit the buyer-facing details for this agent’s marketplace offer."
                      : selectedSetupBlockers[0]?.explanation ??
                        "Finish the remaining setup requirements before creating an offer."}
                </p>
              </div>
              {visibleCurrentOffers.length === 0 ? (
                <p className="seller-offer-empty">
                  No marketplace offer drafts or published offers yet.
                </p>
              ) : (
                visibleCurrentOffers.map((offer) => (
                  <article key={offer.id} className="offer-card">
                    <div className="offer-card-header">
                      <h3>{offer.version.capability}</h3>
                      <span>{offer.status}</span>
                    </div>
                    <p>
                      {formatBaseUnits(
                        offer.version.price.amountBaseUnits,
                        offer.version.price.decimals,
                      )}{" "}
                      {offer.version.price.symbol} · v{offer.currentVersion}
                    </p>
                    <OfferDetailsEditor
                      action={reviseOfferAction.bind(null, offer.id)}
                      offer={{
                        agentId: offer.agentId,
                        billingModel: offer.version.billingModel,
                        capabilities:
                          offer.version.capabilitySnapshot.join(", "),
                        capability: offer.version.capability,
                        chainId: offer.version.chainId,
                        limitations:
                          offer.version.limitationsSnapshot.join("\n"),
                        price: {
                          amount: formatBaseUnits(
                            offer.version.price.amountBaseUnits,
                            offer.version.price.decimals,
                          ),
                          decimals: offer.version.price.decimals,
                          symbol: offer.version.price.symbol,
                          tokenAddress: offer.version.price.tokenAddress,
                        },
                        serviceId: offer.serviceId,
                        terms: offer.version.terms,
                      }}
                    />
                    <div className="relationship-actions">
                      {offer.status === "DRAFT" || offer.status === "PAUSED" ? (
                        <form
                          action={transitionOfferAction.bind(
                            null,
                            offer.id,
                            "activate",
                          )}
                        >
                          <button>Activate</button>
                        </form>
                      ) : null}
                      {offer.status === "ACTIVE" ? (
                        <form
                          action={transitionOfferAction.bind(
                            null,
                            offer.id,
                            "pause",
                          )}
                        >
                          <button>Pause</button>
                        </form>
                      ) : null}
                      {offer.status !== "DEACTIVATED" ? (
                        <form
                          action={transitionOfferAction.bind(
                            null,
                            offer.id,
                            "deactivate",
                          )}
                        >
                          <button className="danger-link">
                            {offer.status === "DRAFT"
                              ? "Discard draft"
                              : "Deactivate"}
                          </button>
                        </form>
                      ) : null}
                    </div>
                    {offer.status === "DRAFT" ? (
                      <small>
                        Discarding removes this draft from current offers while
                        preserving its audit record.
                      </small>
                    ) : null}
                  </article>
                ))
              )}
              {visibleArchivedOffers.length > 0 ? (
                <details className="archived-offers">
                  <summary>
                    Archived offers ({visibleArchivedOffers.length})
                  </summary>
                  <div>
                    {visibleArchivedOffers.map((offer) => (
                      <article key={offer.id} className="offer-card">
                        <div>
                          <h3>{offer.version.capability}</h3>
                          <span>{offer.status}</span>
                        </div>
                        <p>
                          {formatBaseUnits(
                            offer.version.price.amountBaseUnits,
                            offer.version.price.decimals,
                          )}{" "}
                          {offer.version.price.symbol} · v{offer.currentVersion}
                        </p>
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}
            </section>
          )}
        </div>
      </div>
      {externalAgentId === undefined ? null : (
        <section className="profile-section">
          <h2>Agreement, job & settlement history</h2>
          <p>
            {history.length === 0
              ? "No buyer agreements exist for these offers."
              : `${history.length} commerce record${history.length === 1 ? "" : "s"} visible to this verified operator.`}
          </p>
          <details className="technical-details">
            <summary>Operator-scoped technical records</summary>
            <pre>{JSON.stringify(history, null, 2)}</pre>
          </details>
        </section>
      )}
    </main>
  );
}
