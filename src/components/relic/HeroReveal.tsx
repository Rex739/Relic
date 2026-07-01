export function HeroReveal() {
  return (
    <h1
      data-hero-heading
      className="mt-6 max-w-4xl text-5xl font-semibold leading-[0.96] tracking-tight md:text-7xl"
    >
      <span className="block overflow-visible lg:overflow-hidden" data-hero-line>
        <span className="block">Understand what legacy code does.</span>
      </span>
      <span className="block overflow-visible lg:overflow-hidden" data-hero-line>
        <span className="block">Prove what a change will cause.</span>
      </span>
    </h1>
  );
}
