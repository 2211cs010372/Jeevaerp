"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { IMAGES, HOSPITAL, DEPARTMENTS } from "@/lib/data";
import { Reveal, SplitLead } from "./motion";

/**
 * The hero - a full screen of plain white in three bands.
 *
 *   top      the headline, top-left; the hospital's name and town top-right
 *   middle   the building, as large as the space between allows
 *   bottom   the small type in narrow columns - a label, a two-line aside,
 *            a short paragraph with two quiet ghost buttons
 *
 * Nothing is bold, nothing is overlaid, nothing is ruled: white page, ink
 * type, building. Instrument Serif for the headline, Montserrat for the rest
 * (set once on the <section>). Both are loaded in app/layout.tsx.
 *
 * THE BUILDING SIZES TO THE GAP, NOT TO THE WIDTH. It sits in the flow between
 * headline and paragraph and fills whatever height is left (object-contain,
 * anchored to the bottom), so on any screen it is as big as it can be without
 * running under the words - which a building pinned to the bottom of the
 * screen did, straight through the paragraph, once the paragraph moved down.
 *
 * THE BUILDING IS A CUT-OUT, NOT A PHOTOGRAPH. The hospital's own render with
 * its sky removed (see IMAGES.heroBuilding), so it stands on the white page.
 *
 * EDGES ARE 1.5REM, everywhere. The header row uses the same inset, so the
 * wordmark and the headline hang off one line.
 *
 * The emergency number stays one tap away on the first screen - it is the
 * second button, not a buried link.
 */
export function Hero() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");
  const city = HOSPITAL.locality.split(",")[0];

  return (
    <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-white px-[1.5rem] pb-[1.5rem] pt-[calc(var(--nav-h)+1.5rem)] [font-family:var(--font-montserrat)]">
      {/* ── top - the headline, and where we are ─────────────────────── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <SplitLead
          as="h1"
          immediate
          delay={0.15}
          /* [font-family:…] spelled out: bare font-[var(--…)] is ambiguous to
             Tailwind and silently resolves to nothing. Instrument Serif has
             one weight, so font-normal - asking for 500 would make the
             browser smear a fake one. */
          className="[font-family:var(--font-instrument-serif)] text-[clamp(3.1rem,6.6vw,3.6rem)] font-normal leading-[0.92] tracking-[-0.025em] text-[var(--ink)]"
          lines={[{ text: "Expert Doctors" }, { text: "Proven Outcomes." }, { text: "Trusted Care." }]}
        />

        <Reveal y={10} delay={0.3} className="shrink-0 text-[12px] font-medium leading-[1.5] text-[var(--muted)] md:pt-2 md:text-right">
          {HOSPITAL.shortName} Multispeciality Hospital
          <br />
          {HOSPITAL.locality}
        </Reveal>
      </div>

      {/* ── middle - the building, filling the gap ──────────────────── */}
      <Reveal y={28} delay={0.3} start="top bottom" className="relative my-6 min-h-[240px] flex-1 md:min-h-[420px] lg:min-h-[450px] ">
        <Image
          src={IMAGES.heroBuilding}
          alt={`${HOSPITAL.name}, ${HOSPITAL.locality}`}
          fill
          priority
          sizes="(min-width: 1024px) 70vw, 110vw"
          className="object-contain object-bottom"
        />
      </Reveal>

      {/* ── bottom - three narrow columns, pinned to the edges ──────── */}
      <div className="relative z-10 grid grid-cols-2 items-end gap-x-6 gap-y-5 md:grid-cols-12">
        <Reveal y={10} start="top bottom" className="text-[12.5px] font-medium tracking-[-0.005em] text-[var(--muted)] md:col-span-3">
          Our promise
        </Reveal>

        <Reveal y={10} delay={0.08} start="top bottom" className="text-[12.5px] font-medium leading-[1.4] tracking-[-0.005em] text-[var(--muted)] md:col-span-3">
          Modern medicine.
          <br />
          Human touch.
        </Reveal>

        <Reveal y={14} delay={0.16} start="top bottom" className="col-span-2 md:col-span-5 md:col-start-8 lg:col-span-4 lg:col-start-10">
          <p className="max-w-[36ch] text-[14px] font-medium leading-[1.15] tracking-[-0.005em] text-[var(--ink)]">
            Patient-first care across {DEPARTMENTS.length} specialities in {city}. A routine
            check-up or a 2 a.m. emergency - one record, named doctors, and the same
            people from the first visit to the last.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/book" className="btn-ghost-sm">
              Book an appointment <ArrowUpRight size={14} />
            </Link>
            <a href={`tel:${emergency}`} className="btn-ghost-sm">
              <span className="pulse pulse-alert" aria-hidden /> Emergency 24×7
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
