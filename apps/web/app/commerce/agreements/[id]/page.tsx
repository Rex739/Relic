import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { agreement } from "../../../../lib/commerce";
import {
  commercePriceLabel,
  isFreePrice,
  paymentRequirementLabel,
} from "../../../../lib/commerce-display";
import { CommerceAuthorization } from "../../../_components/commerce-authorization";
import { WalletCommerceOperation } from "../../../_components/wallet-commerce-operation";
import {
  acceptTermsAction,
  cancelAgreementAction,
  prepareCommerceValidationAction,
  revokeAuthorizationAction,
} from "../../../commerce-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commerce agreement" };

export default async function CommerceAgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let item: Record<string, unknown> | null = null;
  try {
    item = await agreement(id);
  } catch {
    notFound();
  }
  if (item === null) notFound();
  const status = String(item.status);
  const pricing = item.pricingSnapshot as {
    chainId: 56 | 97;
    amountBaseUnits: string;
    decimals: number;
    symbol: string;
    tokenAddress: string;
  };
  const events = Array.isArray(item.events)
    ? (item.events as Array<Record<string, unknown>>)
    : [];
  const operations = Array.isArray(item.operations)
    ? (item.operations as Array<Record<string, unknown>>)
    : [];
  const movements = Array.isArray(item.movements)
    ? (item.movements as Array<Record<string, unknown>>)
    : [];
  const mandateId = typeof item.mandateId === "string" ? item.mandateId : null;
  const validationAgreement = events.some(
    (event) => event.eventType === "VALIDATION_AGREEMENT_CREATED",
  );
  const executionRoomHref =
    mandateId === null || validationAgreement
      ? null
      : `/my-agents/mandates/${mandateId}`;
  const authorized = ["AUTHORIZED", "ACTIVE"].includes(status);
  const activeValidationOperation = validationAgreement
    ? [...operations].reverse().find((operation) => {
        const operationType = String(operation.operationType);
        const operationState = String(operation.state);
        return (
          [
            "APPROVE_TOKEN",
            "CREATE_JOB",
            "REGISTER_JOB",
            "SET_BUDGET",
            "FUND",
          ].includes(operationType) &&
          ["AWAITING_SIGNATURE", "SUBMITTED", "PENDING", "CONFIRMED"].includes(
            operationState,
          )
        );
      })
    : undefined;
  const validationEvidence = activeValidationOperation?.evidence as
    Record<string, unknown> | undefined;
  const validationFundingFinalized = validationAgreement
    ? operations.some(
        (operation) =>
          operation.operationType === "FUND" && operation.state === "FINALIZED",
      )
    : false;
  const validationQuote = validationEvidence?.quote as
    Record<string, unknown> | undefined;
  const quoteExpiresAt =
    typeof validationEvidence?.quoteExpiresAt === "number"
      ? validationEvidence.quoteExpiresAt
      : typeof validationQuote?.quoteExpiresAt === "number"
        ? validationQuote.quoteExpiresAt
        : undefined;
  const quoteNegotiatedAt =
    typeof validationEvidence?.negotiatedAt === "number"
      ? validationEvidence.negotiatedAt
      : typeof validationQuote?.negotiatedAt === "number"
        ? validationQuote.negotiatedAt
        : undefined;
  return (
    <main className="page-shell agreement-page">
      <header className="operations-header">
        <span className="overline">Commerce agreement</span>
        <h1>Review authority before execution</h1>
        <p>
          Terms, safety policy, wallet authorization, and transaction signing
          are separate controls.
        </p>
      </header>
      <div className="agreement-grid">
        <section className="profile-section">
          <span className="overline">Agreement</span>
          <h2>{status.replaceAll("_", " ")}</h2>
          <dl className="commerce-facts">
            <div>
              <dt>Price</dt>
              <dd>{commercePriceLabel(pricing)}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{paymentRequirementLabel(pricing)}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>
                {Number(item.chainId) === 97 ? "BSC Testnet" : "BSC Mainnet"}
              </dd>
            </div>
            <div>
              <dt>Mandate</dt>
              <dd>v{String(item.mandateVersion)}</dd>
            </div>
            <div>
              <dt>Terms hash</dt>
              <dd>{String(item.termsHash)}</dd>
            </div>
            <div>
              <dt>Authorization</dt>
              <dd>
                {item.authorizationArtifactId === null
                  ? "Not granted"
                  : "Verified wallet signature"}
              </dd>
            </div>
          </dl>
        </section>
        <section className="profile-section">
          <span className="overline">Immutable terms</span>
          <h2>Operator terms bound to this offer version</h2>
          <p className="terms-copy">{String(item.termsSnapshot)}</p>
          {status === "DRAFT" ? (
            <form action={acceptTermsAction} className="commerce-form">
              <input type="hidden" name="agreementId" value={id} />
              <input
                type="hidden"
                name="termsHash"
                value={String(item.termsHash)}
              />
              <label className="terms-confirm">
                <input type="checkbox" required /> I accept this exact terms
                snapshot and hash.
              </label>
              <button type="submit">Accept terms</button>
              <p>This does not grant transaction authority.</p>
            </form>
          ) : null}
          {status === "AUTHORIZATION_REQUIRED" ? (
            <CommerceAuthorization
              agreementId={id}
              continuationHref={
                validationAgreement
                  ? `/commerce/agreements/${id}`
                  : (executionRoomHref ?? "/my-agents")
              }
            />
          ) : null}
        </section>
      </div>
      {authorized && executionRoomHref !== null ? (
        <section className="agreement-next-step" aria-labelledby="next-step">
          <div>
            <span className="overline">Authorization complete</span>
            <h2 id="next-step">Your agent is ready to use</h2>
            <p>
              Open the Execution Room to submit a policy-controlled request
              under this mandate. Every request remains constrained by the
              authority you approved.
            </p>
          </div>
          <Link className="primary-action" href={executionRoomHref}>
            Open Execution Room <span aria-hidden="true">→</span>
          </Link>
        </section>
      ) : null}
      {status === "AUTHORIZED" && validationAgreement ? (
        <section className="agreement-next-step" aria-labelledby="next-step">
          <div>
            <span className="overline">Validation authority confirmed</span>
            <h2 id="next-step">Prepare the verified service setup</h2>
            <p>
              Relic will contact the offer's verified service, validate its
              signed price, and prepare the exact payment steps. This action
              does not submit a transaction or move funds.
            </p>
          </div>
          <form action={prepareCommerceValidationAction}>
            <input type="hidden" name="agreementId" value={id} />
            <button type="submit" className="primary-action">
              Prepare secure setup <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>
      ) : null}
      {status === "ACTIVE" &&
      validationAgreement &&
      activeValidationOperation !== undefined ? (
        <section className="agreement-next-step" aria-labelledby="next-step">
          <div>
            <span className="overline">Manual wallet setup</span>
            <h2 id="next-step">Confirm the next required step</h2>
            <p>
              Relic prepares one exact operation at a time. Your wallet must
              approve every transaction; Relic never submits one automatically.
            </p>
          </div>
          <WalletCommerceOperation
            agreementId={id}
            operationId={String(activeValidationOperation.id)}
            operationType={
              String(activeValidationOperation.operationType) as
                | "APPROVE_TOKEN"
                | "CREATE_JOB"
                | "REGISTER_JOB"
                | "SET_BUDGET"
                | "FUND"
            }
            operationState={
              String(activeValidationOperation.state) as
                "AWAITING_SIGNATURE" | "SUBMITTED" | "PENDING" | "CONFIRMED"
            }
            {...(quoteExpiresAt === undefined
              ? {}
              : {
                  initialQuoteExpiresAt: new Date(
                    quoteExpiresAt * 1_000,
                  ).toISOString(),
                })}
            {...(quoteNegotiatedAt === undefined
              ? {}
              : {
                  initialQuoteNegotiatedAt: new Date(
                    quoteNegotiatedAt * 1_000,
                  ).toISOString(),
                })}
            paidValidation
          />
        </section>
      ) : null}
      {status === "ACTIVE" &&
      validationAgreement &&
      activeValidationOperation === undefined &&
      validationFundingFinalized ? (
        <section className="agreement-next-step" aria-labelledby="next-step">
          <div>
            <span className="overline">Escrow funding confirmed</span>
            <h2 id="next-step">Delivery preparation is paused safely</h2>
            <p>
              The paid setup is complete. Relic will not invoke a provider that
              can submit a delivery transaction outside the durable wallet
              operation system. No settlement or reputation outcome is created
              while this safety boundary remains unresolved.
            </p>
          </div>
        </section>
      ) : null}
      <section className="profile-section execution-commerce">
        <span className="overline">Execution & settlement</span>
        <h2>Durable commercial state</h2>
        <div className="commerce-summary">
          <div>
            <b>{operations.length}</b>
            <span>durable operations</span>
          </div>
          <div>
            <b>{movements.length}</b>
            <span>verified value movements</span>
          </div>
          <div>
            <b>{events.length}</b>
            <span>agreement events</span>
          </div>
        </div>
        <p>
          {operations.length === 0
            ? "No ERC-8183 operation has been prepared. No funds have moved."
            : "Operations remain subject to signing, receipt, finality, and reorg reconciliation."}
        </p>
        <details className="technical-details">
          <summary>Technical evidence</summary>
          <pre>
            {JSON.stringify(
              {
                agreementId: id,
                events,
                operations,
                movements,
                artifacts: item.artifacts,
                paymentRepresentation: isFreePrice(pricing)
                  ? {
                      amountBaseUnits: pricing.amountBaseUnits,
                      tokenAddress: pricing.tokenAddress,
                      decimals: pricing.decimals,
                    }
                  : pricing,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </section>
      <section className="agreement-controls">
        <h2>Relationship controls</h2>
        {item.authorizationArtifactId === null ? null : (
          <form action={revokeAuthorizationAction}>
            <input type="hidden" name="agreementId" value={id} />
            <button type="submit">Revoke wallet authorization</button>
          </form>
        )}
        {[
          "DRAFT",
          "TERMS_ACCEPTED",
          "AUTHORIZATION_REQUIRED",
          "AUTHORIZED",
          "ACTIVE",
          "SUSPENDED",
        ].includes(status) ? (
          <form action={cancelAgreementAction}>
            <input type="hidden" name="agreementId" value={id} />
            <button type="submit" className="danger-link">
              Cancel agreement
            </button>
          </form>
        ) : null}
        <p>
          Onchain jobs cannot be cancelled here once their lifecycle requires a
          signed CANCEL operation.
        </p>
      </section>
      <Link href="/my-agents">Back to My Agents</Link>
    </main>
  );
}
