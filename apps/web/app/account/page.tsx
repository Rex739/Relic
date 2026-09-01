"use client";

import { Wallet } from "lucide-react";

import { AccountSidebar } from "../_components/account-sidebar";
import { useRelicWallet } from "../_components/relic-wallet-provider";
import { WalletSession } from "../_components/wallet-session";

export default function AccountPage() {
  const wallet = useRelicWallet();

  return (
    <main className="page-shell account-page">
      <span className="overline">YOUR RELIC ACCOUNT</span>
      <h1>Account</h1>
      <p className="page-intro">
        Your sign-in and BSC Testnet wallet stay together here.
      </p>
      <div className="account-workspace">
        <AccountSidebar />
        <div className="account-workspace-content">
          {wallet.authenticated && wallet.address !== null ? (
            <section className="account-card">
              <div className="account-card-icon">
                <Wallet size={22} />
              </div>
              <div>
                <span>CONNECTED WALLET</span>
                <h2>
                  {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                </h2>
                <p>
                  {wallet.profile?.isGoogleUser
                    ? "Signed in with Google · embedded wallet on BSC Testnet"
                    : "External wallet connected on BSC Testnet"}
                </p>
              </div>
            </section>
          ) : (
            <section className="account-card account-card-empty">
              <div>
                <h2>Connect to manage your account</h2>
                <p>
                  Use Google for an embedded wallet or connect your own wallet.
                </p>
              </div>
              <WalletSession connectLabel="Connect to Relic" />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
