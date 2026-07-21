"use client";

import { ArrowUpRight, HeartHandshake, BedDouble } from "lucide-react";
import Image from "next/image";
import { SmartImage } from "../ui/smart-image";
import { IMAGES } from "@/lib/data";

/**
 * North Star Health — Hero (photo-hero variant, no nav)
 * ------------------------------------------------------------------
 * Full-bleed "glass tower" hero: soft sky-to-glass gradient +
 * a fine diagonal mullion texture stand in for architectural
 * photography, framed with an inset margin and rounded corners.
 * Two floating bento cards (bottom-right on desktop, inline on
 * mobile) carry a photo-placeholder + label + caption, the way
 * the reference screenshot does.
 *
 * SWAP IN REAL PHOTOGRAPHY
 * -------------------------------------------------------------
 * 1) Hero background: replace the two gradient <div>s inside
 *    the element with `id="hero-bg"` with an <img> (or Next.js
 *    <Image fill />) of your building/campus, object-cover.
 * 2) Card thumbnails: replace the two `aspect-[4/3]` gradient
 *    blocks (currently holding a lucide icon each) with real
 *    patient/facility photos the same way.
 *
 * Setup
 * -----
 * 1) Dependency:   npm i lucide-react
 * 2) Fonts (preferred — add to your <head> / root layout):
 *
 *    <link rel="preconnect" href="https://fonts.googleapis.com" />
 *    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
 *    <link
 *      href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Inter:wght@400;500;600;700&display=swap"
 *      rel="stylesheet"
 *    />
 *
 *    A runtime @import fallback is included below so it still looks
 *    right if you skip step 2 — the <link> method is just faster.
 *
 * 3) Tailwind CSS is assumed to be configured in the host project.
 *    All colors are passed as arbitrary hex values, no config edits needed.
 */

export function Hero() {
  return (
    <div className="nsh-root min-h-screen w-full bg-[#ffffff] p-3 sm:p-6 lg:p-5">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Inter:wght@400;500;600;700&display=swap');

        .nsh-root {
          --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
          --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--font-body);
        }

        .nsh-rise {
          animation: nsh-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes nsh-rise {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nsh-rise { animation: none; }
        }
      `}</style>

      <section className="relative isolate flex min-h-[calc(100vh-1.5rem)] sm:min-h-[calc(100vh-3rem)] lg:min-h-[calc(100vh-0.5rem)] flex-col overflow-hidden rounded-[1.75rem] lg:mt-5 sm:rounded-[1.5rem]">
        {/* Background — swap for a real photo, see comment at top of file */}
        <div id="hero-bg" aria-hidden  className="absolute inset-0 -z-10">
          <SmartImage
            src={IMAGES.heroBuilding}
            alt="Hospital Building"
            label="Hero Image"
            className="absolute inset-0 h-full w-full object-cover brightness-70 contrast-105 saturate-85" />
          <div className="absolute -top-24 right-[-8%] h-[32rem] w-[32rem] rounded-full bg-white/50 blur-[110px]" />
          <div className="absolute bottom-[-15%] right-[6%] h-[26rem] w-[26rem] rounded-full bg-[#274472]/10 blur-[100px]" />
        </div>

        {/* Text content */}
        <div className="relative z-10 flex flex-col gap-5 sm:gap-6 p-6 sm:p-10 lg:max-w-xl lg:flex-1 lg:justify-center lg:p-14">
          <p className="nsh-rise flex items-center gap-2 text-[13px] sm:text-sm font-medium tracking-wide text-[#14181C]/70">
            <span className="h-1.5 w-1.5 rounded-full bg-[#274472]" />
            Compassionate care, close to home
          </p>

          <h1
            className="nsh-rise font-[family-name:var(--font-display)] font-semibold text-[clamp(2.5rem,6vw+1rem,5.25rem)] leading-[0.98] tracking-[-0.02em]"
            style={{ animationDelay: "0.08s" }}
          >
            <span className="block text-[#274472]">Modern medicine,</span>
            <span className="block text-[#14181C]">human touch.</span>
          </h1>

          <p
            className="nsh-rise max-w-md text-[15px] sm:text-base leading-relaxed text-[#14181C]/75"
            style={{ animationDelay: "0.16s" }}
          >
            Patient-first care across 40 specialties — from routine
            checkups to complex trauma, built around the people we
            treat, not the paperwork.
          </p>

          <div
            className="nsh-rise flex flex-wrap items-center gap-3 pt-1"
            style={{ animationDelay: "0.24s" }}
          >
            <a
              href="#visit"
              className="inline-flex items-center rounded-full bg-[#14181C] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[#274472] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#274472]"
            >
              Visit us today
            </a>
            <a
              href="#visit"
              aria-label="Visit us today"
              className="group inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#14181C] ring-1 ring-black/10 transition hover:bg-[#14181C] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#274472]"
            >
              <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
            <a
              href="tel:+15550192273"
              className="ml-1 text-[13px] font-semibold text-[#14181C]/70 underline decoration-[#14181C]/30 underline-offset-4 transition hover:text-[#14181C] hover:decoration-[#14181C]"
            >
              or call our 24/7 line
            </a>
          </div>
        </div>

        {/* Bento cards — inline on mobile, floated bottom-right on desktop */}
        <div className="relative z-10 flex gap-4 px-6 pb-6 sm:gap-5 sm:px-10 sm:pb-10 lg:absolute lg:bottom-14 lg:right-14 lg:px-0 lg:pb-0">
          {/* Card 1 */}
          <div
            className="nsh-rise flex-1  lg:w-[216px] lg:flex-none rounded-[1.35rem] bg-[#f0eee9] p-1.5 backdrop-blur-sm transition hover:from-white/90 hover:to-[#274472]/50"
            style={{ animationDelay: "0.32s" }}
          >
            <div className="h-full overflow-hidden relative rounded-[1.1rem] bg-[#F3F4F1] shadow-[0_8px_30px_-12px_rgba(20,24,28,0.35)]">
              <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden bg-gradient-to-br from-[#DCE7F0] to-[#B9CEDE]">
                <Image src="/images/KPI1.avif" alt="KPI-1" className="w-full h-full object-cover object-center" fill />
                <span className="absolute right-2.5 top-2.5 rounded-full bg-[#14181C]/70 px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur">
                  Care team
                </span>
              </div>
              <div className="p-1.5 absolute bottom-0  bg-transparent ">
                <p className="text-[12.5px] leading-snug bg-white/10 backdrop-blur-md p-3 font-semibold rounded-2xl text-[#252525]">
                  Every patient gets a personal care plan, day or night.
                </p>
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div
            className="nsh-rise flex-1 w-[190px] lg:w-[216px] lg:flex-none rounded-[1.35rem] bg-[#f0eee9] p-1.5 backdrop-blur-sm transition hover:from-white/90 hover:to-[#274472]/50"
            style={{ animationDelay: "0.4s" }}
          >
            <div className="h-full overflow-hidden rounded-[1.1rem] relative  shadow-[0_8px_30px_-12px_rgba(20,24,28,0.35)]">
              <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden bg-gradient-to-br from-[#DCE7F0] to-[#B9CEDE]">
                <Image src="/images/bed.avif" alt="KPI-1" className="w-full h-full object-cover object-center" fill />
                <span className="absolute right-2.5 top-2.5 rounded-full bg-[#14181C]/70 px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur">
                  50+ beds
                </span>
              </div>
              <div className=" absolute w-full p-1.5 bottom-0 ">
                <p className="text-[12.5px] backdrop-blur bg-white/5 p-3 rounded-2xl font-semibold leading-snug text-[#14181C]/75">
                  Private rooms and modern equipment, built to help
                  you recover well.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}