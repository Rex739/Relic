import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Brand } from "@/components/relic/Brand";
import { ProcessStrip } from "@/components/relic/ProcessStrip";
import { SectionEyebrow } from "@/components/relic/SectionEyebrow";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <Brand />
          <nav className="flex gap-6 text-sm text-muted" aria-label="Primary navigation">
            <a href="#platform" className="focus-ring hover:text-ink">Platform</a>
            <a href="#use-cases" className="focus-ring hover:text-ink">Use cases</a>
            <a href="#method" className="focus-ring hover:text-ink">How it works</a>
          </nav>
          <div className="flex gap-3">
            <Link href="/review/meridian-billing" className="focus-ring border border-line px-4 py-2 text-sm hover:border-ink">View sample</Link>
            <Link href="/review/new" className="focus-ring bg-ink px-4 py-2 text-sm font-semibold text-canvas">Open workspace</Link>
          </div>
        </div>
      </header>

      <section id="platform" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[1fr_0.9fr] lg:py-24">
        <div>
          <SectionEyebrow>Change intelligence for systems nobody fully remembers</SectionEyebrow>
          <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[0.96] tracking-tight md:text-7xl">
            Understand what legacy code does. Prove what a change will cause.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted">
            Relic maps hidden dependencies, challenges risky assumptions, and gives teams evidence before a critical
            system is altered.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/review/new" className="focus-ring inline-flex items-center gap-2 bg-ink px-5 py-3 text-sm font-semibold text-canvas">
              Run a safety review <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/review/meridian-billing" className="focus-ring border border-line px-5 py-3 text-sm font-semibold hover:border-ink">
              View sample review
            </Link>
          </div>
        </div>
        <div className="relative min-h-[420px] border border-line bg-raised p-4">
          <Image src="/relic-strata.svg" alt="" fill className="object-cover" priority />
          <div className="absolute bottom-6 left-6 right-6 border border-line bg-raised/95 p-5 backdrop-blur-sm">
            <div className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Meridian Grid / Billing Core</div>
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4 text-sm">
              <div>Change surface mapped</div>
              <div><span className="block text-2xl font-semibold">8</span> components affected</div>
              <div><span className="block text-2xl font-semibold text-blocked">1</span> critical regression detected</div>
            </div>
          </div>
        </div>
      </section>

      <section id="method" className="border-t border-line px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <SectionEyebrow>The Relic method</SectionEyebrow>
          <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
            Every proposed change becomes a traceable chain of evidence.
          </h2>
          <div className="mt-10">
            <ProcessStrip />
          </div>
        </div>
      </section>

      <section className="border-t border-line px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1fr]">
          <Image src="/relic-system-map.svg" alt="" width={960} height={620} className="border border-line bg-raised" />
          <div className="self-center">
            <SectionEyebrow>System context</SectionEyebrow>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight">Legacy systems are not black boxes. They are undocumented maps.</h2>
            <p className="mt-5 text-lg leading-8 text-muted">
              Relic turns hidden dependencies, historical rules, and critical business paths into a reviewable decision surface.
            </p>
          </div>
        </div>
      </section>

      <section id="use-cases" className="border-t border-line px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-3">
          {[
            ["Dependency intelligence", "Find the systems a change silently reaches."],
            ["Adversarial review", "Expose the path that ordinary implementation planning misses."],
            ["Evidence receipts", "Give teams a structured record of why a decision was made."],
          ].map(([title, copy]) => (
            <div key={title} className="border-t border-line pt-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-moss">{title}</div>
              <p className="mt-4 text-lg leading-7">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <SectionEyebrow>Ready to review a change?</SectionEyebrow>
          <div className="mt-4 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <h2 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
              Before a critical system changes, understand what moves with it.
            </h2>
            <div className="flex gap-3">
              <Link href="/review/new" className="focus-ring bg-ink px-5 py-3 text-sm font-semibold text-canvas">Run a safety review</Link>
              <Link href="/review/meridian-billing" className="focus-ring border border-line px-5 py-3 text-sm font-semibold hover:border-ink">View sample review</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 text-sm text-muted md:flex-row md:items-center md:justify-between">
          <div><span className="text-xl font-semibold text-ink">relic</span> · Make legacy systems legible.</div>
          <div className="flex flex-wrap gap-5">
            <span>Platform</span>
            <span>Product</span>
            <Link href="/review/new">Review workspace</Link>
            <Link href="/review/meridian-billing">Sample review</Link>
          </div>
          <div>© 2026 Relic simulation MVP</div>
        </div>
      </footer>
    </main>
  );
}
