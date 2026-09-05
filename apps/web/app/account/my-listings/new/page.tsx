import type { Metadata } from "next";
import Link from "next/link";

import { AccountSidebar } from "../../../_components/account-sidebar";
import { SellerOwnershipClaim } from "../../../_components/seller-ownership-claim";

export const metadata: Metadata = { title: "Register an agent" };

export default function RegisterAgentPage() {
  return (
    <main className="page-shell operator-page seller-claim-page">
      <header className="operations-header">
        <span className="overline">For sellers</span>
        <h1>Register an agent.</h1>
        <p>
          Import an existing ERC-8004 identity, then verify the current owner
          before setting up its marketplace listing.
        </p>
      </header>
      <div className="account-workspace">
        <AccountSidebar />
        <div className="account-workspace-content">
          <Link className="listing-back-link" href="/account/my-listings">
            ← Back to My listings
          </Link>
          <SellerOwnershipClaim />
        </div>
      </div>
    </main>
  );
}
