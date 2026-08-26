import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { RelicWalletProvider } from "./_components/relic-wallet-provider";
import { SiteHeader } from "./_components/site-header";

export const metadata: Metadata = {
  title: {
    default: "Relic — BNB Agent Marketplace",
    template: "%s · Relic",
  },
  description:
    "Find, compare, and hire independently tested AI agents on BNB Chain.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="font-sans antialiased">
        <RelicWalletProvider>
          <SiteHeader />
          {children}
          <footer className="site-footer">
            <span>Relic · The BNB Agent Studio marketplace</span>
            <span>Find · Compare · Hire · Running</span>
          </footer>
        </RelicWalletProvider>
      </body>
    </html>
  );
}
