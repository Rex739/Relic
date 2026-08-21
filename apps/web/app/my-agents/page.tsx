import type { Metadata } from "next";
import Link from "next/link";
import type { MandateListItem } from "@relic/domain";

import { transitionMandateAction } from "../mandate-actions";
import { listMyAgents } from "../../lib/mandates";
import { relativeTime } from "../../lib/marketplace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Agents" };

export default async function MyAgentsPage() {
  let items: MandateListItem[] = [];
  let error: string | null = null;
  try {
    items = await listMyAgents();
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : "Relationships unavailable";
  }
  return (
    <main className="page-shell my-agents-page">
      <header className="operations-header">
        <span className="overline">Operating layer</span>
        <h1>My Agents</h1>
        <p>
          Activated relationships, mandate limits, and authorization status—not
          marketplace listings.
        </p>
      </header>
      {error ? (
        <div className="state-panel">
          <h2>Mandates are temporarily unavailable.</h2>
          <p>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-relationships">
          <span>0 active relationships</span>
          <h2>No agents have been activated.</h2>
          <p>
            Choose an Actionable agent in the marketplace and define its
            mandate.
          </p>
          <Link href="/marketplace">Browse verified agents →</Link>
        </div>
      ) : (
        <div className="relationship-list">
          {items.map(
            ({ mandate, agent, lastActivityAt, nextExpectedAction }) => (
              <article key={mandate.id}>
                <div className="relationship-main">
                  <div className="agent-avatar">
                    {agent.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <span className="overline">{agent.network}</span>
                    <h2>
                      <Link href={`/mandates/${mandate.id}`}>{agent.name}</Link>
                    </h2>
                    <p>{mandate.version.objective}</p>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>{mandate.status.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Authority</dt>
                    <dd>Observe only</dd>
                  </div>
                  <div>
                    <dt>Limits</dt>
                    <dd>No spending authority</dd>
                  </div>
                  <div>
                    <dt>Last activity</dt>
                    <dd>{relativeTime(lastActivityAt)}</dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>
                      {new Date(mandate.version.expiresAt).toLocaleDateString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Next</dt>
                    <dd>{nextExpectedAction}</dd>
                  </div>
                </dl>
                <div className="relationship-actions">
                  <Link href={`/mandates/${mandate.id}`}>Open mandate</Link>
                  {mandate.status === "ACTIVE" ? (
                    <form
                      action={transitionMandateAction.bind(
                        null,
                        mandate.id,
                        "pause",
                      )}
                    >
                      <button>Pause</button>
                    </form>
                  ) : null}
                  {mandate.status === "PAUSED" ? (
                    <form
                      action={transitionMandateAction.bind(
                        null,
                        mandate.id,
                        "resume",
                      )}
                    >
                      <button>Resume</button>
                    </form>
                  ) : null}
                  {!["REVOKED", "EXPIRED"].includes(mandate.status) ? (
                    <form
                      action={transitionMandateAction.bind(
                        null,
                        mandate.id,
                        "revoke",
                      )}
                    >
                      <button className="danger-link">Revoke</button>
                    </form>
                  ) : null}
                </div>
              </article>
            ),
          )}
        </div>
      )}
    </main>
  );
}
