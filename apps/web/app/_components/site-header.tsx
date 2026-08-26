import Link from "next/link";
import { AppNavigation } from "./app-navigation";
import { WalletSession } from "./wallet-session";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link
        href="/marketplace"
        className="brand"
        aria-label="Relic marketplace home"
      >
        <span className="brand-mark">R</span>
        <span>Relic</span>
      </Link>
      <AppNavigation />
      <div className="header-actions">
        <Link className="header-compare" href="/compare">
          Compare
        </Link>
        <WalletSession />
      </div>
    </header>
  );
}
