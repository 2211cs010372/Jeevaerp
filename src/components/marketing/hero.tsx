"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Phone } from "lucide-react";
import { SmartImage } from "../ui/smart-image";
import { IMAGES, HOSPITAL, DEPARTMENTS } from "@/lib/data";
import { Magnetic, Parallax, Reveal, SplitLead, Stagger } from "./motion";

/**
 * The hero.
 *
 * Composed the way the reference site composes its first screen - tiles held at
 * the top of the frame, the headline and controls dropped to the foot, and the
 * middle left empty so the photograph reads as a room rather than a texture
 * behind some text.
 *
 * The palette is chapter 01's, not the reference's: porcelain ground, white
 * tiles, ink type, teal spent only on the headline and the things that are
 * actually clickable. The reference runs its first screen dark over video; this
 * building is photographed in daylight, and a hospital that opens dark is
 * making a mood where it should be making an introduction.
 *
 * Two jobs, in order of who needs them most urgently:
 *
 *   1. The emergency number is reachable in one tap, above the fold, on the
 *      smallest screen. It is the only red thing on the page.
 *   2. The brand moment: the masked word reveal, over a parallaxed photograph.
 *
 * Order matters. If the type ever costs somebody the phone number, the type
 * is wrong - which is why the controls sit above the tiles in source order on
 * a phone and the tiles are what gets pushed down, never the buttons.
 */
export function Hero() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");
  const city = HOSPITAL.locality.split(",")[0];

  return (
    <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[var(--bone)]">
      {/* ── the building ─────────────────────────────────────────── */}
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        <Parallax amount={14} className="absolute inset-0 h-[118%] -top-[9%]">
          <SmartImage
            src={IMAGES.heroBuilding}
            alt={HOSPITAL.name}
            label="Hospital"
            className="h-full w-full object-cover"
          />
        </Parallax>

        {/* porcelain from the left so the headline reads as ink, not as text
            on a photo. Lighter on desktop, where there is room for both. */}
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bone)] via-[var(--bone)]/88 to-[var(--bone)]/15 lg:via-[var(--bone)]/62 lg:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bone)] via-[var(--bone)]/25 to-transparent lg:via-transparent" />
        <div className="absolute -bottom-32 right-[6%] h-[30rem] w-[30rem] rounded-full bg-[var(--teal)]/12 blur-[130px]" />
      </div>

      <div className="shell-w flex flex-1 flex-col justify-between pb-10 pt-[118px] sm:pt-[130px] lg:pt-[164px]">
        {/* ── the tiles, held at the top of the frame ────────────── */}
        <Stagger
          each={0.1}
          y={22}
          className="flex gap-3 max-lg:order-2 max-lg:mt-12 sm:gap-4 lg:max-w-[496px]"
        >
          <Tile
            img="/images/KPI1.avif"
            badge="Care team"
            text="Every patient gets a named care plan, day or night."
          />
          <Tile
            img="/images/bed.avif"
            badge="50+ beds"
            text="Private rooms and modern equipment, built for recovery."
          />
        </Stagger>

        {/* ── the copy and the controls, at the foot ─────────────── */}
        <div className="max-lg:order-1 lg:mt-14">
          <Reveal className="flex items-center gap-3" y={12}>
            <span className="pulse" />
            <span className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
              {HOSPITAL.tagline}
            </span>
          </Reveal>

          <SplitLead
            as="h1"
            immediate
            delay={0.1}
            /* [font-family:…] spelled out: bare font-[var(--font-display)] is
               ambiguous to Tailwind and silently resolved to nothing, which
               left the largest headline on the site set in the body face. */
            className="mt-5 max-w-[16ch] [font-family:var(--font-display)] text-[clamp(2.1rem,4.4vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.035em]"
            lines={[
              { text: "Modern medicine,", className: "text-[var(--teal)]" },
              { text: "human touch.", className: "text-[var(--ink)]" },
            ]}
          />

          <div className="mt-6 flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <Reveal
              as="p"
              delay={0.45}
              y={20}
              className="max-w-[52ch] text-[14.9px] font-medium leading-[1.5] text-[var(--ink-soft)]"
            >
              Patient-first care across {DEPARTMENTS.length} specialties in {city} —
              from a routine checkup to complex trauma, built around the people we
              treat rather than the paperwork.
            </Reveal>

            <Reveal
              delay={0.55}
              y={18}
              className="flex shrink-0 flex-wrap items-center gap-3"
            >
              <Magnetic>
                <Link href="/book" className="btn btn-solid">
                  Book an appointment <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Magnetic>
              <a
                href={`tel:${emergency}`}
                className="btn border border-[var(--alert)]/35 bg-[var(--alert-soft)] text-[var(--alert)] hover:bg-[var(--alert)] hover:text-white"
              >
                <Phone className="h-4 w-4" /> Emergency 24×7
              </a>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * One proof tile: a photograph in a white cell, a badge, and a line about what
 * the photograph is. Card treatment matches chapter 01 - white on porcelain,
 * 16px corners, the value step doing the work instead of a border.
 */
function Tile({
  img,
  badge,
  text,
}: {
  img: string;
  badge: string;
  text: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-[16px] bg-[var(--paper)] p-1.5 transition-transform duration-500 ease-[var(--ease-out)] hover:-translate-y-1.5 lg:w-[236px] lg:flex-none">
      <div className="media-frame zoom-media relative aspect-square rounded-[9px] sm:aspect-[5/4] lg:aspect-square">
        <Image
          src={img}
          alt={badge}
          fill
          sizes="(max-width: 1024px) 45vw, 236px"
          className="object-cover"
        />
        <span className="absolute right-2.5 top-2.5 z-10 rounded-full bg-black/45 px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur">
          {badge}
        </span>
        <p className="absolute inset-x-3.5 bottom-3.5 z-10 text-[12px] font-medium leading-snug text-white">
          {text}
        </p>
      </div>
    </div>
  );
}
