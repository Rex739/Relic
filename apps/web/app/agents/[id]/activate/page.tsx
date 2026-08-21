import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createAndReviewMandate } from "../../../mandate-actions";
import { activationProfile } from "../../../../lib/mandates";
import { marketplaceAgent } from "../../../../lib/marketplace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activate agent" };

const capabilityLabel = (value: string) => value.replaceAll("_", " ");

export default async function ActivateAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agentResponse = await marketplaceAgent(id);
  if (agentResponse.data === null) notFound();
  let activation;
  try {
    activation = await activationProfile(id);
  } catch (error) {
    return (
      <main className="page-shell activation-page">
        <div className="state-panel">
          <span>Activation blocked</span>
          <h1>This agent cannot be activated safely right now.</h1>
          <p>
            {error instanceof Error
              ? error.message
              : "Safety preflight failed."}
          </p>
          <Link href={`/agents/${id}`}>Return to agent intelligence</Link>
        </div>
      </main>
    );
  }
  const agent = agentResponse.data;
  const { profile, template } = activation;
  if (template === null) notFound();
  return (
    <main className="page-shell activation-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/marketplace">Marketplace</Link>
        <span>/</span>
        <Link href={`/agents/${agent.id}`}>{agent.name}</Link>
        <span>/</span>
        <span>Activate</span>
      </nav>
      <header className="activation-header">
        <div>
          <span className="overline">Evidence-bound activation</span>
          <h1>Define exactly what this agent may do.</h1>
          <p>
            Relic converts your choices into a deterministic mandate. The agent
            cannot expand this authority, and this flow creates no blockchain
            transaction or wallet delegation.
          </p>
        </div>
        <aside className="activation-assurance">
          <span>Eligibility preflight</span>
          <strong>✓ Actionable now</strong>
          <p>
            {profile.network} · verified{" "}
            {new Date(profile.verificationTimestamp).toLocaleString()}
          </p>
          <small>
            Service evidence is current and bound to this activation.
          </small>
        </aside>
      </header>

      <form action={createAndReviewMandate} className="mandate-builder">
        <input type="hidden" name="agentId" value={agent.id} />
        <input type="hidden" name="chainId" value={agent.chainId} />
        <section className="mandate-step">
          <div className="step-number">01</div>
          <div>
            <span className="overline">Objective</span>
            <h2>What outcome should it produce?</h2>
            <p>
              State the monitoring purpose. This does not grant extra
              capabilities.
            </p>
          </div>
          <textarea
            name="objective"
            rows={3}
            minLength={12}
            maxLength={1000}
            defaultValue={template.objective}
            required
          />
        </section>

        <section className="mandate-step">
          <div className="step-number">02</div>
          <div>
            <span className="overline">Permissions</span>
            <h2>Minimal verified access</h2>
            <p>
              Only read-only capabilities verified for this service can be
              selected.
            </p>
          </div>
          <div className="permission-grid">
            {profile.capabilitySet.map((capability) => (
              <label key={capability} className="permission-choice">
                <input
                  type="checkbox"
                  name={capability}
                  defaultChecked={template.allowedCapabilities.includes(
                    capability,
                  )}
                />
                <span>
                  <b>{capabilityLabel(capability)}</b>
                  <small>Verified capability</small>
                </span>
              </label>
            ))}
          </div>
          <div className="denied-panel">
            <b>This agent will not receive transaction authority</b>
            <p>
              Transfer tokens · Borrow · Repay · Swap · Approve contracts ·
              Submit transactions
            </p>
          </div>
        </section>

        <section className="mandate-step">
          <div className="step-number">03</div>
          <div>
            <span className="overline">Conditions</span>
            <h2>Monitoring threshold and duration</h2>
          </div>
          <div className="constraint-grid">
            <label>
              Alert below health factor
              <input
                name="threshold"
                inputMode="decimal"
                pattern="\d+(\.\d+)?"
                defaultValue="1.30"
                required
              />
            </label>
            <label>
              Duration
              <select name="durationDays" defaultValue="7">
                <option value="1">24 hours</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
              </select>
            </label>
            <div>
              <span>Protocol</span>
              <b>Venus</b>
              <small>Verified protocol</small>
            </div>
            <div>
              <span>Network</span>
              <b>{profile.network}</b>
              <small>Chain ID {profile.chainId}</small>
            </div>
          </div>
          <details className="technical-details mandate-technical">
            <summary>Inspect technical service binding</summary>
            <dl>
              <div>
                <dt>Service</dt>
                <dd>{profile.serviceId}</dd>
              </div>
              <div>
                <dt>Endpoint</dt>
                <dd>{profile.serviceEndpoint}</dd>
              </div>
              <div>
                <dt>Approval mode</dt>
                <dd>OBSERVE_ONLY</dd>
              </div>
              <div>
                <dt>Wallet authorization</dt>
                <dd>Not configured</dd>
              </div>
            </dl>
          </details>
        </section>

        <section className="mandate-step mandate-review-step">
          <div className="step-number">04</div>
          <div>
            <span className="overline">Review & simulate</span>
            <h2>Run the deterministic preflight.</h2>
            <p>
              Relic will re-check Actionable eligibility, service freshness,
              network, capability support, expiry, and every requested
              constraint, then save an immutable draft version for explicit
              approval.
            </p>
          </div>
          <button type="submit" className="primary-action">
            Save draft & run preflight <span>→</span>
          </button>
          <small className="transaction-boundary">
            No wallet signature · No commerce job · No blockchain transaction
          </small>
        </section>
      </form>
    </main>
  );
}
