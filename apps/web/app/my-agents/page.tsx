import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import type { MandateListItem } from "@relic/domain";

import { listMyAgents } from "../../lib/mandates";
import { agreements, type CommerceAgreementView } from "../../lib/commerce";
import { commercePriceLabel } from "../../lib/commerce-display";
import { walletAuthenticationRequired } from "../../lib/auth-state";
import {
  relationshipStatus,
  selectRelationshipAgreement,
} from "../../lib/relationship-status";
import { WalletSession } from "../_components/wallet-session";
import { CommerceStatusRefresh } from "../_components/commerce-status-refresh";
import { AccountSidebar } from "../_components/account-sidebar";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My orders" };

export default async function MyAgentsPage() {
  const authenticationRequired = walletAuthenticationRequired(
    (await cookies()).get("relic_session")?.value,
  );
  if (authenticationRequired)
    return (
      <main className="page-shell my-agents-page">
        <header className="operations-header">
          <span className="overline">Your tasks</span>
          <h1>My orders</h1>
        </header>
        <div className="state-panel authentication-state">
          <span>Wallet authentication required</span>
          <h2>Connect your wallet to see your orders.</h2>
          <p>
            Your tasks and permissions remain private and are only
            loaded after the buyer wallet is authenticated.
          </p>
          <WalletSession connectLabel="Connect wallet" />
        </div>
      </main>
    );
  let items: MandateListItem[] = [];
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
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : "Relationships unavailable";
  }
  const checkoutAwaitingFinality = Object.values(agreementByMandate).some(
    (agreement) =>
      agreement.operations.some((operation) =>
        ["SUBMITTED", "PENDING", "CONFIRMED", "REORGED"].includes(
          String(operation.state),
        ),
      ),
  );
  return (
    <main className="page-shell my-agents-page">
      <CommerceStatusRefresh active={checkoutAwaitingFinality} />
      <header className="operations-header">
        <span className="overline">Your tasks</span>
        <h1>My orders</h1>
        <p>
          See what you requested, what each agent will deliver, its current
          status, and the latest result in one place.
        </p>
      </header>
      <div className="account-workspace">
        <AccountSidebar />
        <div className="account-workspace-content">
          {error ? (
            <div className="state-panel">
              <h2>Orders are temporarily unavailable.</h2>
              <p>{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="empty-relationships">
              <span>0 orders</span>
              <h2>You have no orders yet.</h2>
              <p>
                Try a service from the marketplace to create your first order.
              </p>
              <Link href="/marketplace">Browse verified agents →</Link>
            </div>
          ) : (
            <div className="relationship-list">
              {items.map(({ mandate, agent, lastActivityAt, nextExpectedAction }) => {
                const agreement = agreementByMandate[mandate.id]!;
                const displayStatus = relationshipStatus({
                  mandate,
                  agreement,
                  hasUpdate: lastActivityAt.length > 0,
                });
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
                          <Link href={`/account/my-hires/mandates/${mandate.id}`}>
                            {mandate.version.objective}
                          </Link>
                        </h2>
                        <p>Provided by {agent.name}</p>
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
                        <dt>Service price</dt>
                        <dd>{commercePriceLabel(agreement.pricingSnapshot)}</dd>
                      </div>
                      <div>
                        <dt>Latest update</dt>
                        <dd>{nextExpectedAction}</dd>
                      </div>
                    </dl>
                    <div className="relationship-actions">
                      <Link href={`/account/my-hires/mandates/${mandate.id}`}>
                        {displayStatus === "Awaiting confirmation" ||
                        displayStatus === "Completing payment"
                          ? "Continue order"
                          : "View order"}
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
