"use client";

import React from "react";
import Image from "next/image";
import { Reveal } from "@/components/ui/reveal";
import { DeptIcon } from "@/components/marketing/dept-icon";

/**
 * North Star Health - Care Model Component
 * ------------------------------------------------------------------
 * Bento-style grid showcasing the Jeeva Care Framework. Uses North Star's 
 * signature warm canvas (#f0eee9), deep midnight (#14181C), and navy (#274472).
 */
export function CareModel() {
  return (
    <section id="care" className="nsh-care-root w-full bg-[#FFFFFF] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      {/* Global CSS for Theme Typography */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;600;700&family=Inter:wght@400;500;600&display=swap');

        .nsh-care-root {
          --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
          --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--font-body);
        }
      `}</style>

      <div className="mx-auto max-w-7xl">
        
        {/* Section Header */}
        <header className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end lg:mb-16">
          <div className="max-w-2xl">
            <Reveal>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#274472]/10 px-3 py-1 text-xs font-semibold text-[#274472] ring-1 ring-[#274472]/20">
                <span className="h-2 w-2 rounded-full bg-[#274472] animate-pulse" />
                The Jeeva Care Framework
              </div>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-[#14181C] sm:text-5xl lg:text-6xl leading-[1.08]">
                Your health deserves more than just &quot;ok.&quot;
              </h2>
            </Reveal>
          </div>
          <Reveal delay={120} className="max-w-md">
            <p className="text-xs sm:text-sm leading-relaxed text-[#14181C]/70">
              Medical complexity shouldn&apos;t mean system friction. We&apos;ve structured infrastructure, data pipelines, and personal interaction around efficiency. This is clinical trust on an ordinary day at Jeeva.
            </p>
          </Reveal>
        </header>

        {/* BENTO GRID CONTAINER */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12 auto-rows-min lg:auto-rows-[280px]">
          
          {/* 1. TOP LEFT: Sovereign Medical Attention (Span 7) */}
          <Reveal delay={0} className="md:col-span-6 lg:col-span-7 bg-[#f0eee9] p-1.5 rounded-[2rem] ">
            <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-[1.75rem] bg-[#ffffff] p-7 ring-1 ring-black/5 transition-all duration-300 hover:ring-black/20 hover:shadow-lg">
              <div className="flex items-start justify-between">
                <span className="inline-flex items-center justify-center rounded-2xl bg-white p-3 text-[#274472] shadow-sm ring-1 ring-black/5">
                  <DeptIcon name="General Medicine" className="h-6 w-6" />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#14181C]/60 ring-1 ring-black/10 rounded-full px-2.5 py-0.5 bg-white/80 backdrop-blur-md">
                  01 // SOVEREIGN ATTENTION
                </span>
              </div>

              <div className="mt-6 max-w-lg">
                <h3 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-[#14181C] sm:text-3xl leading-snug">
                  Sovereign medical attention.
                </h3>
                <p className="mt-2.5 text-xs sm:text-sm leading-relaxed text-[#14181C]/75">
                  Skilled, attentive listeners - your doctor analyzes your entire consolidated medical profile before you say a single word.
                </p>
              </div>

              {/* Status Tag Footer */}
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-black/5 pt-4 text-[11px] font-medium text-[#14181C]/60">
                <span className="rounded-full bg-white/80 px-2.5 py-0.5 shadow-sm ring-1 ring-black/5">Pre-Consult Synthesis</span>
                <span className="hidden sm:inline">•</span>
                <span>Zero Duplicate Intake Forms</span>
              </div>
            </div>
          </Reveal>

          {/* 2. TOP RIGHT: 24/7 Operations (Span 5) */}
          <Reveal delay={60} className="md:col-span-6 lg:col-span-5 bg-[#f0eee9] p-1.5 rounded-[2rem] ">
            <div className="group relative flex h-full min-h-[280px] flex-col justify-between overflow-hidden rounded-[1.75rem] bg-[#ffffff] p-7 text-white  transition-all duration-500 hover:ring-white/20 hover:-translate-y-0.5 hover:shadow-xl">
              {/* Image Background */}
              <Image 
                src="/images/hospital_banner.jpeg" 
                alt="24/7 Trauma Intake" 
                fill
                sizes="(max-width: 1024px) 100vw, 40vw"
                className="object-cover transition-transform duration-1000 ease-out group-hover:scale-105" 
                priority
              />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#14181C] via-[#14181C]/70 to-[#14181C]/30" />

              <div className="relative z-10 flex items-start justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-[10px] font-semibold tracking-wider text-emerald-300 backdrop-blur-md ring-1 ring-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  LIVE INTAKE ACTIVE
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-white/70 ring-1 ring-white/15 rounded-full px-2.5 py-0.5 bg-black/40 backdrop-blur-md">
                  02 EMERGENCY
                </span>
              </div>

              <div className="relative z-10 mt-6">
                <div className="flex items-baseline gap-2">
                  <span className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight text-white sm:text-6xl">24×7</span>
                  <span className="text-xs font-medium text-white/70">Continuous Operations</span>
                </div>
                <h4 className="mt-2 font-[family-name:var(--font-display)] text-lg font-semibold text-white">Uninterrupted Trauma Intake</h4>
                <p className="mt-1 text-xs leading-relaxed text-white/75">
                  A fully staffed emergency department ready for immediate triage, every hour of the year.
                </p>
              </div>
            </div>
          </Reveal>

          {/* 3. MIDDLE LEFT: Unified Infrastructure (Tall Card - Span 5, Row Span 2) */}
          <Reveal delay={120} className="md:col-span-6 lg:col-span-5 lg:row-span-2 bg-[#f0eee9] p-1.5 rounded-[2rem]">
            <div className="group relative flex h-full min-h-[420px] flex-col justify-between overflow-hidden rounded-[1.75rem] bg-[#ffffff] p-7 text-white  transition-all duration-500  hover:shadow-2xl">
              <Image 
                src="/images/hospital_banner1.png" 
                alt="Unified Clinical Infrastructure" 
                fill
                sizes="(max-width: 1024px) 100vw, 40vw"
                className="object-cover transition-transform duration-1000 ease-out group-hover:scale-105" 
              />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#14181C] via-[#14181C]/75 to-[#14181C]/25" />

              <div className="relative z-10 flex items-center justify-between">
                <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-semibold tracking-wider text-white backdrop-blur-md ring-1 ring-white/15">
                  SINGLE FOOTPRINT
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-white/70 ring-1 ring-white/15 rounded-full px-2.5 py-0.5 bg-black/40 backdrop-blur-md">
                  03 INFRASTRUCTURE
                </span>
              </div>

              <div className="relative z-10 mt-auto pt-10">
                <h3 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-white sm:text-3xl leading-tight">
                  Unified Clinical Infrastructure
                </h3>
                <p className="mt-3 text-xs sm:text-sm leading-relaxed text-white/80">
                  Consultation suites, diagnostic labs, processing labs, specialized pharmacy counters, and acute care wards housed within a single structural footprint.
                </p>

                {/* Micro Pill Badges */}
                <div className="mt-6 flex flex-wrap gap-2 pt-4 border-t border-white/15">
                  <span className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md ring-1 ring-white/10">Pharmacy</span>
                  <span className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md ring-1 ring-white/10">Imaging Labs</span>
                  <span className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md ring-1 ring-white/10">Surgical Suites</span>
                </div>
              </div>
            </div>
          </Reveal>

          {/* 4. MIDDLE RIGHT TOP: Diagnostic Turnaround (Span 7) */}
          <Reveal delay={180} className="md:col-span-6 lg:col-span-7 bg-[#f0eee9] p-1.5 rounded-[2rem]">
            <div className="group relative flex h-full min-h-[280px] flex-col justify-between overflow-hidden rounded-[1.75rem] bg-[#14181C] p-7 text-white  transition-all duration-500 hover:shadow-xl">
              <Image 
                src="/images/lab.avif" 
                alt="Accelerated Lab Processing" 
                fill
                sizes="(max-width: 1024px) 80vw, 40vw"
                className="object-cover transition-transform duration-1000 ease-out group-hover:scale-105" 
              />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#14181C] via-[#14181C]/70 to-transparent" />

              <div className="relative z-10 flex items-start justify-end">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-white/70 ring-1 ring-white/15 rounded-full px-2.5 py-0.5 bg-black/40 backdrop-blur-md">
                  04 DIAGNOSTICS
                </span>
              </div>

              <div className="relative z-10 max-w-md mt-6">
                <div className="flex items-baseline gap-2">
                  <span className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight text-white sm:text-6xl">30m</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Average Turnaround</span>
                </div>
                <h4 className="mt-2 font-[family-name:var(--font-display)] text-xl font-semibold text-white">Accelerated Lab Processing</h4>
                <p className="mt-1 text-xs leading-relaxed text-white/75">
                  Routine blood metrics and diagnostics processed inside local clean labs to deliver clear treatment data fast.
                </p>
              </div>
            </div>
          </Reveal>

          {/* 5. MIDDLE RIGHT BOTTOM LEFT: Fluid OPD Pathways (Span 3) */}
          <Reveal delay={240} className="md:col-span-3 lg:col-span-3 bg-[#f0eee9] p-1.5 rounded-[2rem] ">
            <div className="group relative flex h-full min-h-[240px] flex-col justify-between overflow-hidden rounded-[1.75rem] bg-white p-6  transition-all duration-300  hover:shadow-md">
              <div className="flex items-start justify-between">
                <span className="inline-flex items-center justify-center rounded-xl bg-[#274472] p-2.5 text-white shadow-sm ring-1 ring-black/5">
                  <DeptIcon name="Fever" className="h-5 w-5" />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#14181C]/60 ring-1 ring-[#274472]/20 rounded-full px-2 py-0.5 bg-white/80">
                  05 SCHEDULING
                </span>
              </div>

              <div className="mt-4">
                <h4 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[#14181C] leading-snug">
                  Fluid OPD architecture.
                </h4>
                <p className="mt-2 text-xs leading-relaxed text-[#14181C]/75">
                  Same-day OPD pathways operating seamlessly from 8 AM to 8 PM with zero systemic queues.
                </p>
              </div>
            </div>
          </Reveal>

          {/* 6. MIDDLE RIGHT BOTTOM RIGHT: Unified Medical ID (Span 4) */}
          <Reveal delay={300} className="md:col-span-3 lg:col-span-4">
            <div className="group relative flex h-full min-h-[240px] flex-col justify-between overflow-hidden rounded-[1.75rem] bg-[#f0eee9] p-6 ring-1 ring-black/5 transition-all duration-300 hover:ring-black/20 hover:shadow-md">
              <div className="flex items-start justify-between">
                <span className="inline-flex items-center justify-center rounded-xl bg-[#14181C] p-2.5 text-white shadow-sm ring-1 ring-black/5">
                  <DeptIcon name="Prevention" className="h-5 w-5" />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#14181C]/60 ring-1 ring-black/10 rounded-full px-2 py-0.5 bg-white/80">
                  06 IDENTIFICATION
                </span>
              </div>

              <div className="mt-4">
                <h4 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[#14181C] leading-snug">
                  A unified medical ID for life.
                </h4>
                <p className="mt-2 text-xs leading-relaxed text-[#14181C]/75">
                  Scans, prescriptions, and history linked to one permanent secure token. Zero redundancy.
                </p>
              </div>
            </div>
          </Reveal>

        </div>
      </div>
    </section>
  );
}