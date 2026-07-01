export function MetricCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="border-l border-line pl-4">
      <div className="text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-muted">{label}</div>
    </div>
  );
}
