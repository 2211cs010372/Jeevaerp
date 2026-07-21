"use client";

import React from "react";
import { Reveal, CountUp } from "@/components/ui/reveal";
import { WARDS } from "@/lib/data";

/**
 * North Star Health — Facilities Component
 * ------------------------------------------------------------------
 * Bento-style layout matching the North Star Health aesthetic:
 * warm #f0eee9 framing, #14181C dark accents, glassmorphic white cards, 
 * and #274472 navy branding.
 */
const stroke = { 
  fill: "none" as const, 
  stroke: "currentColor", 
  strokeWidth: 1.7, 
  strokeLinecap: "round" as const, 
  strokeLinejoin: "round" as const 
};

function totalBeds() {
  return WARDS.reduce((s, w) => s + w.beds, 0);
}

const FACILITIES = [
  {
    tag: "01 // DIAGNOSTICS",
    title: "In-house laboratory",
    text: "Routine blood work in about 30 minutes — reports land on your record and your phone, and stay there for every future visit.",
    icon: <g {...stroke}><path d="M9 3h6M10 3v6.3L4.8 18a2.4 2.4 0 0 0 2.1 3.6h10.2a2.4 2.4 0 0 0 2.1-3.6L14 9.3V3" /><path d="M7.5 15h9" /></g>,
    featured: false,
  },
  {
    tag: "02 // IMAGING",
    title: "Digital X-ray & imaging",
    text: "On-site X-ray for fractures and spine, imaging support for neurology — scans are read with your full history in view.",
    icon: <g {...stroke}><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M12 6v12M8.5 9h7M9.5 12h5M10.5 15h3" /></g>,
    featured: false,
  },
  {
    tag: "03 // CARDIOLOGY",
    title: "ECG · 2D Echo · TMT",
    text: "Cardiac work-ups the same day — chest pain and rhythm complaints are assessed without a referral across town.",
    icon: <g {...stroke}><path d="M3 12h4l2-4 3.5 8 2.5-5 1.5 1h4.5" /></g>,
    featured: false,
  },
  {
    tag: "04 // PHARMACY",
    title: "In-house pharmacy",
    text: "Batch-tracked stock with automatic expiry checks, dispensed against your Jeeva ID with a printed GST bill.",
    icon: <g {...stroke}><rect x="3" y="8" width="18" height="13" rx="2.5" /><path d="M8 8V6a4 4 0 0 1 8 0v2M12 11.5v5M9.5 14h5" /></g>,
    featured: false,
  },
  {
    tag: "05 // EMERGENCY",
    title: "24×7 emergency",
    text: "A doctor on duty around the clock, every day of the year — walk straight in, no booking, no front-desk queue.",
    icon: <g {...stroke}><path d="M12 3l8 4v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V7l8-4Z" /><path d="M12 8.5v6M9 11.5h6" /></g>,
    featured: false,
  },
  {
    tag: "06 // INPATIENT",
    title: "Inpatient wards & ICU",
    text: "General, semi-private and private rooms plus a monitored ICU — with attendant arrangements and published day rates.",
    bedsCount: totalBeds(),
    icon: <g {...stroke}><path d="M3 18V8a2 2 0 0 1 2-2h6v8h10a0 0 0 0 1 0 0v4" /><path d="M11 10h7a3 3 0 0 1 3 3" /><path d="M3 18h18M3 21v-3M21 21v-3" /><circle cx="7" cy="10" r="1.6" /></g>,
    featured: true, // Midnight Navy highlight card
  },
];

export function Facilities() {
  return (
    <section id="facilities" className="nsh-facilities-root w-full bg-[#FFFFFF] px-3 py-10 sm:px-6 lg:px-8 lg:py-14">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;600;700&family=Inter:wght@400;500;600&display=swap');

        .nsh-facilities-root {
          --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
          --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--font-body);
        }
      `}</style>

      <div className="mx-auto max-w-7xl">
        
        {/* Section Header */}
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end mb-10">
          <Reveal>
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#274472]/10 px-3 py-1 text-[11px] font-semibold text-[#274472] ring-1 ring-[#274472]/20">
                <span className="h-1.5 w-1.5 rounded-full bg-[#274472] animate-pulse" />
                FACILITIES &amp; TECHNOLOGY
              </div>
              <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-[#14181C] sm:text-4xl lg:text-5xl leading-[1.08] max-w-xl">
                Everything under one roof, on purpose
              </h2>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <p className="max-w-sm text-xs sm:text-sm leading-relaxed text-[#14181C]/70">
              The point of a multispeciality building is that the test, the scan and
              the medicine are a corridor away — not another trip across town.
            </p>
          </Reveal>
        </div>

        {/* Facilities Bento Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FACILITIES.map((f, i) => (
            <Reveal key={f.title} delay={Math.min(i * 50, 300)}>
              {f.featured ? (
                /* Featured Midnight Navy Card */
                <div className="group relative flex h-full min-h-[280px] flex-col justify-between overflow-hidden rounded-[1.75rem] bg-[#14181C] p-7 text-white ring-1 ring-black/10 transition-transform duration-300 hover:-translate-y-1 hover:shadow-xl">
                  {/* Soft Ambient Radial Glow */}
                  <div 
                    className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[#274472]/40 blur-2xl" 
                    aria-hidden 
                  />

                  {/* Header Row */}
                  <div className="relative z-10 flex items-start justify-between">
                    <span className="inline-flex items-center justify-center rounded-2xl bg-white/10 p-3 text-white shadow-sm ring-1 ring-white/15 backdrop-blur-md">
                      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>{f.icon}</svg>
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-white/60 ring-1 ring-white/20 rounded-full px-2.5 py-0.5 bg-white/5">
                      {f.tag}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="relative z-10 mt-6">
                    <div className="flex items-baseline gap-2">
                      <h3 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-white leading-snug">
                        {f.title}
                      </h3>
                      {f.bedsCount && (
                        <span className="font-[family-name:var(--font-display)] text-xl font-semibold text-[#274472]">
                          · <CountUp to={f.bedsCount} /> beds
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-white/75">
                      {f.text}
                    </p>
                  </div>
                </div>
              ) : (
                /* Soft Beige Canvas + Glassmorphic Card */
                <div className="group relative h-full overflow-hidden rounded-[1.75rem] bg-[#f0eee9] p-1.5 ring-1 ring-black/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <div className="flex h-full flex-col justify-between rounded-[1.35rem] bg-white/80 p-6 backdrop-blur-md">
                    
                    {/* Top Row Icon + Tag Badge */}
                    <div className="flex items-start justify-between">
                      <span className="inline-flex items-center justify-center rounded-2xl bg-[#f0eee9] p-3 text-[#274472] shadow-sm ring-1 ring-black/5">
                        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>{f.icon}</svg>
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[#14181C]/50 ring-1 ring-black/10 rounded-full px-2.5 py-0.5 bg-black/[0.02]">
                        {f.tag}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="mt-6">
                      <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-[#14181C] leading-snug">
                        {f.title}
                      </h3>
                      <p className="mt-2 text-xs leading-relaxed text-[#14181C]/70">
                        {f.text}
                      </p>
                    </div>

                  </div>
                </div>
              )}
            </Reveal>
          ))}
        </div>

      </div>
    </section>
  );
}