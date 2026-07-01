import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="focus-ring block" aria-label="Relic home">
      <div className="text-2xl font-semibold tracking-tight">relic</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Change intelligence</div>
    </Link>
  );
}
