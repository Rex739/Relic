import type { Metadata } from "next";
import Link from "next/link";
import type { MandateListItem } from "@relic/domain";

import { transitionMandateAction } from "../mandate-actions";
import { listExecutions, listMyAgents } from "../../lib/mandates";
import { relativeTime } from "../../lib/marketplace";
import { agreements, type CommerceAgreementView } from "../../lib/commerce";
import { formatBaseUnits } from "@relic/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Agents" };

const movementAmount = (movement: Record<string, unknown>) => {
  if (
    typeof movement.amountBaseUnits !== "string" ||
    !/^\d+$/.test(movement.amountBaseUnits)
  )
    throw new Error(
      "A persisted commerce movement has an invalid exact amount",
    );
  return BigInt(movement.amountBaseUnits);
};

export default async function MyAgentsPage() {
  let items: MandateListItem[] = [];
  let executionState: Record<
    string,
    { lastAt: string | null; result: string; pendingApproval: boolean }
  > = {};
  let error: string | null = null;
  let agreementByMandate: Record<string, CommerceAgreementView> = {};
  try {
    const [mandateItems, commerceAgreements] = await Promise.all([
      listMyAgents(),
      agreements(),
    ]);
    agreementByMandate = Object.fromEntries(
      commerceAgreements
        .filter(
          (item): item is CommerceAgreementView =>
            item !== null && item.mandateId !== null,
        )
        .map((item) => [item.mandateId!, item]),
    );
    items = mandateItems.filter(
      ({ mandate }) => agreementByMandate[mandate.id] !== undefined,
    );
    executionState = Object.fromEntries(
      await Promise.all(
        items.map(async ({ mandate }) => {
          const executions = await listExecutions(mandate.id);
          return [
            mandate.id,
            {
              lastAt: executions[0]?.updatedAt ?? null,
              result: executions[0]?.status.replaceAll("_", " ") ?? "None",
              pendingApproval: executions.some(
                ({ status }) => status === "APPROVAL_REQUIRED",
              ),
            },
          ] as const;
        }),
      ),
    );
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
          {items.map(({ mandate, agent, nextExpectedAction }) => {
            const agreement = agreementByMandate[mandate.id]!;
            const pendingWalletAction = agreement.operations.some(
              (operation) => operation.state === "AWAITING_SIGNATURE",
            );
            const settled = agreement.movements
              .filter((movement) => movement.movementType === "PAYMENT")
              .reduce(
                (total, movement) => total + movementAmount(movement),
                0n,
              );
            return (
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
                    <dd>{agreement.status.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Wallet authorization</dt>
                    <dd>
                      {agreement.authorizationArtifactId === null
                        ? "Required"
                        : "Verified"}
                    </dd>
                  </div>
                  <div>
                    <dt>Offer price</dt>
                    <dd>
                      {formatBaseUnits(
                        agreement.pricingSnapshot.amountBaseUnits,
                        agreement.pricingSnapshot.decimals,
                      )}{" "}
                      {agreement.pricingSnapshot.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Last execution</dt>
                    <dd>
                      {executionState[mandate.id]?.lastAt
                        ? relativeTime(executionState[mandate.id]!.lastAt!)
                        : "None"}
                    </dd>
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
                  <div>
                    <dt>Latest result</dt>
                    <dd>{executionState[mandate.id]?.result ?? "None"}</dd>
                  </div>
                  <div>
                    <dt>Pending approval</dt>
                    <dd>
                      {executionState[mandate.id]?.pendingApproval ||
                      pendingWalletAction
                        ? "Yes"
                        : "No"}
                    </dd>
                  </div>
                  <div>
                    <dt>Settled spend</dt>
                    <dd>
                      {formatBaseUnits(
                        settled,
                        agreement.pricingSnapshot.decimals,
                      )}{" "}
                      {agreement.pricingSnapshot.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Settlement</dt>
                    <dd>
                      {typeof agreement.settlements[0]?.status !== "string"
                        ? "No settlement"
                        : agreement.settlements[0].status}
                    </dd>
                  </div>
                  <div>
                    <dt>Attention</dt>
                    <dd>{mandate.attentionReason ?? "None"}</dd>
                  </div>
                </dl>
                <div className="relationship-actions">
                  <Link href={`/my-agents/mandates/${mandate.id}`}>
                    Open Execution Room
                  </Link>
                  <Link href={`/commerce/agreements/${agreement.id}`}>
                    Open agreement
                  </Link>
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
            );
          })}
        </div>
      )}
    </main>
  );
}
