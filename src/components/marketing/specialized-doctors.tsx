"use client";

import React from "react";
import Link from "next/link";
import { Reveal } from "@/components/ui/reveal";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { DOCTORS } from "@/lib/data";
import { ArrowUpRight, Clock, Star, Calendar } from "lucide-react";

/**
 * North Star Health - Specialized Doctors Component
 * ------------------------------------------------------------------
 * Glassmorphic doctor cards with warm #f0eee9 framing, deep #14181C accents,
 * and #274472 navy highlights displaying rich clinical data points.
 */
export function SpecializedDoctors() {
  const featured = DOCTORS.slice(0, 8);

  return (
    <section id="doctors" className="nsh-doctors-root w-full bg-[#FFFFFF] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      {/* Global CSS for Theme Typography */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;600;700&family=Inter:wght@400;500;600&display=swap');

        .nsh-doctors-root {
          --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
          --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--font-body);
        }
      `}</style>

      <div className="mx-auto max-w-7xl">
        
        {/* Section Header */}
        <div className="mx-auto max-w-2xl text-center">
          <Reveal>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#274472]/10 px-3.5 py-1 text-xs font-semibold text-[#274472] ring-1 ring-[#274472]/20">
              <span className="h-2 w-2 rounded-full bg-[#274472] animate-pulse" />
              SPECIALIZED CLINICAL TEAM
            </div>
          </Reveal>

          <Reveal delay={60}>
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-[#14181C] sm:text-4xl lg:text-5xl leading-[1.12]">
              People who care for your family.
            </h2>
          </Reveal>

          <Reveal delay={120}>
            <p className="mt-4 text-xs sm:text-sm leading-relaxed text-[#14181C]/75">
              Our specialists combine decades of clinical excellence with genuine empathy. Dedicated physicians, surgeons, and care teams working together under one roof.
            </p>
          </Reveal>
        </div>

        {/* Doctors Grid */}
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((d, i) => (
            <Reveal key={d.id} delay={Math.min(i * 40, 280)}>
              <Link
                href={`/book?doctor=${d.id}`}
                className="group relative block overflow-hidden rounded-[1.75rem] bg-[#f0eee9] p-1.5 ring-1 ring-black/5 transition-all duration-300 hover:-translate-y-1 hover:ring-black/15 hover:shadow-xl"
              >
                <div className="relative flex flex-col justify-between overflow-hidden rounded-[1.35rem] bg-white p-3">
                  
                  {/* Doctor Image Container */}
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-[#f0eee9] ring-1 ring-black/5">
                    <DoctorAvatar
                      name={d.name}
                      image={d.image}
                      className="h-full w-full object-cover text-3xl transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                    
                    {/* Gradient Overlay */}
                    <div
                      aria-hidden
                      className="absolute inset-0 bg-gradient-to-t from-[#14181C]/90 via-[#14181C]/25 to-transparent"
                    />

                    {/* Top Badges */}
                    <div className="absolute left-3 top-3 right-3 flex items-center justify-between z-10">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#14181C]/80 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-md ring-1 ring-white/20">
                        <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                        {d.experience} yrs exp
                      </span>

                      {/* Hover Arrow Trigger */}
                      <span
                        aria-hidden
                        className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-[#14181C] backdrop-blur-md transition-all duration-300 group-hover:bg-[#274472] group-hover:text-white group-hover:scale-110 shadow-sm"
                      >
                        <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </span>
                    </div>

                    {/* Bottom Image Details (Overlay Content) */}
                    <div className="absolute inset-x-3.5 bottom-3.5 z-10 text-white">
                      <div className="inline-block rounded-md bg-[#274472]/80 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md ring-1 ring-white/15">
                        {d.department}
                      </div>
                      <h3 className="mt-1.5 font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-white leading-snug">
                        {d.name}
                      </h3>
                      <p className="text-[11.5px] font-medium text-white/80 line-clamp-1">
                        {d.specialization}
                      </p>
                    </div>
                  </div>

                  {/* Card Footer Micro-Details */}
                  <div className="mt-3 flex items-center justify-between px-1.5 py-1 text-[11px]">
                    <div className="flex items-center gap-1 text-[#14181C]/70 font-medium">
                      <Clock className="h-3 w-3 text-[#274472]" />
                      <span>{d.opd}</span>
                    </div>

                    <div className="font-semibold text-[#14181C]">
                      ₹{d.fee} <span className="text-[9.5px] font-normal text-[#14181C]/60">/ OPD</span>
                    </div>
                  </div>

                  {/* Days Available Tag */}
                  <div className="mt-1.5 flex items-center gap-1 border-t border-black/5 pt-2 px-1.5 text-[10.5px] font-medium text-[#14181C]/60">
                    <Calendar className="h-3 w-3 text-[#14181C]/40" />
                    <span>Available: <strong className="text-[#14181C] font-semibold">{d.days}</strong></span>
                  </div>

                </div>
              </Link>
            </Reveal>
          ))}
        </div>

        {/* View All Call to Action */}
        <Reveal delay={200} className="mt-12 text-center">
          <Link
            href="/doctors"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#14181C] px-8 py-3.5 text-xs font-semibold text-white shadow-md transition-all duration-300 hover:bg-[#274472] hover:shadow-lg hover:-translate-y-0.5"
          >
            Explore All Clinical Specialists
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Reveal>

      </div>
    </section>
  );
}