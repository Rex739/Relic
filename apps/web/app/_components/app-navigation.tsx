"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    href: "/marketplace",
    label: "Agents",
    match: ["/marketplace", "/agents", "/categories", "/compare"],
  },
];

export function AppNavigation() {
  const pathname = usePathname();
  return (
    <nav className="primary-navigation" aria-label="Primary navigation">
      {items.map((item) => (
        <Link
          href={item.href}
          className={
            item.match.some((prefix) => pathname.startsWith(prefix))
              ? "active"
              : ""
          }
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
