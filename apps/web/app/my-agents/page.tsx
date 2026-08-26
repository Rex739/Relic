import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import type { MandateListItem } from "@relic/domain";

import { transitionMandateAction } from "../mandate-actions";
import { listExecutions, listMyAgents } from "../../lib/mandates";
import { relativeTime } from "../../lib/marketplace";
import { agreements, type CommerceAgreementView } from "../../lib/commerce";
import { commercePriceLabel, isFreePrice } from "../../lib/commerce-display";
import { walletAuthenticationRequired } from "../../lib/auth-state";
import {
  relationshipStatus,
  selectRelationshipAgreement,
} from "../../lib/relationship-status";
import { WalletSession } from "../_components/wallet-session";

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
  const authenticationRequired = walletAuthenticationRequired(
    (await cookies()).get("relic_session")?.value,
  );
  if (authenticationRequired)
    return (
      <main className="page-shell my-agents-page">
        <header className="operations-header">
          <span className="overline">Your hired agents</span>
          <h1>My Agents</h1>
        </header>
        <div className="state-panel authentication-state">
          <span>Wallet authentication required</span>
          <h2>Connect your wallet to see the agents you&apos;ve hired.</h2>
          <p>
            Your relationships and permissions remain private and are only
            loaded after the buyer wallet is authenticated.
          </p>
          <WalletSession connectLabel="Connect wallet" />
        </div>
      </main>
    );
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
    const eligibleAgreements = commerceAgreements.filter(
      (item): item is CommerceAgreementView =>
        item !== null &&
        item.mandateId !== null &&
        item.authorizationArtifactId !== null,
    );
    agreementByMandate = Object.fromEntries(
      mandateItems.flatMap(({ mandate }) => {
        const selected = selectRelationshipAgreement(
          eligibleAgreements,
          mandate.id,
        );
        return selected === null ? [] : [[mandate.id, selected]];
      }),
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
        <span className="overline">Your hired agents</span>
        <h1>My Agents</h1>
        <p>
          See what is running, review the latest result, and change or revoke
          permissions.
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
          <p>Hire an available agent from the marketplace to see it here.</p>
          <Link href="/marketplace">Browse verified agents →</Link>
        </div>
      ) : (
        <div className="relationship-list">
          {items.map(({ mandate, agent, nextExpectedAction }) => {
            const agreement = agreementByMandate[mandate.id]!;
            const pendingWalletAction = agreement.operations.some(
              (operation) => operation.state === "AWAITING_SIGNATURE",
            );
            const mandateExpired =
              Date.parse(mandate.version.expiresAt) <= Date.now();
            const settled = agreement.movements
              .filter((movement) => movement.movementType === "PAYMENT")
              .reduce(
                (total, movement) => total + movementAmount(movement),
                0n,
              );
            const displayStatus = relationshipStatus({ mandate, agreement });
            return (
              <article key={mandate.id}>
                <div className="relationship-main">
                  <div className="agent-avatar">
                    {agent.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <span className="overline">
                      {agent.network} · {displayStatus}
                    </span>
                    <h2>
                      <Link href={`/my-agents/mandates/${mandate.id}`}>
                        {agent.name}
                      </Link>
                    </h2>
                    <p>{mandate.version.objective}</p>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd
                      className={`relationship-status ${displayStatus.toLowerCase().replaceAll(" ", "-")}`}
                    >
                      {displayStatus}
                    </dd>
                  </div>
                  <div>
                    <dt>Permissions</dt>
                    <dd>{mandate.version.approvalMode.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Service price</dt>
                    <dd>{commercePriceLabel(agreement.pricingSnapshot)}</dd>
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
                    <dt>Next expected action</dt>
                    <dd>
                      {pendingWalletAction
                        ? mandateExpired
                          ? "No further action"
                          : "Confirm setup in wallet"
                        : nextExpectedAction}
                    </dd>
                  </div>
                  <div>
                    <dt>Latest result</dt>
                    <dd>{executionState[mandate.id]?.result ?? "None"}</dd>
                  </div>
                  <div>
                    <dt>Spend to date</dt>
                    <dd>
                      {isFreePrice(agreement.pricingSnapshot)
                        ? "None"
                        : commercePriceLabel({
                            ...agreement.pricingSnapshot,
                            amountBaseUnits: settled.toString(),
                          })}
                    </dd>
                  </div>
                </dl>
                <div className="relationship-actions">
                  <Link href={`/my-agents/mandates/${mandate.id}`}>
                    View agent
                  </Link>
                  <Link href={`/mandates/${mandate.id}`}>
                    Manage permissions
                  </Link>
                  {mandate.status === "ACTIVE" && !mandateExpired ? (
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
                  {mandate.status === "PAUSED" && !mandateExpired ? (
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
                  {!mandateExpired &&
                  !["REVOKED", "EXPIRED"].includes(mandate.status) ? (
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
