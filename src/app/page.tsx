import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Brand } from "@/components/relic/Brand";
import { BrandLogo } from "@/components/relic/BrandLogo";
import { HeroReveal } from "@/components/relic/HeroReveal";
import { LandingMotion } from "@/components/relic/LandingMotion";
import { MobileNavigation } from "@/components/relic/MobileNavigation";
import { ProcessStrip } from "@/components/relic/ProcessStrip";
import { SectionEyebrow } from "@/components/relic/SectionEyebrow";

export default function HomePage() {
  return (
    <LandingMotion>
      <main className="min-h-screen overflow-x-hidden bg-canvas text-ink">
        <header className="border-b border-line">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:py-5">
          <Brand />
          <nav className="hidden gap-6 text-sm text-muted lg:flex" aria-label="Primary navigation">
            <a href="#platform" className="focus-ring hover:text-ink">Platform</a>
            <a href="#use-cases" className="focus-ring hover:text-ink">Use cases</a>
            <a href="#method" className="focus-ring hover:text-ink">How it works</a>
          </nav>
          <div className="hidden gap-3 lg:flex">
            <Link href="/review/meridian-billing" className="focus-ring border border-line px-4 py-2 text-sm hover:border-ink">View sample</Link>
            <Link href="/review/new" className="focus-ring bg-ink px-4 py-2 text-sm font-semibold text-canvas">Open workspace</Link>
          </div>
          <MobileNavigation />
        </div>
        </header>

        <section
          id="platform"
          className="mx-auto grid max-w-7xl gap-10 px-5 py-[clamp(72px,8vw,120px)] lg:grid-cols-[1fr_0.9fr]"
          data-hero-section
          data-section="hero"
        >
        <div>
          <SectionEyebrow data-hero-eyebrow>Change intelligence for systems nobody fully remembers</SectionEyebrow>
          <HeroReveal />
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted" data-hero-copy>
            Relic maps hidden dependencies, challenges risky assumptions, and gives teams evidence before a critical
            system is altered.
          </p>
          <div className="mt-9 flex flex-wrap gap-3" data-hero-actions>
            <Link href="/review/new" className="focus-ring inline-flex items-center gap-2 bg-ink px-5 py-3 text-sm font-semibold text-canvas">
              Run a safety review <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/review/meridian-billing" className="focus-ring border border-line px-5 py-3 text-sm font-semibold hover:border-ink">
              View sample review
            </Link>
          </div>
        </div>
        <div className="relative min-h-[420px] border border-line bg-raised p-4" data-hero-artifact>
          <div className="absolute inset-0" data-strata-parallax>
            <Image src="/relic-strata.svg" alt="" fill className="object-cover" preload sizes="(min-width: 1024px) 45vw, 100vw" />
          </div>
          <div className="absolute bottom-6 left-6 right-6 border border-line bg-raised/95 p-5 shadow-sm backdrop-blur-sm" data-hero-panel>
            <div className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Meridian Grid / Billing Core</div>
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4 text-sm">
              <div>Change surface mapped</div>
              <div><span className="block text-2xl font-semibold">8</span> components affected</div>
              <div><span className="block text-2xl font-semibold text-blocked">1</span> critical regression detected</div>
            </div>
          </div>
        </div>
        </section>

        <section
          id="method"
          className="border-t border-line px-5 pb-[clamp(72px,6vw,96px)] pt-[clamp(88px,9vw,144px)]"
          data-section="method"
        >
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

        <section
          className="border-t border-line px-5 py-[clamp(88px,8vw,128px)]"
          data-map-motion-section
          data-map-section
          data-section="system-map"
        >
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1fr]">
          <div data-map-artifact>
            <div data-map-parallax>
              <Image
                src="/relic-system-map.svg"
                alt=""
                width={960}
                height={620}
                className="border border-line bg-raised"
                preload
                sizes="(min-width: 1024px) 48vw, 100vw"
              />
            </div>
          </div>
          <div className="self-center">
            <SectionEyebrow data-reveal-heading>System context</SectionEyebrow>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight" data-reveal-heading>Legacy systems are not black boxes. They are undocumented maps.</h2>
            <p className="mt-5 text-lg leading-8 text-muted" data-reveal-copy>
              Relic turns hidden dependencies, historical rules, and critical business paths into a reviewable decision surface.
            </p>
          </div>
        </div>
        </section>

        <section
          id="use-cases"
          className="border-t border-line px-5 py-[clamp(80px,8vw,128px)]"
          data-section="outcomes"
          aria-label="Relic outcomes"
        >
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-3">
          {[
            ["DEPENDENCY INTELLIGENCE", "Find the systems a change silently reaches."],
            ["ADVERSARIAL REVIEW", "Expose the path that ordinary implementation planning misses."],
            ["EVIDENCE RECEIPTS", "Give teams a structured record of why a decision was made."],
          ].map(([title, copy]) => (
            <div
              key={title}
              className="border-t border-line pt-5"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-moss">{title}</div>
              <p className="mt-4 text-lg leading-7">{copy}</p>
            </div>
          ))}
        </div>
        </section>

        <section
          className="relative overflow-hidden border-t border-line px-5 py-[clamp(72px,7vw,112px)]"
          data-section="final-cta"
        >
        <div className="absolute inset-x-0 top-0 h-24 opacity-35">
          <Image src="/relic-strata.svg" alt="" fill className="object-cover object-top" sizes="100vw" />
        </div>
        <div className="relative mx-auto max-w-7xl">
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
        <div className="mx-auto grid max-w-7xl gap-8 text-sm text-muted lg:grid-cols-[280px_1fr_auto] lg:items-center">
          <div className="max-w-[280px]">
            <BrandLogo variant="compact" theme="light" />
            <p className="mt-3 leading-6">Make legacy systems legible.</p>
          </div>
          <nav className="grid gap-3 sm:grid-cols-2 lg:flex lg:justify-center lg:gap-6" aria-label="Footer navigation">
            <a href="#platform" className="focus-ring hover:text-ink">Platform</a>
            <a href="#use-cases" className="focus-ring hover:text-ink">Product</a>
            <Link href="/review/new" className="focus-ring hover:text-ink">Review workspace</Link>
            <Link href="/review/meridian-billing" className="focus-ring hover:text-ink">Sample review</Link>
          </nav>
          <div className="lg:text-right">© 2026 Relic simulation MVP</div>
        </div>
        </footer>
      </main>
    </LandingMotion>
  );
}
