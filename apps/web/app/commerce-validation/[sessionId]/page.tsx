import type { Metadata } from "next";
import Link from "next/link";

import { formatBaseUnits } from "@relic/domain";

import { WalletSession } from "../../_components/wallet-session";
import { CommerceValidationClaim } from "../../_components/commerce-validation-claim";
import { commerceValidationSession } from "../../../lib/commerce";
import { productCapabilityLabel } from "../../../lib/marketplace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commerce validation" };

export default async function CommerceValidationPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ sessionId }, search] = await Promise.all([params, searchParams]);
  if (search.token === undefined)
    return (
      <main className="page-shell">
        <div className="state-panel">
          <h1>This validation link is incomplete.</h1>
          <p>Ask the verified seller to create a fresh commerce validation.</p>
        </div>
      </main>
    );
  let handoff: Awaited<ReturnType<typeof commerceValidationSession>>;
  try {
    handoff = await commerceValidationSession(sessionId, search.token);
  } catch (error) {
    return (
      <main className="page-shell">
        <div className="state-panel">
          <h1>This validation link is unavailable.</h1>
          <p>
            {error instanceof Error ? error.message : "Create a fresh link."}
          </p>
        </div>
      </main>
    );
  }
  const { session, offer } = handoff;
  const price = `${formatBaseUnits(
    offer.version.price.amountBaseUnits,
    offer.version.price.decimals,
  )} ${offer.version.price.symbol}`;
  const expired =
    session.status === "EXPIRED" || new Date(session.expiresAt) <= new Date();
  return (
    <main className="page-shell validation-handoff-page">
      <header className="operations-header">
        <span className="overline">Independent commerce validation</span>
        <h1>Validate this marketplace offer.</h1>
        <p>
          A separate buyer wallet must complete one genuine service lifecycle.
          The result is validation evidence, not customer history or a review.
        </p>
      </header>
      <section className="profile-section validation-offer-summary">
        <div>
          <span className="overline">Offer snapshot</span>
          <h2>{productCapabilityLabel(offer.version.capability)}</h2>
          <p>{offer.version.terms}</p>
        </div>
        <dl className="commerce-facts">
          <div>
            <dt>Price</dt>
            <dd>{price}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>
              {offer.version.chainId === 97 ? "BSC Testnet" : "BNB Chain"}
            </dd>
          </div>
          <div>
            <dt>Billing</dt>
            <dd>
              {offer.version.billingModel.toLowerCase().replaceAll("_", " ")}
            </dd>
          </div>
          <div>
            <dt>Link expires</dt>
            <dd>{new Date(session.expiresAt).toLocaleString()}</dd>
          </div>
        </dl>
      </section>
      {expired ||
      ["CANCELLED", "EXPIRED", "COMPLETED"].includes(session.status) ? (
        <section className="state-panel">
          <h2>This handoff cannot be started.</h2>
          <p>
            Its current state is {session.status.toLowerCase()}. Ask the seller
            for a fresh link.
          </p>
        </section>
      ) : session.status === "CLAIMED" ? (
        <section className="profile-section validation-wallet-step">
          <span className="overline">Buyer wallet confirmed</span>
          <h2>The validation agreement is ready for review.</h2>
          <p>
            The mandate is limited to this exact offer and one validation
            execution. No transaction was submitted during preparation.
          </p>
          {session.agreementId === null ? (
            <div className="readiness-warning">
              <strong>Agreement preparation needs attention.</strong>
              <span>Claim this link again with the same buyer wallet.</span>
            </div>
          ) : (
            <Link
              className="primary-button"
              href={`/commerce/agreements/${encodeURIComponent(session.agreementId)}`}
            >
              Review validation agreement
            </Link>
          )}
        </section>
      ) : (
        <section className="profile-section validation-wallet-step">
          <span className="overline">Buyer wallet required</span>
          <h2>Connect a wallet that is not the seller wallet.</h2>
          <p>
            The buyer pays the exact published price plus network gas. Relic
            will show every operation before asking for a wallet confirmation;
            no transaction is submitted automatically.
          </p>
          <WalletSession connectLabel="Connect separate buyer wallet" />
          <CommerceValidationClaim
            sessionId={session.id}
            handoffToken={search.token}
          />
          <div className="readiness-warning">
            <strong>Validation setup is prepared but not yet claimed.</strong>
            <span>
              The durable operation sequence remains fail-closed until the buyer
              explicitly continues. No marketplace outcome exists yet.
            </span>
          </div>
        </section>
      )}
        <Link href="/account/mylistings">Return to my listings</Link>
    </main>
  );
}
