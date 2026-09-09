"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CircleHelp, Rocket, ShieldCheck } from "lucide-react";

const navigation = [
  { href: "/docs", label: "Overview", icon: BookOpen, exact: true },
  { href: "/docs/getting-started", label: "How to use Relic", icon: Rocket },
  { href: "/docs#verification", label: "Verification", icon: ShieldCheck },
];

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="docs-sidebar" aria-label="Documentation navigation">
      <div className="docs-sidebar-heading">DOCUMENTATION</div>
      <nav>
        {navigation.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link className={active ? "active" : ""} href={href} key={href}>
              <Icon size={16} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="docs-sidebar-support">
        <CircleHelp size={17} aria-hidden="true" />
        <div><strong>Need a hand?</strong><span>Start with the marketplace or review the guide.</span></div>
      </div>
    </aside>
  );
}
