import { cn } from "@/lib/relic/utils";

type SectionEyebrowProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export function SectionEyebrow({ children, className, ...props }: SectionEyebrowProps) {
  return (
    <div className={cn("text-[11px] font-semibold uppercase tracking-[0.2em] text-moss", className)} {...props}>
      {children}
    </div>
  );
}
