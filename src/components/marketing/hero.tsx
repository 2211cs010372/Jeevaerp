"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Phone } from "lucide-react";
import { SmartImage } from "../ui/smart-image";
import { IMAGES, HOSPITAL, DEPARTMENTS } from "@/lib/data";

/**
 * Hero - a full-bleed photo of the hospital, framed as a rounded card that sits
 * below the navbar. A porcelain gradient off the left keeps the pine headline
 * readable over the photo; two bento cards float bottom-right on desktop and
 * stack under the copy on mobile. Pine/porcelain tokens, Bricolage display -
 * same language as the rest of the site. No external fonts, real hospital data.
 */
export function Hero() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");
  const city = HOSPITAL.locality.split(",")[0];
  const chips = [`${DEPARTMENTS.length} specialties`, `OPD ${HOSPITAL.opdHours}`, "Emergency 24×7", "In-house diagnostics"];

  return (
    <div className="relative w-full px-3 pb-3 pt-[70px] sm:px-5 sm:pb-5 bg-white sm:pt-[82px] lg:pt-[120px]">
      <style>{`
        .hero-rise { animation: hero-rise .8s cubic-bezier(.16,1,.3,1) both; }
        @keyframes hero-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .hero-rise { animation: none; } }
      `}</style>

      <section className="relative isolate flex min-h-[560px] flex-col overflow-hidden rounded-[26px] sm:min-h-[600px] sm:rounded-[32px] lg:min-h-[calc(100vh-128px)]">
        {/* photo background + legibility washes */}
        <div aria-hidden className="absolute inset-0 -z-10">
          <SmartImage src={IMAGES.heroBuilding} alt={HOSPITAL.name} label="Hospital"
            className="absolute inset-0 h-full w-full object-cover" />
          {/* porcelain from the left so the dark headline reads; lighter on desktop */}
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--paper)] via-[var(--paper)]/85 to-[var(--paper)]/10 lg:via-[var(--paper)]/60 lg:to-transparent" />
          {/* base wash on mobile so the stacked cards sit on porcelain, not photo */}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--paper)]/80 via-transparent to-transparent lg:from-transparent" />
          <div className="absolute -bottom-24 right-[4%] h-[26rem] w-[26rem] rounded-full bg-[var(--teal)]/12 blur-[110px]" />
        </div>

        {/* copy */}
        <div className="relative z-10 flex flex-1 flex-col justify-center gap-5 p-6 sm:gap-6 sm:p-10 lg:max-w-xl lg:p-14">
          <p className="hero-rise flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--teal)]" /> {HOSPITAL.tagline}
          </p>

          <h1 className="hero-rise font-semibold leading-[0.98] tracking-[-0.02em] text-[clamp(2.35rem,5.5vw+1rem,4.75rem)]"
            style={{ fontFamily: "var(--font-display)", animationDelay: ".08s" }}>
            <span className="block text-[var(--teal)]">Modern medicine,</span>
            <span className="block text-[var(--ink)]">human touch.</span>
          </h1>

          <p className="hero-rise max-w-md text-[15px] leading-relaxed text-[var(--ink-soft)] sm:text-[15.5px]" style={{ animationDelay: ".16s" }}>
            Patient-first care across {DEPARTMENTS.length} specialties in {city} - from routine
            checkups to complex trauma, built around the people we treat, not the paperwork.
          </p>

          <div className="hero-rise flex flex-wrap items-center gap-3 pt-1" style={{ animationDelay: ".24s" }}>
            <Link href="/book" className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-6 py-3.5 text-[14px] font-semibold text-white transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)]">
              Book appointment <ArrowUpRight className="h-4 w-4" />
            </Link>
            <a href={`tel:${emergency}`} className="inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-white/70 px-5 py-3.5 text-[14px] font-semibold text-[var(--ink)] backdrop-blur transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]">
              <Phone className="h-4 w-4" /> Call 24×7
            </a>
          </div>

          <div className="hero-rise flex flex-wrap gap-2 pt-1" style={{ animationDelay: ".3s" }}>
            {chips.map((t, i) => (
              <span key={t} className={`rounded-full border border-[var(--line)] bg-white/70 px-3 py-1 text-[11px] font-medium backdrop-blur ${i === 2 ? "text-[var(--alert)]" : "text-[var(--ink-soft)]"}`} style={{ fontFamily: "var(--font-mono)" }}>
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* bento cards - stacked under the copy on mobile, floated bottom-right on desktop */}
        <div className="relative z-10 flex gap-3 p-6 pt-0 sm:gap-4 sm:p-10 sm:pt-0 lg:absolute lg:bottom-12 lg:right-12 lg:p-0">
          <HeroCard img="/images/KPI1.avif" badge="Care team" text="Every patient gets a personal care plan, day or night." delay=".34s" />
          <HeroCard img="/images/bed.avif" badge="50+ beds" text="Private rooms and modern equipment, built to help you recover well." delay=".42s" />
        </div>
      </section>
    </div>
  );
}

function HeroCard({ img, badge, text, delay }: { img: string; badge: string; text: string; delay: string }) {
  return (
    <div className="hero-rise min-w-0 flex-1 rounded-[20px] border border-white/40 bg-white/60 p-1.5 shadow-[var(--shadow)] backdrop-blur-md transition-transform duration-300 hover:-translate-y-1 lg:w-[212px] lg:flex-none" style={{ animationDelay: delay }}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-[15px]">
        <Image src={img} alt={badge} fill sizes="(max-width: 1024px) 45vw, 212px" className="object-cover" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
        <span className="absolute right-2.5 top-2.5 rounded-full bg-black/45 px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur">{badge}</span>
        <p className="absolute inset-x-3 bottom-3 text-[12px] font-medium leading-snug text-white">{text}</p>
      </div>
    </div>
  );
}
