"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Smooth scrolling - PUBLIC SITE ONLY.
 *
 * Lenis gives the page the weighted, cinematic scroll the reference sites have.
 * It is deliberately not mounted in the working portals: a receptionist tabbing
 * through forms and tables needs the scrollbar to behave like an instrument,
 * not an experience.
 *
 * This component also owns the marriage between Lenis and GSAP ScrollTrigger.
 * Lenis moves the page with a transform-free virtual scroll, so ScrollTrigger
 * has to be told when that happens (`lenis.on("scroll", ScrollTrigger.update)`)
 * and both have to run off a single RAF loop, or the pinned rail judders one
 * frame behind the content it is pinning.
 *
 * Three non-negotiables:
 *  - prefers-reduced-motion users get native scrolling, full stop. No Lenis,
 *    no progress bar animation, and every motion primitive no-ops to its
 *    final state.
 *  - anchor links (#departments, #faq…) route through Lenis so the nav glides
 *    instead of jumping, with an offset for the fixed header.
 *  - ScrollTrigger is refreshed after fonts load. Bricolage arriving late
 *    reflows every headline, and a rail pinned against stale measurements
 *    ends mid-card.
 */

gsap.registerPlugin(ScrollTrigger);

export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({
      duration: 0.9,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // easeOutExpo
      touchMultiplier: 1.6,
    });

    lenis.on("scroll", ScrollTrigger.update);

    // One clock for both libraries. gsap.ticker is already running for the
    // tweens, so Lenis rides it rather than opening a second RAF loop.
    const drive = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(drive);
    gsap.ticker.lagSmoothing(0);

    // Late-loading webfonts change every measured height on the page.
    let fontsDone = false;
    document.fonts?.ready.then(() => {
      fontsDone = true;
      ScrollTrigger.refresh();
    });
    const settle = window.setTimeout(() => {
      if (!fontsDone) ScrollTrigger.refresh();
    }, 1200);

    // glide to in-page anchors instead of jumping
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href*="#"]');
      if (!a) return;
      const url = new URL(a.href, window.location.href);
      if (url.pathname !== window.location.pathname || !url.hash) return;
      const el = document.querySelector<HTMLElement>(url.hash);
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el, { offset: -96 }); // clear the fixed navbar
      history.pushState(null, "", url.hash);
    };
    document.addEventListener("click", onClick);

    return () => {
      window.clearTimeout(settle);
      document.removeEventListener("click", onClick);
      gsap.ticker.remove(drive);
      lenis.destroy();
    };
  }, []);

  return null;
}

/**
 * The hairline that fills across the top of the page as you read.
 *
 * Deliberately 2px and pine: it is a wayfinding cue on a long page, not a
 * decoration. Driven by ScrollTrigger rather than a scroll listener so it
 * shares the same clock as everything else and can't tear.
 */
export function ScrollProgress() {
  useEffect(() => {
    const bar = document.getElementById("scroll-progress");
    if (!bar) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const onScroll = () => {
        const max = document.body.scrollHeight - window.innerHeight;
        bar.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }

    const st = ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: (self) => {
        bar.style.transform = `scaleX(${self.progress})`;
      },
    });
    return () => st.kill();
  }, []);

  return (
    <div className="scroll-progress-track" aria-hidden>
      <span id="scroll-progress" className="scroll-progress-bar" />
    </div>
  );
}
