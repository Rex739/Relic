"use client";

import { Check, Copy, Wallet } from "lucide-react";
import { useState } from "react";

import { AccountSidebar } from "../_components/account-sidebar";
import { useRelicWallet } from "../_components/relic-wallet-provider";
import { WalletSession } from "../_components/wallet-session";

export default function AccountPage() {
  const wallet = useRelicWallet();
  const [copied, setCopied] = useState(false);

  const copyWalletAddress = async () => {
    if (wallet.address === null) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  };

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
              <div className="account-wallet-details">
                <span>CONNECTED WALLET</span>
                <div className="account-wallet-address-row">
                  <code>{wallet.address}</code>
                  <button
                    type="button"
                    className="account-wallet-copy"
                    onClick={() => void copyWalletAddress()}
                    aria-label="Copy wallet address"
                    title={copied ? "Copied" : "Copy wallet address"}
                  >
                    {copied ? (
                      <Check aria-hidden="true" size={16} strokeWidth={2} />
                    ) : (
                      <Copy aria-hidden="true" size={16} strokeWidth={2} />
                    )}
                  </button>
                </div>
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
