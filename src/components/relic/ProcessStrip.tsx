const steps = [
  ["01", "MAP", "Reveal the code paths and downstream dependencies a change will touch."],
  ["02", "CHALLENGE", "Force the system to look for assumptions, conflicts, and edge conditions."],
  ["03", "TEST", "Run reproducible checks against the affected business logic."],
  ["04", "DECIDE", "Issue a clear recommendation with evidence and required sign-off."],
];

export function ProcessStrip() {
  return (
    <div className="border-y border-line">
      {steps.map(([number, label, copy]) => (
        <div key={label} className="grid gap-5 border-b border-line py-7 last:border-b-0 md:grid-cols-[90px_180px_1fr_80px]">
          <div className="font-mono text-sm text-muted">{number}</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-moss">{label}</div>
          <div>
            <h3 className="text-xl font-semibold tracking-tight">{copy.split(" ").slice(0, 5).join(" ")}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{copy}</p>
          </div>
          <div className="h-10 border border-line bg-raised" />
        </div>
      ))}
    </div>
  );
}
