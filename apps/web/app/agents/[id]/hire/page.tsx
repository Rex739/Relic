import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  activeOffers,
  agreements,
  type CommerceAgreementView,
} from "../../../../lib/commerce";
import {
  commercePriceLabel,
  isFreePrice,
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
import { RemoveSavedHireSetup } from "../../../_components/remove-saved-hire-setup";
import { WalletSession } from "../../../_components/wallet-session";
import { acceptTermsAction, hireOfferAction } from "../../../commerce-actions";
import { createActivateMandateForHire } from "../../../mandate-actions";
import { serviceWorkflowFor } from "../../../../lib/service-workflow";

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
    autoAuthorize?: string;
  }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const sessionToken = (await cookies()).get("relic_session")?.value;
  if (walletAuthenticationRequired(sessionToken)) {
    const hireParams = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string") hireParams.set(key, value);
    }
    const hirePath = `/agents/${encodeURIComponent(id)}/hire${
      hireParams.size > 0 ? `?${hireParams.toString()}` : ""
    }`;
    redirect(
      `/agents/${encodeURIComponent(id)}?connect=1&next=${encodeURIComponent(hirePath)}`,
    );
  }
  const [agentResponse, offers] = await Promise.all([
    marketplaceAgent(id),
    activeOffers(id),
  ]);
  if (agentResponse.data === null) notFound();
  const agent = agentResponse.data;
  const workflow = serviceWorkflowFor(agent.category);
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

  let mandates: Awaited<ReturnType<typeof listMyAgents>> = [];
  let commerceAgreements: CommerceAgreementView[] = [];
  let commerceAgreement: CommerceAgreementView | null = null;
  let authRequired = false;
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
  const compactProgressStep = currentStep >= 4 ? 3 : currentStep === 3 ? 2 : 1;

  // Checkout now belongs to the service-card dialog. Keep old bookmarks and
  // stale links from resurrecting the previous multi-page hiring wizard.
  if (!authRequired) {
    if (selectedMandate !== undefined)
      redirect(`/account/my-hires/mandates/${selectedMandate.mandate.id}`);
    redirect(`/agents/${id}`);
  }

  return (
    <main className="page-shell hire-page">
      <div className="hire-workspace">
        <div className="hire-workspace-main">
          <header className="operations-header">
            <span className="overline">Hire agent</span>
            <h1>Set up {agent.name}</h1>
            <p>{workflow.taskDescription}</p>
            <ol className="hire-progress" aria-label="Hiring progress">
              {["Details", "Sign", "Start"].map((label, index) => (
                <li
                  className={progressClass(compactProgressStep, index + 1)}
                  key={label}
                >
                  {index + 1} {label}
                </li>
              ))}
            </ol>
          </header>

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
          <span className="overline">Existing order found</span>
          <h2>You already have an order with this agent.</h2>
          <p>
            Open an existing order, or intentionally create a separate one
            with its own permissions and service request.
          </p>
          <div className="existing-setup-list">
            {existingRelationships.map((relationship) => {
              const href = `/account/my-hires/mandates/${relationship.mandate.id}`;
              return (
                <article key={relationship.mandate.id}>
                  <div>
                    <strong>{relationship.status}</strong>
                    <p>{relationship.mandate.version.objective}</p>
                  </div>
                  <div className="existing-setup-actions">
                    <Link className="primary-button" href={href}>
                      {relationship.status === "Running"
                          ? "View running agent"
                          : "View order"}
                    </Link>
                    <RemoveSavedHireSetup
                      agentId={agent.id}
                      mandateId={relationship.mandate.id}
                      offerId={offer.id}
                    />
                  </div>
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
      ) : selectedRelationshipStatus !== null && selectedMandate !== undefined ? (
        <section className="profile-section hire-current-step">
          <span className="overline">
            {selectedRelationshipStatus === "Running"
              ? "Step 5 · Running"
              : selectedRelationshipStatus}
          </span>
          <h2>
            {selectedRelationshipStatus === "Running"
              ? "This agent is already running."
              : "This saved order is already in progress."}
          </h2>
          <p>
            Review its current state in My orders. Relic will not send an
            existing order back through permissions, authorization, or
            wallet setup.
          </p>
          <Link
            className="primary-button"
            href={`/account/my-hires/mandates/${selectedMandate.mandate.id}`}
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
          <input type="hidden" name="category" value={agent.category} />
          <input
            type="hidden"
            name="objective"
            value={`Run ${workflow.taskLabel} for my requested inputs.`}
          />
          {capabilities.map((capability) => (
            <input
              type="hidden"
              name={capability}
              value="on"
              key={capability}
            />
          ))}
          <section>
            <span className="overline">Service request</span>
            <h2>{workflow.taskLabel}</h2>
            <p className="service-request-intro">Provide only the details this service needs. You will review and sign the final BNB checkout next.</p>
            <div className="service-requirement-fields">
              {workflow.requirements.map((field) => (
                <label key={field.name}>
                  {field.label}
                  <input
                    name={field.name}
                    type={field.type ?? "text"}
                    {...(field.name === "publicAccount" && field.required
                      ? { pattern: "0x[0-9a-fA-F]{40}" }
                      : {})}
                    {...(field.required ? { required: true } : {})}
                    defaultValue={
                      field.name === "threshold"
                        ? "1.30"
                        : field.name === "durationDays"
                          ? "14"
                          : undefined
                    }
                    placeholder={field.placeholder}
                  />
                  <small>{field.helper}</small>
                </label>
              ))}
            </div>
            <div className="service-deliverables" aria-label="Expected deliverables">
              <span>You'll receive</span>
              <ul>
                {workflow.deliverables.map((deliverable) => (
                  <li key={deliverable}>{deliverable}</li>
                ))}
              </ul>
            </div>
          </section>
          <section className="hire-confirmation-step">
            <span className="overline">Review & confirm</span>
            <h2>Ready to create this task?</h2>
            <p className="hire-permission-summary">{workflow.permissionSummary}</p>
            <details className="hire-permission-details">
              <summary>See the allowed actions</summary>
              <ul>
                {capabilities.map((capability) => (
                  <li key={capability}>{productCapabilityLabel(capability)}</li>
                ))}
              </ul>
            </details>
            <label className="terms-confirm">
              <input
                type="checkbox"
                name="explicitApproval"
                value="approved"
                required
              />{" "}
              I approve this read-only permission and its expiry.
            </label>
            <button className="hire-primary-cta" type="submit">
              {isFreePrice(offer.version.price)
                ? "Confirm & start"
                : "Confirm & continue"}
            </button>
            <small>
              Next, you will sign the service agreement. If payment is needed,
              your wallet will show the BNB checkout before anything is funded.
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
            <button className="hire-primary-cta" type="submit">
              Review terms
            </button>
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
            <button className="hire-primary-cta" type="submit">
              Accept terms
            </button>
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
            continuationHref={`/account/my-hires/mandates/${selectedMandate.mandate.id}?start=1`}
            autoStart={search.autoAuthorize === "1"}
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
            href={`/account/my-hires/mandates/${selectedMandate.mandate.id}`}
          >
            Continue to fund task
          </Link>
          <details className="technical-details">
            <summary>Technical details</summary>
            <p>Signed quote → ERC-8183 job → fund escrow → provider observes job</p>
          </details>
        </section>
          )}
        </div>

        <aside className="hire-service-rail">
          <section className="hire-service-summary profile-section">
            <span className="overline">Selected service</span>
            <h2>{productCapabilityLabel(offer.version.capability)}</h2>
            <p>{offer.version.terms}</p>
            <dl className="commerce-facts">
              <div>
                <dt>Price</dt>
                <dd>{commercePriceLabel(offer.version.price)}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>
                  {offer.version.chainId === 97 ? "BSC Testnet" : "BSC Mainnet"}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}
