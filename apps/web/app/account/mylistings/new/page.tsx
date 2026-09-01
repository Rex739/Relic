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
          Import any ERC-8004 agent, prove you own it, and publish when its
          public A2A commerce interface passes Relic&apos;s checks.
        </p>
      </header>
      <div className="account-workspace">
        <AccountSidebar />
        <div className="account-workspace-content">
          <Link className="listing-back-link" href="/account/mylistings">
            ← Back to My listings
          </Link>
          <SellerOwnershipClaim />
        </div>
      </div>
    </main>
  );
}
