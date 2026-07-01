import Image from "next/image";
import Link from "next/link";

export function EmptyState() {
  return (
    <div className="border border-line bg-raised p-8">
      <Image src="/relic-system-map.svg" alt="" width={520} height={335} className="w-full border border-line" />
      <h2 className="mt-6 text-2xl font-semibold tracking-tight">No review selected</h2>
      <p className="mt-2 text-sm leading-6 text-muted">Open the Meridian Grid sample to inspect a completed safety review.</p>
      <Link href="/review/meridian-billing" className="focus-ring mt-5 inline-flex bg-ink px-4 py-3 text-sm font-semibold text-canvas">
        View sample review
      </Link>
    </div>
  );
}
