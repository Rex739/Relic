export function LoadingState() {
  return (
    <div className="border border-line bg-raised p-8" role="status" aria-live="polite">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-moss">Reviewing</div>
      <div className="mt-4 h-1 w-full overflow-hidden bg-line">
        <div className="h-full w-1/2 animate-pulse bg-moss" />
      </div>
      <p className="mt-5 max-w-xl text-sm leading-6 text-muted">
        Relic is mapping dependencies, challenging implementation assumptions, and running deterministic regression checks.
      </p>
    </div>
  );
}
