import Link from "next/link";
import { ArrowLeft, Command } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

export function CommandBar({ breadcrumb }: { breadcrumb: string }) {
  return (
    <div className="flex flex-col gap-4 border-b border-line px-4 py-4 md:flex-row md:items-center md:justify-between lg:px-10">
      <div className="flex min-w-0 items-center gap-3 text-sm text-muted">
        <Link href="/" className="focus-ring inline-flex min-w-0 items-center gap-2 hover:text-ink">
          <ArrowLeft size={15} aria-hidden="true" />
          <span className="truncate">{breadcrumb}</span>
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status="Simulation" />
        <button className="focus-ring inline-flex items-center gap-2 border border-line px-3 py-2 text-sm text-muted hover:text-ink" type="button">
          <Command size={15} aria-hidden="true" />
          Command
        </button>
      </div>
    </div>
  );
}
