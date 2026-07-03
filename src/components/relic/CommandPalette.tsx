"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { cn } from "@/lib/relic/utils";

type CommandPaletteProps = {
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

type CommandItem = {
  id: string;
  label: string;
  group: "Navigation" | "Workspace";
  keywords: string[];
  href?: string;
  action?: () => void;
};

export function CommandPalette({ onClose, triggerRef }: CommandPaletteProps) {
  const router = useRouter();
  const { setSidebarExpanded } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const commands = useMemo<CommandItem[]>(
    () => [
      {
        id: "home",
        label: "Go to Relic home",
        group: "Navigation",
        keywords: ["home", "landing", "relic"],
        href: "/",
      },
      {
        id: "new-review",
        label: "New safety review",
        group: "Navigation",
        keywords: ["new", "review", "safety"],
        href: "/review/new",
      },
      {
        id: "meridian-review",
        label: "Open Meridian Billing review",
        group: "Navigation",
        keywords: ["meridian", "billing", "sample", "review"],
        href: "/review/meridian-billing",
      },
      {
        id: "systems",
        label: "Open Systems",
        group: "Navigation",
        keywords: ["systems", "registry", "meridian"],
        href: "/systems",
      },
      {
        id: "evidence",
        label: "Open Evidence",
        group: "Navigation",
        keywords: ["evidence", "receipt", "review"],
        href: "/review/meridian-billing?tab=evidence",
      },
      {
        id: "settings",
        label: "Open Workspace settings",
        group: "Navigation",
        keywords: ["settings", "workspace", "configuration"],
        href: "/settings",
      },
      {
        id: "collapse-sidebar",
        label: "Collapse workspace navigation",
        group: "Workspace",
        keywords: ["collapse", "sidebar", "navigation"],
        action: () => setSidebarExpanded(false),
      },
      {
        id: "expand-sidebar",
        label: "Expand workspace navigation",
        group: "Workspace",
        keywords: ["expand", "sidebar", "navigation"],
        action: () => setSidebarExpanded(true),
      },
    ],
    [setSidebarExpanded],
  );

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return commands;
    }

    return commands.filter((command) =>
      [command.label, command.group, ...command.keywords].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [commands, query]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const safeSelectedIndex = Math.min(selectedIndex, Math.max(filteredCommands.length - 1, 0));

  function closePalette() {
    onClose();
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function runCommand(command: CommandItem) {
    if (command.href) {
      router.push(command.href);
    } else {
      command.action?.();
    }

    closePalette();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => (filteredCommands.length > 0 ? (current + 1) % filteredCommands.length : 0));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        filteredCommands.length > 0 ? (current - 1 + filteredCommands.length) % filteredCommands.length : 0,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selectedCommand = filteredCommands[safeSelectedIndex];
      if (selectedCommand) {
        runCommand(selectedCommand);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 px-3 py-20 sm:px-6" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-ink/18"
        aria-label="Close command palette"
        onClick={closePalette}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace command palette"
        className="relative mx-auto max-h-[min(72dvh,560px)] w-full max-w-xl overflow-hidden border border-line bg-raised text-ink shadow-sm"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder="Search commands"
            aria-label="Search commands"
          />
          <span className="hidden border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted sm:inline">
            Esc
          </span>
        </div>

        <div className="max-h-[calc(min(72dvh,560px)-53px)] overflow-y-auto p-2">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command, index) => {
              const selected = index === safeSelectedIndex;
              const Icon = command.id === "collapse-sidebar" ? PanelLeftClose : command.id === "expand-sidebar" ? PanelLeftOpen : ArrowRight;

              return command.href ? (
                <Link
                  key={command.id}
                  href={command.href}
                  className={cn(
                    "focus-ring flex w-full items-center justify-between gap-4 px-3 py-3 text-left text-sm transition-colors",
                    selected ? "bg-canvas text-ink" : "text-muted hover:bg-canvas hover:text-ink",
                  )}
                  data-selected={selected ? "true" : undefined}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={closePalette}
                >
                  <CommandLabel command={command} />
                  <Icon size={15} aria-hidden="true" />
                </Link>
              ) : (
                <button
                  key={command.id}
                  type="button"
                  className={cn(
                    "focus-ring flex w-full items-center justify-between gap-4 px-3 py-3 text-left text-sm transition-colors",
                    selected ? "bg-canvas text-ink" : "text-muted hover:bg-canvas hover:text-ink",
                  )}
                  data-selected={selected ? "true" : undefined}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => runCommand(command)}
                >
                  <CommandLabel command={command} />
                  <Icon size={15} aria-hidden="true" />
                </button>
              );
            })
          ) : (
            <div className="px-3 py-8 text-center text-sm text-muted">No commands found.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function CommandLabel({ command }: { command: CommandItem }) {
  return (
    <span className="min-w-0">
      <span className="block truncate font-medium">{command.label}</span>
      <span className="mt-1 block text-[11px] uppercase tracking-[0.16em] text-muted">{command.group}</span>
    </span>
  );
}
