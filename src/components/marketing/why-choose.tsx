"use client";

import Link from "next/link";
import { Reveal } from "@/components/ui/reveal";
import { DeptVisual } from "@/components/marketing/dept-visual";
import { DEPARTMENTS, STATS, HOSPITAL } from "@/lib/data";
import { ArrowUpRight, Activity, Clock, FlaskConical } from "lucide-react";

export function Departments() {
  const railFacts = [
    { value: STATS[0].value, label: "Specialties", icon: Activity },
    { value: STATS[1].value, label: "Top Specialists", icon: ArrowUpRight },
    { value: "Same-day", label: "OPD Walk-ins", icon: Clock },
    { value: "In-house", label: "Diagnostics", icon: FlaskConical },
  ] as const;

  return (
    <section id="departments" className="px-4 py-16 sm:px-6 lg:py-24">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;600;700&family=Inter:wght@400;500;600&display=swap');

        .nsh-care-root {
          --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
          --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--font-body);
        }
      `}</style>
      <div className="mx-auto max-w-7xl">

        {/* ── 1. The Porcelain Shell (Header) ─────────────────────────────── */}
        <Reveal>
          <div className="relative overflow-hidden rounded-[2.5rem] bg-[var(--paper)] ring-1 ring-[var(--line)] shadow-[var(--shadow-lg)] lg:p-3">
            {/* Ambient Background Glows */}
            <div aria-hidden className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(11,84,76,0.06),transparent_70%)] blur-2xl" />

            <div className="relative flex flex-col lg:flex-row lg:items-stretch lg:gap-3">

              {/* Left: Copy & Context */}
              <div className="flex flex-1 flex-col justify-center px-8 py-10 lg:px-12 lg:py-16">
                <span className="mb-5 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--teal)] opacity-50"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--teal)]"></span>
                  </span>
                  Integrated Care
                </span>

                <h2 className="display text-[clamp(2.2rem,4vw,3.5rem)] font-bold leading-[1.05] tracking-tight text-[var(--ink)]">
                  Every specialty,<br />
                  <span className="text-[var(--teal)]">under one roof.</span>
                </h2>

                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[var(--ink-soft)]">
                  From a racing heart to a child&apos;s fever, most of a family&apos;s care lives here in {HOSPITAL.locality.split(",")[0]}. Consult, test, and collect medicines in a single visit.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Link href="/doctors" className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--teal)] px-6 text-[14px] font-semibold text-white shadow-md transition-transform hover:scale-105">
                    Explore specialists
                  </Link>
                  <a href={`tel:${HOSPITAL.emergency.replace(/\s/g, "")}`} className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--alert)]/10 px-6 text-[14px] font-bold text-[var(--alert)] transition-colors hover:bg-[var(--alert)] hover:text-white">
                    Emergency 24×7
                  </a>
                </div>
              </div>

              {/* Right: Architectural Feature & Stats */}
              <div className="relative flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-[2rem] bg-[var(--pine-ink)] lg:min-h-0">
                <img
                  src="/images/hospital_banner.jpeg"
                  alt={`Inside ${HOSPITAL.name}`}
                  className="absolute inset-0 h-full w-full object-cover opacity-60 mix-blend-overlay saturate-50 transition-transform duration-1000 hover:scale-105"
                />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[var(--pine-ink)] via-transparent to-transparent opacity-90" />

                <div className="relative mt-auto p-6 sm:p-8">
                  {/* Inline Stat Rail integrated directly into the image panel */}
                  <div className="grid grid-cols-2 gap-4 rounded-2xl bg-white/10 p-5 backdrop-blur-md ring-1 ring-white/20 sm:grid-cols-4 sm:gap-2">
                    {railFacts.map((stat, idx) => {
                      const Icon = stat.icon;
                      return (
                        <div key={idx} className="flex flex-col items-center text-center sm:items-start sm:text-left">
                          <Icon className="mb-2 h-5 w-5 text-[var(--teal-tint)] opacity-80" />
                          <span className="font-serif-p text-[18px] font-bold tracking-tight text-white">{stat.value}</span>
                          <span className="mt-0.5 text-[11px] font-medium text-white/70">{stat.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </Reveal>

        {/* ── 2. The Compact Directory Grid ───────────────────────────────── */}
        <div className="mt-6 grid grid-cols-1 gap-3 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {DEPARTMENTS.map((d, i) => (
            <Reveal key={d.name} delay={Math.min(i * 30, 250)}>
              <Link
                href={`/book?dept=${encodeURIComponent(d.name)}`}
                className="group relative flex h-[240px] w-full flex-col justify-end overflow-hidden rounded-[1.25rem] bg-[var(--pine-ink)] shadow-sm ring-1 ring-[var(--line)] transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-[var(--teal)]/40"
              >
                {/* Background Image & Shaders */}
                <DeptVisual
                  name={d.name}
                  src={d.image}
                  className="absolute inset-0 h-full w-full object-cover opacity-50 transition-all duration-[800ms] ease-out group-hover:scale-110 group-hover:opacity-70"
                />
                <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 group-hover:opacity-80" />

                {/* Content */}
                <div className="relative z-10 flex w-full items-end justify-between p-4">
                  <div>
                    <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.15em] text-[var(--teal-tint)]" style={{ fontFamily: "var(--font-mono)" }}>
                      {d.common}
                    </span>
                    <h3 className="text-[16px] font-semibold leading-tight text-white tracking-tight">
                      {d.name}
                    </h3>
                  </div>

                  {/* Micro Action Button */}
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-all duration-300 group-hover:bg-[var(--teal)] group-hover:text-white">
                    <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-[1px] group-hover:-translate-y-[1px]" />
                  </div>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>

      </div>
    </section>
  );
}