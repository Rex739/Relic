"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

function getTargets<T extends Element>(root: Element, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function addFrom(
  timeline: gsap.core.Timeline,
  targets: Element[],
  vars: gsap.TweenVars,
  position?: gsap.Position,
) {
  if (targets.length > 0) {
    timeline.from(targets, vars, position);
  }
}

export function LandingMotion({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const desktop = window.matchMedia("(min-width: 1024px)").matches;

    if (reduceMotion) {
      return;
    }

    const context = gsap.context(() => {
      const heroTimeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      const heroEyebrow = getTargets<HTMLElement>(root, "[data-hero-eyebrow]");
      const heroLines = getTargets<HTMLElement>(root, "[data-hero-line] > span");
      const heroHeading = getTargets<HTMLElement>(root, "[data-hero-heading]");
      const heroCopy = getTargets<HTMLElement>(root, "[data-hero-copy]");
      const heroActions = getTargets<HTMLElement>(root, "[data-hero-actions]");
      const heroArtifact = getTargets<HTMLElement>(root, "[data-hero-artifact]");
      const heroPanel = getTargets<HTMLElement>(root, "[data-hero-panel]");

      if (desktop) {
        addFrom(heroTimeline, heroEyebrow, { opacity: 0, y: 12, duration: 0.38 });
        addFrom(heroTimeline, heroLines, { opacity: 0, y: 24, duration: 0.48, stagger: 0.09 }, "-=0.18");
      } else {
        addFrom(heroTimeline, [...heroEyebrow, ...heroHeading], {
          opacity: 0,
          y: 10,
          duration: 0.42,
          stagger: 0.06,
        });
      }

      addFrom(heroTimeline, heroCopy, { opacity: 0, y: desktop ? 16 : 10, duration: 0.38 }, "-=0.18");
      addFrom(heroTimeline, heroActions, { opacity: 0, y: 12, duration: 0.34 }, "-=0.12");
      addFrom(
        heroTimeline,
        heroArtifact,
        { opacity: 0, y: desktop ? 28 : 10, scale: desktop ? 0.97 : 1, rotate: desktop ? 1.5 : 0, duration: 0.5 },
        "-=0.14",
      );
      addFrom(
        heroTimeline,
        heroPanel,
        {
          opacity: 0,
          y: desktop ? 20 : 10,
          scale: desktop ? 0.985 : 1,
          rotate: desktop ? -1 : 0,
          boxShadow: "0 0 0 rgba(20, 21, 18, 0)",
          duration: 0.42,
        },
        "-=0.24",
      );

      if (desktop) {
        const heroSection = getTargets<HTMLElement>(root, "[data-hero-section]");
        const strataParallax = getTargets<HTMLElement>(root, "[data-strata-parallax]");

        if (heroSection.length > 0 && strataParallax.length > 0) {
          gsap.to(strataParallax, {
            y: 24,
            ease: "none",
            scrollTrigger: {
              trigger: heroSection[0],
              start: "top top",
              end: "bottom top",
              scrub: true,
            },
          });
        }
      }

      getTargets<HTMLElement>(root, "[data-map-motion-section]").forEach((section) => {
        ScrollTrigger.create({
          trigger: section,
          start: "top 78%",
          end: "bottom 20%",
          once: true,
          onEnter: () => {
            const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
            const headings = getTargets<HTMLElement>(section, "[data-reveal-heading]");
            const copy = getTargets<HTMLElement>(section, "[data-reveal-copy]");
            const mapArtifact = getTargets<HTMLElement>(section, "[data-map-artifact]");

            addFrom(timeline, headings, { opacity: 0, y: 16, duration: 0.46 });
            addFrom(timeline, copy, { opacity: 0, y: 14, duration: 0.42 }, "-=0.22");
            addFrom(
              timeline,
              mapArtifact,
              { opacity: 0, y: 22, scale: desktop ? 0.98 : 1, rotate: desktop ? 0.7 : 0, duration: 0.65 },
              "-=0.18",
            );
          },
        });
      });

      if (desktop) {
        const mapSection = getTargets<HTMLElement>(root, "[data-map-section]");
        const mapParallax = getTargets<HTMLElement>(root, "[data-map-parallax]");

        if (mapSection.length > 0 && mapParallax.length > 0) {
          gsap.to(mapParallax, {
            y: -18,
            ease: "none",
            scrollTrigger: {
              trigger: mapSection[0],
              start: "top bottom",
              end: "bottom top",
              scrub: true,
            },
          });
        }
      }
    }, root);

    return () => context.revert();
  }, []);

  return <div ref={rootRef}>{children}</div>;
}
