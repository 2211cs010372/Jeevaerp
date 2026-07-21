"use client";

import React from "react";
import { Reveal, CountUp } from "@/components/ui/reveal";
import { WARDS, DEPARTMENTS } from "@/lib/data";

/**
 * North Star Health — Numbers Band Component
 * ------------------------------------------------------------------
 * High-impact statistics banner featuring warm #f0eee9 framing, deep
 * #14181C midnight background, glassmorphic dividers, and dynamic counters.
 */
export function NumbersBand() {
  const beds = WARDS.reduce((s, w) => s + w.beds, 0);
  const icu = WARDS.find((w) => w.name === "ICU")?.beds ?? 0;

  const FIGURES: { value: React.ReactNode; label: string; sub: string; badge?: string }[] = [
    {
      value: <CountUp to={beds} />,
      label: "Inpatient Beds",
      sub: "Across four ward classes",
      badge: "Total Capacity",
    },
    {
      value: <CountUp to={icu} />,
      label: "ICU Units",
      sub: "Continuously monitored",
      badge: "Critical Care",
    },
    {
      value: <CountUp to={DEPARTMENTS.length} />,
      label: "Specialties",
      sub: "Active clinical departments",
      badge: "Outpatient & Inpatient",
    },
    {
      value: <>24×7</>,
      label: "Emergency Care",
      sub: "Uninterrupted trauma intake",
      badge: "Always Open",
    },
  ];

  return (
    <section className="nsh-numbers-root w-full bg-[#FFFFFF] px-3 py-8 sm:px-6 lg:px-8 lg:py-12">
      {/* Global CSS for Theme Typography */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;600;700&family=Inter:wght@400;500;600&display=swap');

        .nsh-numbers-root {
          --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
          --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--font-body);
        }
      `}</style>

      <Reveal className="mx-auto max-w-7xl">
        <div className="relative overflow-hidden rounded-[2rem] bg-[#f0eee9] p-2 ring-1 ring-black/5 shadow-sm">
          <div className="relative overflow-hidden rounded-[1.6rem] bg-[#14181C] px-6 py-10 sm:px-10 lg:px-12 lg:py-14">
            
            {/* Subtle Gradient Glow Backdrop */}
            <div
              aria-hidden
              className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-[#274472]/30 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-[#274472]/20 blur-3xl"
            />

            {/* Metrics Grid */}
            <div className="relative z-10 grid grid-cols-1 gap-y-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-y-0">
              {FIGURES.map((f, i) => (
                <div
                  key={f.label}
                  className={`flex flex-col items-center text-center px-4 ${
                    i !== 0 ? "lg:border-l lg:border-white/10" : ""
                  }`}
                >
                  {/* Category Pill Tag */}
                  <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-white/80 backdrop-blur-md ring-1 ring-white/15">
                    {i === 3 && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    )}
                    {f.badge}
                  </span>

                  {/* Big Counter Value */}
                  <div className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
                    {f.value}
                  </div>

                  {/* Label & Subtitle */}
                  <h3 className="mt-2 font-[family-name:var(--font-display)] text-base font-semibold text-white">
                    {f.label}
                  </h3>
                  <p className="mt-1 text-xs text-white/60 max-w-[180px]">
                    {f.sub}
                  </p>
                </div>
              ))}
            </div>

          </div>
        </div>
      </Reveal>
    </section>
  );
}