const steps = [
  [
    "01",
    "MAP",
    "Reveal hidden dependencies.",
    "Reveal the code paths and downstream dependencies a change will touch.",
  ],
  [
    "02",
    "CHALLENGE",
    "Test assumptions before they become incidents.",
    "Force the system to look for assumptions, conflicts, and edge conditions.",
  ],
  [
    "03",
    "TEST",
    "Run evidence against the affected logic.",
    "Run reproducible checks against the affected business logic.",
  ],
  [
    "04",
    "DECIDE",
    "Turn analysis into a release decision.",
    "Issue a clear recommendation with evidence and required sign-off.",
  ],
];

function ProcessMarker({ label }: { label: string }) {
  return (
    <div className="group flex h-10 w-12 items-center justify-center border border-line bg-raised transition-colors duration-200 hover:border-moss">
      {label === "MAP" ? <MapGlyph /> : null}
      {label === "CHALLENGE" ? <ChallengeGlyph /> : null}
      {label === "TEST" ? <TestGlyph /> : null}
      {label === "DECIDE" ? <DecideGlyph /> : null}
    </div>
  );
}

function MapGlyph() {
  return (
    <svg aria-hidden="true" className="h-6 w-7 text-moss transition-colors duration-200 group-hover:text-ink" viewBox="0 0 28 24" fill="none">
      <path d="M8 7.5L14 12L20 6.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M14 12L20.5 17" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="8" cy="7.5" r="2.1" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="20" cy="6.5" r="2.1" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="20.5" cy="17" r="2.1" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function ChallengeGlyph() {
  return (
    <svg aria-hidden="true" className="h-6 w-7 text-moss transition-colors duration-200 group-hover:text-ink" viewBox="0 0 28 24" fill="none">
      <path d="M6 12H12M12 12L20 6M12 12L20 18" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="6" r="1.7" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="20" cy="18" r="1.7" stroke="#A9483F" strokeWidth="1.2" />
    </svg>
  );
}

function TestGlyph() {
  return (
    <svg aria-hidden="true" className="h-6 w-7 text-moss transition-colors duration-200 group-hover:text-ink" viewBox="0 0 28 24" fill="none">
      <path d="M7 6H21V18H7V6Z" stroke="currentColor" strokeWidth="1.25" />
      <path d="M7 10H21M11.5 6V18M16.5 6V18" stroke="currentColor" strokeWidth="1" opacity="0.75" />
      <path d="M10.2 14.2L12.4 16.2L17.8 11.1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DecideGlyph() {
  return (
    <svg aria-hidden="true" className="h-6 w-7 text-moss transition-colors duration-200 group-hover:text-ink" viewBox="0 0 28 24" fill="none">
      <path d="M8 4.5H18.5L21 7V19.5H8V4.5Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M18.5 4.5V7H21" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M11 11H18M11 14H17" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M11 17H15" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

export function ProcessStrip() {
  return (
    <div className="border-y border-line">
      <div className="h-px bg-moss" />
      {steps.map(([number, label, heading, copy]) => (
        <article
          key={label}
          className="grid gap-5 border-b border-line py-7 last:border-b-0 md:grid-cols-[90px_180px_1fr_80px]"
        >
          <div className="font-mono text-sm text-muted">{number}</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-moss">{label}</div>
          <div>
            <h3 className="text-xl font-semibold tracking-tight">{heading}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{copy}</p>
          </div>
          <ProcessMarker label={label} />
        </article>
      ))}
    </div>
  );
}
