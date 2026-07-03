export function HeroReveal() {
  return (
    <h1
      data-hero-heading
      className="mt-6 max-w-4xl text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl"
    >
      <span className="-my-[0.05em] block min-w-0 overflow-visible py-[0.05em] lg:overflow-hidden" data-hero-line>
        <span className="block min-w-0">
          Understand what <br className="sm:hidden" />
          legacy code does.
        </span>
      </span>
      <span className="-my-[0.05em] block min-w-0 overflow-visible py-[0.05em] lg:overflow-hidden" data-hero-line>
        <span className="block min-w-0">
          Prove what a <br className="sm:hidden" />
          change will cause.
        </span>
      </span>
    </h1>
  );
}
