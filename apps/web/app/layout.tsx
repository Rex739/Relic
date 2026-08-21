import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { SiteHeader } from "./_components/site-header";

export const metadata: Metadata = {
  title: {
    default: "Relic — Verified Agent Marketplace",
    template: "%s · Relic",
  },
  description: "Independently verified autonomous agents for BNB Chain.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="font-sans antialiased">
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <span>
            Relic verifies operability. Registration alone is never enough.
          </span>
          <span>BNB Chain · Evidence-first agent infrastructure</span>
        </footer>
      </body>
    </html>
  );
}
