const boundaries = [
  ["Registry", "ERC-8004 reads through a replaceable provider"],
  ["Domain", "Canonical agents retain evidence per fact"],
  ["Storage", "PostgreSQL with versioned Drizzle migrations"],
  ["API", "REST v1 with generated OpenAPI documentation"],
] as const;

export default function EngineeringStatusPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <p className="mb-3 text-sm font-medium uppercase tracking-[0.22em] text-emerald-400">
        Internal engineering status
      </p>
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
        Relic Marketplace Kernel
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
        The production foundation is active. Marketplace presentation, scoring,
        commerce, and execution features are intentionally deferred.
      </p>
      <section className="mt-12 grid gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800 sm:grid-cols-2">
        {boundaries.map(([name, description]) => (
          <article key={name} className="bg-zinc-950 p-6">
            <h2 className="font-medium text-zinc-100">{name}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {description}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
