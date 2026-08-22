import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatBaseUnits } from "@relic/domain";

import { activeOffers } from "../../../../lib/commerce";
import { listMyAgents } from "../../../../lib/mandates";
import { marketplaceAgent } from "../../../../lib/marketplace";
import { hireOfferAction } from "../../../commerce-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hire agent" };

export default async function HireAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offer?: string }>;
}) {
  const { id } = await params;
  const selected = (await searchParams).offer;
  const [agentResponse, offers] = await Promise.all([
    marketplaceAgent(id),
    activeOffers(id),
  ]);
  if (agentResponse.data === null) notFound();
  const agent = agentResponse.data;
  const offer = offers.find((item) => item.id === selected) ?? offers[0];
  if (agent.tier !== "Actionable" || offer === undefined)
    return (
      <main className="page-shell">
        <div className="state-panel">
          <h1>This agent is not currently hireable.</h1>
          <p>
            A fresh Actionable service and an active verified offer are both
            required.
          </p>
          <Link href={`/agents/${id}`}>Return to profile</Link>
        </div>
      </main>
    );
  let mandates: Awaited<ReturnType<typeof listMyAgents>> = [];
  const hasWalletSession =
    (await cookies()).get("relic_session")?.value !== undefined;
  let authRequired = !hasWalletSession;
  if (hasWalletSession) {
    try {
      mandates = (await listMyAgents()).filter(
        ({ mandate }) => mandate.agentId === id && mandate.status === "ACTIVE",
      );
    } catch {
      authRequired = true;
    }
  }
  return (
    <main className="page-shell hire-page">
      <header className="operations-header">
        <span className="overline">Production hiring</span>
        <h1>Hire {agent.name}</h1>
        <p>
          Terms acceptance and wallet authority remain separate, explicit steps.
        </p>
      </header>
      <div className="hiring-grid">
        <section className="profile-section">
          <span className="overline">1 · Verified offer</span>
          <h2>{offer.version.capability}</h2>
          <dl className="commerce-facts">
            <div>
              <dt>Price</dt>
              <dd>
                {formatBaseUnits(
                  offer.version.price.amountBaseUnits,
                  offer.version.price.decimals,
                )}{" "}
                {offer.version.price.symbol}
              </dd>
            </div>
            <div>
              <dt>Billing</dt>
              <dd>{offer.version.billingModel.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>
                {offer.version.chainId === 97 ? "BSC Testnet" : "BSC Mainnet"}
              </dd>
            </div>
            <div>
              <dt>Payment token</dt>
              <dd>{offer.version.price.tokenAddress}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>Actionable · current service evidence</dd>
            </div>
            <div>
              <dt>Expiry</dt>
              <dd>
                {offer.version.expiresAt === null
                  ? "No published expiry"
                  : new Date(offer.version.expiresAt).toLocaleString()}
              </dd>
            </div>
          </dl>
          <details>
            <summary>Immutable operator terms</summary>
            <p>{offer.version.terms}</p>
            <code>{offer.version.termsHash}</code>
          </details>
        </section>
        <section className="profile-section">
          <span className="overline">2 · Mandate</span>
          <h2>Bind an active safety mandate</h2>
          <p>
            The mandate controls capabilities, protocols, limits, duration, and
            approval mode. It does not itself sign a transaction.
          </p>
          {authRequired ? (
            <div className="notice-card">
              <b>Connect your wallet</b>
              <p>
                Wallet authentication is required to view or hire under your
                mandates.
              </p>
            </div>
          ) : mandates.length === 0 ? (
            <div className="notice-card">
              <b>No matching active mandate</b>
              <p>Create and activate one before hiring.</p>
              <Link href={`/agents/${id}/activate`}>Define mandate →</Link>
            </div>
          ) : (
            <form action={hireOfferAction} className="commerce-form">
              <input type="hidden" name="offerId" value={offer.id} />
              <label>
                Active mandate
                <select name="mandateId" required>
                  {mandates.map(({ mandate }) => (
                    <option key={mandate.id} value={mandate.id}>
                      {mandate.version.objective} · v{mandate.activeVersion}
                    </option>
                  ))}
                </select>
              </label>
              <div className="boundary-note">
                <b>Next: review and accept exact terms</b>
                <p>
                  Creating the agreement will not authorize a transaction or
                  move funds.
                </p>
              </div>
              <button type="submit">Create draft agreement</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
