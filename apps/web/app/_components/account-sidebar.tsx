"use client";

import { Landmark, PackagePlus, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    href: "/account",
    label: "Account",
    icon: UserRound,
    match: (pathname: string) => pathname === "/account",
  },
  {
    href: "/account/mylistings",
    label: "My listings",
    icon: PackagePlus,
    match: (pathname: string) =>
      pathname.startsWith("/account/mylistings") || pathname.startsWith("/operator"),
  },
  {
    href: "/account/my-hires",
    label: "My orders",
    icon: Landmark,
    match: (pathname: string) =>
      ["/account/my-hires", "/my-agents", "/mandates", "/commerce"].some((path) =>
        pathname.startsWith(path),
      ),
  },
];

export function AccountSidebar() {
  const pathname = usePathname();

  return (
    <aside className="account-sidebar" aria-label="Account navigation">
      <span className="overline">Your workspace</span>
      <nav>
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);
          return (
            <Link
              className={active ? "active" : undefined}
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden="true" size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
