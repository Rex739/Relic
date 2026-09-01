import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  activeOffers,
  agreements,
  type CommerceAgreementView,
} from "../../../../lib/commerce";
import {
  commercePriceLabel,
  isFreePrice,
  paymentRequirementLabel,
} from "../../../../lib/commerce-display";
import { walletAuthenticationRequired } from "../../../../lib/auth-state";
import { listMyAgents } from "../../../../lib/mandates";
import {
  marketplaceAgent,
  productCapabilityLabel,
} from "../../../../lib/marketplace";
import {
  relationshipStatus,
  resolveHireSelection,
  selectRelationshipAgreement,
} from "../../../../lib/relationship-status";
import { CommerceAuthorization } from "../../../_components/commerce-authorization";
import { WalletSession } from "../../../_components/wallet-session";
import { acceptTermsAction, hireOfferAction } from "../../../commerce-actions";
import { createActivateMandateForHire } from "../../../mandate-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hire agent" };

const capabilities = [
  "monitor_positions",
  "calculate_health_factor",
  "generate_alerts",
  "generate_recommendations",
] as const;
const progressClass = (current: number, step: number) =>
  current === step ? "active" : current > step ? "complete" : "";

export default async function HireAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    offer?: string;
    mandate?: string;
    agreement?: string;
    new?: string;
  }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const [agentResponse, offers] = await Promise.all([
    marketplaceAgent(id),
    activeOffers(id),
  ]);
  if (agentResponse.data === null) notFound();
  const agent = agentResponse.data;
  const offer = offers.find((item) => item.id === search.offer) ?? offers[0];
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

  const hasWalletSession = !walletAuthenticationRequired(
    (await cookies()).get("relic_session")?.value,
  );
  let mandates: Awaited<ReturnType<typeof listMyAgents>> = [];
  let commerceAgreements: CommerceAgreementView[] = [];
  let commerceAgreement: CommerceAgreementView | null = null;
  let authRequired = !hasWalletSession;
  if (hasWalletSession) {
    try {
      const [ownedMandates, ownedAgreements] = await Promise.all([
        listMyAgents(),
        agreements(),
      ]);
      mandates = ownedMandates.filter(
        ({ mandate }) =>
          mandate.agentId === id &&
          ["ACTIVE", "PAUSED"].includes(mandate.status),
      );
      commerceAgreements = ownedAgreements.filter(
        (item): item is CommerceAgreementView => item !== null,
      );
    } catch {
      authRequired = true;
    }
  }
  const startNew = search.new === "1";
  const hireSelection = resolveHireSelection(mandates, {
    ...(search.mandate === undefined
      ? {}
      : { requestedMandateId: search.mandate }),
    startNew,
  });
  const selectedMandate = hireSelection.selected ?? undefined;
  const invalidMandateRequest = hireSelection.invalidRequest;
  if (selectedMandate !== undefined) {
    const selectedAgreement = selectRelationshipAgreement(
      commerceAgreements,
      selectedMandate.mandate.id,
    );
    commerceAgreement =
      search.agreement === undefined
        ? selectedAgreement
        : (commerceAgreements.find(
            (item) =>
              item.id === search.agreement &&
              item.mandateId === selectedMandate.mandate.id,
          ) ?? selectedAgreement);
  }
  const existingRelationships = mandates.map((item) => {
    const agreement = selectRelationshipAgreement(
      commerceAgreements,
      item.mandate.id,
    );
    return {
      ...item,
      agreement,
      status: relationshipStatus({ mandate: item.mandate, agreement }),
    };
  });
  const showResumeChoice = !authRequired && hireSelection.showResumeChoice;
  const continuation = `/agents/${id}/hire?offer=${encodeURIComponent(offer.id)}&mandate=${encodeURIComponent(selectedMandate?.mandate.id ?? search.mandate ?? "")}`;
  const agreementStatus = commerceAgreement?.status ?? null;
  const selectedRelationshipStatus =
    selectedMandate === undefined
      ? null
      : relationshipStatus({
          mandate: selectedMandate.mandate,
          agreement: commerceAgreement,
        });
  const currentStep =
    selectedRelationshipStatus === "Running"
      ? 5
      : authRequired || selectedMandate === undefined
        ? 1
        : commerceAgreement === null ||
            agreementStatus === "DRAFT" ||
            agreementStatus === "AUTHORIZATION_REQUIRED"
          ? 3
          : 4;

  return (
    <main className="page-shell hire-page">
      <header className="operations-header">
        <span className="overline">Hire agent</span>
        <h1>Put {agent.name} to work</h1>
        <p>
          Configure one read-only relationship, authorize it, then complete the
          required wallet confirmations inside one guided journey.
        </p>
        <ol className="hire-progress" aria-label="Hiring progress">
          {["Configure", "Permissions", "Authorize", "Start", "Running"].map(
            (label, index) => (
              <li className={progressClass(currentStep, index + 1)} key={label}>
                {index + 1} {label}
              </li>
            ),
          )}
        </ol>
      </header>

      <section className="hire-service-summary profile-section">
        <div>
          <span className="overline">Selected service</span>
          <h2>{productCapabilityLabel(offer.version.capability)}</h2>
          <p>{offer.version.terms}</p>
        </div>
        <dl className="commerce-facts">
          <div>
            <dt>Price</dt>
            <dd>{commercePriceLabel(offer.version.price)}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>{paymentRequirementLabel(offer.version.price)}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>
              {offer.version.chainId === 97 ? "BSC Testnet" : "BSC Mainnet"}
            </dd>
          </div>
          <div>
            <dt>Wallet setup</dt>
            <dd>4 confirmations · gas only</dd>
          </div>
        </dl>
      </section>

      {authRequired ? (
        <section className="profile-section hire-current-step">
          <span className="overline">Step 1 · Authenticate</span>
          <h2>Connect the buyer wallet</h2>
          <p>
            Your wallet must be authenticated before Relic can save permissions.
          </p>
          <WalletSession connectLabel="Connect wallet to continue" />
        </section>
      ) : invalidMandateRequest ? (
        <section className="profile-section hire-current-step state-panel">
          <span className="overline">Setup unavailable</span>
          <h2>This saved setup is not available to this wallet.</h2>
          <p>
            Return to the agent profile and choose a relationship owned by the
            authenticated buyer wallet.
          </p>
          <Link href={`/agents/${id}`}>Return to agent</Link>
        </section>
      ) : showResumeChoice ? (
        <section className="profile-section hire-current-step">
          <span className="overline">Existing setup found</span>
          <h2>You already started hiring this agent.</h2>
          <p>
            Continue a saved relationship, or intentionally create a separate
            one with its own permissions and monitored account.
          </p>
          <div className="existing-setup-list">
            {existingRelationships.map((relationship) => {
              const href =
                relationship.status === "Setting up"
                  ? `/agents/${id}/hire?offer=${encodeURIComponent(offer.id)}&mandate=${encodeURIComponent(relationship.mandate.id)}${relationship.agreement === null ? "" : `&agreement=${encodeURIComponent(relationship.agreement.id)}`}`
                  : `/my-agents/mandates/${relationship.mandate.id}`;
              return (
                <article key={relationship.mandate.id}>
                  <div>
                    <strong>{relationship.status}</strong>
                    <p>{relationship.mandate.version.objective}</p>
                  </div>
                  <Link className="primary-button" href={href}>
                    {relationship.status === "Setting up"
                      ? "Continue setup"
                      : relationship.status === "Running"
                        ? "View running agent"
                        : "View relationship"}
                  </Link>
                </article>
              );
            })}
          </div>
          <Link
            className="secondary-button"
            href={`/agents/${id}/hire?offer=${encodeURIComponent(offer.id)}&new=1`}
          >
            Start new setup
          </Link>
          <small>
            A new setup creates a separate mandate and agreement. It is
            available because this agent still has an active verified offer.
          </small>
        </section>
      ) : selectedRelationshipStatus !== null &&
        selectedRelationshipStatus !== "Setting up" &&
        selectedMandate !== undefined ? (
        <section className="profile-section hire-current-step">
          <span className="overline">
            {selectedRelationshipStatus === "Running"
              ? "Step 5 · Running"
              : selectedRelationshipStatus}
          </span>
          <h2>
            {selectedRelationshipStatus === "Running"
              ? "This agent is already running."
              : "This saved relationship does not need setup."}
          </h2>
          <p>
            Review its current state in My Agents. Relic will not send an
            existing relationship back through permissions, authorization, or
            wallet setup.
          </p>
          <Link
            className="primary-button"
            href={`/my-agents/mandates/${selectedMandate.mandate.id}`}
          >
            View relationship
          </Link>
        </section>
      ) : selectedMandate === undefined ? (
        <form
          action={createActivateMandateForHire}
          className="profile-section hire-journey-form"
        >
          <input type="hidden" name="agentId" value={agent.id} />
          <input type="hidden" name="offerId" value={offer.id} />
          <input type="hidden" name="chainId" value={agent.chainId} />
          {capabilities.map((capability) => (
            <input
              type="hidden"
              name={capability}
              value="on"
              key={capability}
            />
          ))}
          <section>
            <span className="overline">Step 1 · Configure</span>
            <h2>Choose what to monitor</h2>
            <label>
              Public account
              <input
                name="monitoredAccount"
                required
                pattern="0x[0-9a-fA-F]{40}"
                placeholder="0x…"
              />
            </label>
            <label>
              Objective
              <textarea
                name="objective"
                minLength={12}
                maxLength={1000}
                rows={3}
                defaultValue="Monitor my Venus lending position and alert me when health factor falls below 1.30."
                required
              />
            </label>
            <div className="constraint-grid">
              <label>
                Alert below health factor
                <input name="threshold" defaultValue="1.30" required />
              </label>
              <label>
                Duration
                <select name="durationDays" defaultValue="7">
                  <option value="1">24 hours</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                </select>
              </label>
            </div>
          </section>
          <section>
            <span className="overline">Step 2 · Permissions</span>
            <h2>Read-only authority</h2>
            <div className="hire-permissions">
              <div>
                <b>The agent may</b>
                {capabilities.map((capability) => (
                  <span key={capability}>
                    ✓ {productCapabilityLabel(capability)}
                  </span>
                ))}
              </div>
              <div>
                <b>The agent may not</b>
                <span>× Transfer tokens</span>
                <span>× Borrow, repay, swap, or approve contracts</span>
                <span>× Submit transactions</span>
              </div>
            </div>
            <p>
              Cost: {commercePriceLabel(offer.version.price)} · Network: BSC
              Testnet · Approval mode: observe only.
            </p>
          </section>
          <section>
            <span className="overline">Step 3 · Authorize</span>
            <h2>Approve this permission set</h2>
            <label className="terms-confirm">
              <input
                type="checkbox"
                name="explicitApproval"
                value="approved"
                required
              />{" "}
              I approve this exact read-only mandate and its expiry.
            </label>
            <button type="submit">Save permissions and continue</button>
            <small>
              This creates and activates the mandate. It does not submit a
              blockchain transaction or move funds.
            </small>
          </section>
        </form>
      ) : commerceAgreement === null ? (
        <section className="profile-section hire-current-step">
          <span className="overline">Step 3 · Authorize</span>
          <h2>Bind the service terms to your permissions</h2>
          <p>
            Relic will create the zero-price agreement for your active read-only
            mandate. You will review its immutable terms next.
          </p>
          <form action={hireOfferAction} className="commerce-form">
            <input type="hidden" name="offerId" value={offer.id} />
            <input
              type="hidden"
              name="mandateId"
              value={selectedMandate.mandate.id}
            />
            <input type="hidden" name="continuation" value={continuation} />
            <button type="submit">Create agreement and review terms</button>
          </form>
        </section>
      ) : agreementStatus === "DRAFT" ? (
        <section className="profile-section hire-current-step">
          <span className="overline">Step 3 · Authorize</span>
          <h2>Review the immutable service terms</h2>
          <p>{String(commerceAgreement.termsSnapshot)}</p>
          <form action={acceptTermsAction} className="commerce-form">
            <input
              type="hidden"
              name="agreementId"
              value={commerceAgreement.id}
            />
            <input
              type="hidden"
              name="termsHash"
              value={String(commerceAgreement.termsHash)}
            />
            <input
              type="hidden"
              name="continuation"
              value={`${continuation}&agreement=${encodeURIComponent(commerceAgreement.id)}`}
            />
            <label className="terms-confirm">
              <input type="checkbox" required /> I accept this exact terms
              snapshot and hash.
            </label>
            <button type="submit">Accept terms</button>
          </form>
        </section>
      ) : agreementStatus === "AUTHORIZATION_REQUIRED" ? (
        <section className="profile-section hire-current-step">
          <span className="overline">Step 3 · Authorize</span>
          <h2>Sign the agreement</h2>
          <p>
            This EIP-712 signature binds the buyer, mandate, terms, price,
            network, nonce, and expiry. It costs no gas and moves no funds.
          </p>
          <CommerceAuthorization
            agreementId={commerceAgreement.id}
            continuationHref={`${continuation}&agreement=${encodeURIComponent(commerceAgreement.id)}`}
          />
        </section>
      ) : (
        <section className="profile-section hire-current-step">
          <span className="overline">Step 4 · Start</span>
          <h2>Fund your BNB task</h2>
          <ol className="setup-sequence">
            <li>1/4 Confirm the provider&apos;s signed quote</li>
            <li>2/4 Create your BNB task</li>
            <li>
              3/4 Set and fund the {isFreePrice(offer.version.price) ? "free" : "spending"} budget
            </li>
            <li>4/4 The provider verifies the funded task</li>
          </ol>
          <p>
            You confirm every wallet transaction. After escrow funding is
            final, the provider&apos;s own ERC-8183 service verifies the onchain
            job before it starts work.
          </p>
          <Link
            className="primary-button"
            href={`/my-agents/mandates/${selectedMandate.mandate.id}`}
          >
            Continue to fund task
          </Link>
          <details className="technical-details">
            <summary>Technical details</summary>
            <p>Signed quote → ERC-8183 job → fund escrow → provider observes job</p>
          </details>
        </section>
      )}
    </main>
  );
}
