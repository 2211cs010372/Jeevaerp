"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Phone } from "lucide-react";
import { SmartImage } from "../ui/smart-image";
import { IMAGES, HOSPITAL, DEPARTMENTS, DOCTORS } from "@/lib/data";
import { Magnetic, Parallax, Reveal, SplitLead } from "./motion";

/**
 * The hero.
 *
 * Full-bleed rather than the framed card of v5: an award-shortlist page opens
 * by taking the whole screen, and a hospital gets to do that honestly because
 * the photograph is of the actual building a family is trying to find.
 *
 * Three jobs, in order of who needs them most urgently:
 *
 *   1. The emergency number is reachable in one tap, above the fold, on the
 *      smallest screen. It is the only red thing on the page.
 *   2. "Can I be seen, where are you, who will I see" - answered by the
 *      instrument rail across the foot of the hero, in mono, as data.
 *   3. The brand moment: a display headline at 8rem with a masked word
 *      reveal, over a parallaxed photograph.
 *
 * Order matters. If the type ever costs somebody the phone number, the type
 * is wrong.
 */
export function Hero() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");
  const city = HOSPITAL.locality.split(",")[0];

  return (
    <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[var(--paper)] pt-[118px] sm:pt-[130px] lg:pt-[164px]">
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
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--paper)] via-[var(--paper)]/88 to-[var(--paper)]/15 lg:via-[var(--paper)]/62 lg:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--paper)] via-[var(--paper)]/25 to-transparent lg:via-transparent" />
        <div className="absolute -bottom-32 right-[6%] h-[30rem] w-[30rem] rounded-full bg-[var(--teal)]/12 blur-[130px]" />
      </div>

      {/* ── copy ─────────────────────────────────────────────────────
          The headline takes the full container width rather than sharing a
          row with the tiles. At 8vw it is the largest thing on the site, and
          boxing it into two-thirds of the grid forces it to wrap mid-phrase -
          which is the difference between a display headline and a paragraph
          set in a big font. ─────────────────────────────────────────────── */}
      <div className="shell-w flex flex-1 flex-col justify-center py-8 sm:py-9">
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
          className="display-mega mt-5 sm:mt-7"
          lines={[
            { text: "Modern medicine,", className: "text-[var(--teal)]" },
            { text: "human touch.", className: "text-[var(--ink)]" },
          ]}
        />

        <div className="mt-9 grid gap-9 sm:mt-11 lg:grid-cols-12 lg:items-end lg:gap-8">
          <div className="lg:col-span-6 xl:col-span-5">
            <Reveal as="p" delay={0.45} y={20} className="lede text-[var(--ink-soft)]">
              Patient-first care across {DEPARTMENTS.length} specialties in {city} —
              from a routine checkup to complex trauma, built around the people we
              treat rather than the paperwork.
            </Reveal>

            <Reveal delay={0.55} y={18} className="mt-7 flex flex-wrap items-center gap-3">
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

          {/* the two proof tiles - under the copy on mobile,
              docked bottom-right on desktop */}
          <div className="flex gap-3 sm:gap-4 lg:col-span-6 lg:justify-end xl:col-span-7">
            <Tile
              img="/images/KPI1.avif"
              badge="Care team"
              text="Every patient gets a named care plan, day or night."
              delay={0.62}
            />
            <Tile
              img="/images/bed.avif"
              badge="50+ beds"
              text="Private rooms and modern equipment, built for recovery."
              delay={0.7}
            />
          </div>
        </div>
      </div>

      {/* ── the instrument rail ──────────────────────────────────── */}
      <Reveal delay={0.8} y={16} className="relative z-10 border-t border-[var(--line-strong)]/70 bg-[var(--paper)]/72 backdrop-blur-md">
        <div className="shell-w">
          <dl className="grid grid-cols-2 divide-x divide-[var(--line)] sm:grid-cols-4 lg:grid-cols-5">
            <RailCell label="Scroll" className="hidden lg:flex">
              <span className="flex items-center gap-3">
                <span className="scroll-cue" />
                <span className="text-[13px] font-medium text-[var(--ink)]">
                  Read on
                </span>
              </span>
            </RailCell>
            <RailCell label="OPD hours">{HOSPITAL.opdHours}</RailCell>
            <RailCell label="Emergency" tone="alert">
              <a href={`tel:${emergency}`} className="hover:underline">
                {HOSPITAL.emergency}
              </a>
            </RailCell>
            <RailCell label="Consultants">
              {DOCTORS.length}+ across {DEPARTMENTS.length} depts
            </RailCell>
            <RailCell label="Where" className="hidden sm:flex">
              {HOSPITAL.locality}
            </RailCell>
          </dl>
        </div>
      </Reveal>
    </section>
  );
}

/** One cell of the instrument rail: a mono label over a hard fact. */
function RailCell({
  label,
  children,
  tone,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  tone?: "alert";
  className?: string;
}) {
  return (
    <div className={`flex flex-col justify-center gap-1.5 px-4 py-4 first:pl-0 sm:px-6 sm:py-5 ${className}`}>
      <dt className="mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={`mono text-[12.5px] leading-tight ${
          tone === "alert" ? "font-semibold text-[var(--alert)]" : "text-[var(--ink)]"
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

function Tile({
  img,
  badge,
  text,
  delay,
}: {
  img: string;
  badge: string;
  text: string;
  delay: number;
}) {
  return (
    <Reveal
      delay={delay}
      y={26}
      className="min-w-0 flex-1 rounded-[22px] border border-white/50 bg-white/55 p-1.5 shadow-[var(--shadow)] backdrop-blur-md transition-transform duration-500 hover:-translate-y-1.5 lg:w-[212px] lg:flex-none xl:w-[236px]"
    >
      <div className="media-frame zoom-media relative aspect-square rounded-[16px] sm:aspect-[5/4] lg:aspect-square">
        <Image
          src={img}
          alt={badge}
          fill
          sizes="(max-width: 1024px) 45vw, 218px"
          className="object-cover"
        />
        <span className="absolute right-2.5 top-2.5 z-10 rounded-full bg-black/45 px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur">
          {badge}
        </span>
        <p className="absolute inset-x-3.5 bottom-3.5 z-10 text-[12px] font-medium leading-snug text-white">
          {text}
        </p>
      </div>
    </Reveal>
  );
}
