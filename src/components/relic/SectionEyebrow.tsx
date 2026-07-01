import { cn } from "@/lib/relic/utils";

export function SectionEyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("text-[11px] font-semibold uppercase tracking-[0.2em] text-moss", className)}>
      {children}
    </div>
  );
}
