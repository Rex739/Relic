import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  activateMandateAction,
  editMandateAction,
  transitionMandateAction,
} from "../../mandate-actions";
import { getMandate } from "../../../lib/mandates";
import { marketplaceAgent, relativeTime } from "../../../lib/marketplace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mandate" };

export default async function MandatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let mandate;
  try {
    mandate = await getMandate(id);
  } catch {
    notFound();
  }
  const agentResponse = await marketplaceAgent(mandate.agentId);
  const agentName = agentResponse.data?.name ?? "Verified agent";
  const network = mandate.chainId === 97 ? "BNB Chain Testnet" : "BNB Chain";
  const preview = {
    heading: `You are authorizing ${agentName} to:`,
    objective: mandate.version.objective,
    may: mandate.version.allowedCapabilities.map((item) =>
      item.replaceAll("_", " "),
    ),
    mayNot: mandate.version.deniedCapabilities.map((item) =>
      item.replaceAll("_", " "),
    ),
    assets:
      mandate.version.allowedAssets.length === 0
        ? ["No asset spending authority"]
        : mandate.version.allowedAssets,
    protocols: mandate.version.allowedProtocols,
    expiresAt: mandate.version.expiresAt,
  };
  const rawThreshold = mandate.version.riskConstraints.alertHealthFactorBelow;
  const threshold = typeof rawThreshold === "string" ? rawThreshold : "1.30";
  const transition = transitionMandateAction.bind(null, mandate.id);
  return (
    <main className="page-shell mandate-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/my-agents">My Agents</Link>
        <span>/</span>
        <span>Mandate {mandate.id.slice(0, 8)}</span>
      </nav>
      <header className="mandate-header">
        <div>
          <span className="overline">
            Authorization mandate · Version {mandate.currentVersion}
          </span>
          <h1>{agentName}</h1>
          <p>{mandate.version.objective}</p>
        </div>
        <div
          className={`mandate-status status-${mandate.status.toLowerCase()}`}
        >
          <span>Status</span>
          <strong>{mandate.status.replaceAll("_", " ")}</strong>
          <small>{network}</small>
        </div>
      </header>
      {mandate.attentionReason ? (
        <div className="attention-banner">
          <b>Execution blocked — attention required</b>
          <p>{mandate.attentionReason}</p>
        </div>
      ) : null}
      <div className="mandate-layout">
        <div>
          <section className="authorization-preview">
            <span className="overline">Human-readable authorization</span>
            <h2>{preview.heading}</h2>
            <p className="preview-objective">{preview.objective}</p>
            <div className="permission-summary">
              <div>
                <b>It may</b>
                {preview.may.map((item) => (
                  <span className="may" key={item}>
                    ✓ {item}
                  </span>
                ))}
              </div>
              <div>
                <b>It may not</b>
                {preview.mayNot.map((item) => (
                  <span className="may-not" key={item}>
                    × {item}
                  </span>
                ))}
              </div>
            </div>
            <dl className="mandate-facts">
              <div>
                <dt>Assets</dt>
                <dd>{preview.assets.join(", ")}</dd>
              </div>
              <div>
                <dt>Protocol</dt>
                <dd>{preview.protocols.join(", ")}</dd>
              </div>
              <div>
                <dt>Approval mode</dt>
                <dd>Observe only</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{new Date(preview.expiresAt).toLocaleString()}</dd>
              </div>
            </dl>
            <p className="revoke-promise">
              You can pause or revoke this mandate at any time.
            </p>
          </section>
          <section className="profile-section evidence-binding">
            <span className="overline">Evidence binding</span>
            <h2>Authorization context preserved</h2>
            <p>
              This version is permanently linked to the evidence Relic relied on
              at approval time.
            </p>
            <dl>
              <div>
                <dt>Agent identity</dt>
                <dd>ERC-8004 #{mandate.version.evidence.externalAgentId}</dd>
              </div>
              <div>
                <dt>Verification tier</dt>
                <dd>{mandate.version.evidence.verificationTier}</dd>
              </div>
              <div>
                <dt>Verified at</dt>
                <dd>
                  {new Date(
                    mandate.version.evidence.verificationTimestamp,
                  ).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>Service endpoint</dt>
                <dd>{mandate.version.evidence.serviceEndpoint}</dd>
              </div>
            </dl>
          </section>
          <section className="profile-section">
            <span className="overline">Activity</span>
            <h2>Immutable authorization history</h2>
            <div className="mandate-timeline">
              {mandate.events.map((event) => (
                <article key={event.id}>
                  <i />
                  <div>
                    <b>{event.type.replaceAll("_", " ")}</b>
                    <span>{relativeTime(event.occurredAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <aside className="mandate-controls">
          {mandate.status === "REVIEWED" ? (
            <section className="approval-card">
              <span className="overline">Explicit approval</span>
              <h2>Activate this policy?</h2>
              <p>
                Preflight passed. This activates an offchain Relic mandate only.
              </p>
              <form action={activateMandateAction.bind(null, mandate.id)}>
                <label className="approval-checkbox">
                  <input
                    type="checkbox"
                    name="explicitApproval"
                    value="approved"
                    required
                  />
                  <span>
                    I approve this exact mandate and understand no wallet
                    authority is being granted.
                  </span>
                </label>
                <button className="primary-action" type="submit">
                  Activate mandate
                </button>
              </form>
              <small>No blockchain transaction will occur.</small>
            </section>
          ) : null}
          {mandate.status === "ACTIVE" ? (
            <section>
              <span className="overline">Operating controls</span>
              <h2>Agent is active</h2>
              <p>Only observation and alert generation are authorized.</p>
              <form action={transition.bind(null, "pause")}>
                <button className="secondary-action">Pause mandate</button>
              </form>
              <form action={transition.bind(null, "revoke")}>
                <button className="danger-action">Revoke permanently</button>
              </form>
            </section>
          ) : null}
          {mandate.status === "PAUSED" ? (
            <section>
              <span className="overline">Operating controls</span>
              <h2>Mandate paused</h2>
              <p>No new authorized work may begin while paused.</p>
              <form action={transition.bind(null, "resume")}>
                <button className="primary-action">
                  Resume after safety check
                </button>
              </form>
              <form action={transition.bind(null, "revoke")}>
                <button className="danger-action">Revoke permanently</button>
              </form>
            </section>
          ) : null}
          {!["REVOKED", "EXPIRED"].includes(mandate.status) ? (
            <details className="edit-mandate">
              <summary>Create a revised version</summary>
              <form action={editMandateAction.bind(null, mandate.id)}>
                <input type="hidden" name="agentId" value={mandate.agentId} />
                <input type="hidden" name="chainId" value={mandate.chainId} />
                {mandate.version.allowedCapabilities.map((item) => (
                  <input key={item} type="hidden" name={item} value="on" />
                ))}
                <label>
                  Objective
                  <textarea
                    name="objective"
                    defaultValue={mandate.version.objective}
                    required
                    minLength={12}
                  />
                </label>
                <label>
                  Alert threshold
                  <input name="threshold" defaultValue={threshold} />
                </label>
                <label>
                  New duration
                  <select name="durationDays" defaultValue="7">
                    <option value="1">24 hours</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                  </select>
                </label>
                <button className="secondary-action">
                  Create version {mandate.currentVersion + 1}
                </button>
                <small>
                  The current version becomes immutable history. Reapproval is
                  required.
                </small>
              </form>
            </details>
          ) : null}
          <section className="boundary-card">
            <b>Authorization boundary</b>
            <span>Policy configured</span>
            <span>Wallet authorization — none</span>
            <span>Commerce job — none</span>
            <span>Blockchain execution — none</span>
          </section>
        </aside>
      </div>
    </main>
  );
}
