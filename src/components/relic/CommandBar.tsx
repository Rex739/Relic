"use client";

import Link from "next/link";
import { ArrowLeft, Command } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CommandPalette } from "./CommandPalette";
import { SimulationBadge } from "./SimulationBadge";

export function CommandBar({ breadcrumb }: { breadcrumb: string }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const commandButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col gap-4 border-b border-line px-4 py-4 md:flex-row md:items-center md:justify-between lg:px-10">
      <div className="flex min-w-0 items-center gap-3 text-sm text-muted">
        <Link href="/" className="focus-ring inline-flex min-w-0 items-center gap-2 hover:text-ink">
          <ArrowLeft size={15} aria-hidden="true" />
          <span className="truncate">{breadcrumb}</span>
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SimulationBadge />
        <button
          ref={commandButtonRef}
          className="focus-ring inline-flex items-center gap-2 border border-line px-3 py-2 text-sm text-muted hover:text-ink"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
          onClick={() => setPaletteOpen(true)}
        >
          <Command size={15} aria-hidden="true" />
          Command
        </button>
      </div>
      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          triggerRef={commandButtonRef}
        />
      ) : null}
    </div>
  );
}
