import Link from "next/link";

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
      <nav aria-label="Primary navigation">
        <Link href="/marketplace">Marketplace</Link>
        <Link href="/compare">Compare</Link>
        <Link href="/my-agents">My Agents</Link>
      </nav>
      <div className="network-pill">
        <span /> BNB ecosystem
      </div>
    </header>
  );
}
