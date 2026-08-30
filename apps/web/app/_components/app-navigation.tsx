"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    href: "/marketplace",
    label: "Agents",
    match: ["/marketplace", "/agents", "/categories", "/compare"],
  },
  {
    href: "/my-agents",
    label: "My Agents",
    match: ["/my-agents", "/mandates", "/commerce"],
  },
  {
    href: "/operator/offers",
    label: "For Sellers",
    match: ["/operator"],
  },
];

export function AppNavigation() {
  const pathname = usePathname();
  const links = items.map((item) => (
    <Link
      href={item.href}
      className={
        item.match.some((prefix) => pathname.startsWith(prefix)) ? "active" : ""
      }
      key={item.href}
    >
      {item.label}
    </Link>
  ));
  return (
    <>
      <nav className="desktop-navigation" aria-label="Primary navigation">
        {links}
      </nav>
      <details className="mobile-navigation">
        <summary aria-label="Open navigation">Menu</summary>
        <nav aria-label="Mobile navigation">
          {links}
          <Link href="/compare">Compare</Link>
        </nav>
      </details>
    </>
  );
}
