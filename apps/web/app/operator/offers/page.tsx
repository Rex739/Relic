import type { Metadata } from "next";

import { formatBaseUnits } from "@relic/domain";

import { operatorAgreements, operatorOffers } from "../../../lib/commerce";
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
  let error: string | null = null;
  try {
    [offers, history] = await Promise.all([
      operatorOffers(),
      operatorAgreements(),
    ]);
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : "Operator data unavailable";
  }
  return (
    <main className="page-shell operator-page">
      <header className="operations-header">
        <span className="overline">Verified seller controls</span>
        <h1>Offers & commerce history</h1>
        <p>
          Only the current ERC-8004 owner of a fresh, eligible service can
          publish or activate an offer.
        </p>
      </header>
      {error === null ? null : (
        <div className="state-panel">
          <h2>Connect the operator wallet.</h2>
          <p>{error}</p>
        </div>
      )}
      <div className="operator-grid">
        <section className="profile-section">
          <h2>Create offer draft</h2>
          <form action={createOfferAction} className="commerce-form">
            <label>
              Agent UUID
              <input name="agentId" required />
            </label>
            <label>
              Verified service UUID
              <input name="serviceId" required />
            </label>
            <label>
              Network
              <select name="chainId">
                <option value="97">BSC Testnet</option>
                <option value="56">BSC Mainnet</option>
              </select>
            </label>
            <label>
              Capability
              <input name="capability" required />
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
              <input name="capabilities" required />
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
