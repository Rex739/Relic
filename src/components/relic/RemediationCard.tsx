export function RemediationCard({ remediation }: { remediation: string }) {
  return (
    <section className="border border-line bg-raised p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ochre">Remediation</div>
      <p className="mt-4 text-sm leading-6 text-muted">{remediation}</p>
    </section>
  );
}
