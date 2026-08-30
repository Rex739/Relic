import type { Metadata } from "next";

import { formatBaseUnits, type SellerAgentReadiness } from "@relic/domain";

import {
  operatorAgreements,
  operatorOffers,
  operatorReadiness,
} from "../../../lib/commerce";
import { labelForCategory, relativeTime } from "../../../lib/marketplace";
import {
  createOfferAction,
  reviseOfferAction,
  transitionOfferAction,
} from "../../operator-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Seller offers" };

export default async function OperatorOffersPage() {
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
          <h1>Get your agents ready for buyers.</h1>
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
  return (
    <main className="page-shell operator-page">
      <header className="operations-header">
        <span className="overline">Verified seller controls</span>
        <h1>Get your agents ready for buyers.</h1>
        <p>
          Relic checks identity, service availability, recent verification,
          commerce evidence, and your published offer before showing an agent in
          the marketplace.
        </p>
      </header>
      <section className="profile-section seller-readiness-section">
        <div className="section-heading">
          <div>
            <span className="overline">Agent readiness</span>
            <h2>Your marketplace status</h2>
          </div>
          <p>Only persisted checks and owner-published offers count.</p>
        </div>
        {readiness.length === 0 ? (
          <div className="state-panel compact-state-panel">
            <h3>No registered agents found for this wallet.</h3>
            <p>
              Connect the wallet currently registered as the agent owner on BNB
              Chain, or submit the agent through the existing onboarding flow
              and verify ownership.
            </p>
          </div>
        ) : (
          <div className="seller-readiness-grid">
            {readiness.map((agent) => (
              <article
                className="seller-readiness-card"
                key={`${agent.agentId}:${agent.category}`}
              >
                <header>
                  <div>
                    <span className="overline">
                      {labelForCategory(agent.category)}
                    </span>
                    <h3>{agent.name}</h3>
                  </div>
                  <strong
                    className={`readiness-status ${agent.marketplaceStatus === "PUBLIC" ? "complete" : "attention"}`}
                  >
                    {agent.marketplaceStatus === "PUBLIC"
                      ? agent.hireable
                        ? "Public and hireable"
                        : "Public — offer required"
                      : "Not ready for buyers"}
                  </strong>
                </header>
                {agent.testDeployment ? (
                  <div className="readiness-warning">
                    <strong>Not available for buyers</strong>
                    <span>
                      Test deployment — production authorization required.
                    </span>
                  </div>
                ) : null}
                <div className="readiness-checks">
                  {Object.values(agent.requirements).map((requirement) => (
                    <div
                      className={`readiness-check ${requirement.state}`}
                      key={requirement.label}
                    >
                      <span aria-hidden="true">
                        {requirement.state === "complete"
                          ? "✓"
                          : requirement.state === "attention"
                            ? "!"
                            : "×"}
                      </span>
                      <div>
                        <strong>{requirement.label}</strong>
                        <p>{requirement.explanation}</p>
                        {requirement.nextAction === null ? null : (
                          <small>{requirement.nextAction}</small>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <footer>
                  <span>
                    {agent.lastVerifiedAt === null
                      ? "Never independently checked"
                      : `Last checked ${relativeTime(agent.lastVerifiedAt)}`}
                  </span>
                  <details>
                    <summary>View technical details</summary>
                    <dl>
                      <div>
                        <dt>BNB agent ID</dt>
                        <dd>{agent.externalAgentId}</dd>
                      </div>
                      <div>
                        <dt>Network</dt>
                        <dd>
                          {agent.chainId === 56
                            ? "BNB Chain"
                            : "BNB Chain Testnet"}
                        </dd>
                      </div>
                      <div>
                        <dt>Relic agent record</dt>
                        <dd>{agent.agentId}</dd>
                      </div>
                      <div>
                        <dt>Relic service record</dt>
                        <dd>{agent.serviceId ?? "No service"}</dd>
                      </div>
                    </dl>
                  </details>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
      <div className="operator-grid">
        <section className="profile-section" id="create-offer">
          <h2>Create marketplace offer</h2>
          {readiness.filter(
            (agent) =>
              agent.serviceId !== null &&
              !agent.testDeployment &&
              agent.requirements.identity.state === "complete" &&
              agent.requirements.service.state === "complete" &&
              agent.requirements.verification.state === "complete" &&
              agent.requirements.commerce.state === "complete" &&
              agent.requirements.offer.state !== "complete",
          ).length === 0 ? (
            <p>
              No owned agent is currently ready to publish a new offer. Finish
              the readiness checks above first.
            </p>
          ) : (
            readiness
              .filter(
                (agent) =>
                  agent.serviceId !== null &&
                  !agent.testDeployment &&
                  agent.requirements.identity.state === "complete" &&
                  agent.requirements.service.state === "complete" &&
                  agent.requirements.verification.state === "complete" &&
                  agent.requirements.commerce.state === "complete" &&
                  agent.requirements.offer.state !== "complete",
              )
              .map((agent) => (
                <details className="offer-composer" key={agent.agentId}>
                  <summary>Create offer for {agent.name}</summary>
                  <form action={createOfferAction} className="commerce-form">
                    <input type="hidden" name="agentId" value={agent.agentId} />
                    <input
                      type="hidden"
                      name="serviceId"
                      value={agent.serviceId!}
                    />
                    <label>
                      Network
                      <input
                        readOnly
                        value={
                          agent.chainId === 56
                            ? "BNB Chain"
                            : "BNB Chain Testnet"
                        }
                      />
                      <input
                        type="hidden"
                        name="chainId"
                        value={agent.chainId}
                      />
                    </label>
                    <label>
                      Capability
                      <input
                        name="capability"
                        defaultValue={labelForCategory(agent.category)}
                        required
                      />
                    </label>
                    <label>
                      Billing model
                      <select name="billingModel">
                        <option value="PER_EXECUTION">Per execution</option>
                        <option value="ONE_TIME">One time</option>
                        <option value="SUBSCRIPTION">Subscription</option>
                      </select>
                    </label>
                    <label>
                      Human price
                      <input
                        name="price"
                        inputMode="decimal"
                        defaultValue="0"
                        required
                      />
                    </label>
                    <label>
                      Token decimals
                      <input
                        name="decimals"
                        type="number"
                        min="0"
                        max="77"
                        defaultValue="18"
                        required
                      />
                    </label>
                    <label>
                      Token address
                      <input
                        name="tokenAddress"
                        defaultValue="0x0000000000000000000000000000000000000000"
                        required
                      />
                    </label>
                    <label>
                      Symbol
                      <input name="symbol" defaultValue="tBNB" required />
                    </label>
                    <label>
                      Capabilities, comma-separated
                      <input
                        name="capabilities"
                        defaultValue={agent.category}
                        required
                      />
                    </label>
                    <label>
                      Limitations, one per line
                      <textarea name="limitations" />
                    </label>
                    <label>
                      Immutable terms
                      <textarea name="terms" required />
                    </label>
                    <button type="submit">Create draft</button>
                  </form>
                </details>
              ))
          )}
        </section>
        <section className="profile-section">
          <h2>Owned offers</h2>
          {offers
            .filter((offer) => offer !== null)
            .map((offer) =>
              offer === null ? null : (
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
                  <details>
                    <summary>Create a new immutable version</summary>
                    <form
                      action={reviseOfferAction.bind(null, offer.id)}
                      className="commerce-form"
                    >
                      <input
                        type="hidden"
                        name="agentId"
                        value={offer.agentId}
                      />
                      <input
                        type="hidden"
                        name="serviceId"
                        value={offer.serviceId}
                      />
                      <input
                        type="hidden"
                        name="chainId"
                        value={offer.version.chainId}
                      />
                      <label>
                        Capability
                        <input
                          name="capability"
                          defaultValue={offer.version.capability}
                          required
                        />
                      </label>
                      <input
                        type="hidden"
                        name="billingModel"
                        value={offer.version.billingModel}
                      />
                      <label>
                        Human price
                        <input
                          name="price"
                          defaultValue={formatBaseUnits(
                            offer.version.price.amountBaseUnits,
                            offer.version.price.decimals,
                          )}
                          required
                        />
                      </label>
                      <input
                        type="hidden"
                        name="decimals"
                        value={offer.version.price.decimals}
                      />
                      <input
                        type="hidden"
                        name="tokenAddress"
                        value={offer.version.price.tokenAddress}
                      />
                      <input
                        type="hidden"
                        name="symbol"
                        value={offer.version.price.symbol}
                      />
                      <label>
                        Capabilities
                        <input
                          name="capabilities"
                          defaultValue={offer.version.capabilitySnapshot.join(
                            ", ",
                          )}
                          required
                        />
                      </label>
                      <label>
                        Limitations
                        <textarea
                          name="limitations"
                          defaultValue={offer.version.limitationsSnapshot.join(
                            "\n",
                          )}
                        />
                      </label>
                      <label>
                        New terms
                        <textarea
                          name="terms"
                          defaultValue={offer.version.terms}
                          required
                        />
                      </label>
                      <button>Create paused revision</button>
                    </form>
                  </details>
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
                        <button className="danger-link">Deactivate</button>
                      </form>
                    ) : null}
                  </div>
                </article>
              ),
            )}
        </section>
      </div>
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
    </main>
  );
}
