"use client";

import Link from "next/link";
import { Reveal } from "@/components/ui/reveal";
import { HOSPITAL } from "@/lib/data";
import { Search, CalendarCheck, Bed, PhoneCall, ArrowUpRight } from "lucide-react";

/**
 * North Star Health — Quick Action Bar Redesign
 * ------------------------------------------------------------------
 * Interactive high-priority quick action tiles for key healthcare workflows.
 */

const ACTIONS = [
  {
    href: "/doctors",
    title: "Find a doctor",
    sub: "By name or specialty",
    badge: "40+ Doctors",
    icon: Search,
    accent: "from-[#EBF3FA] to-[#D5E5F2]",
    iconColor: "text-[#274472]",
  },
  {
    href: "/book",
    title: "Book appointment",
    sub: "Instant online slot booking",
    badge: "Same-day",
    icon: CalendarCheck,
    accent: "from-[#F3EFEA] to-[#E5DDD2]",
    iconColor: "text-[#5A4535]",
  },
  {
    href: "/#wards",
    title: "Rooms & pricing",
    sub: "Transparent cost breakdown",
    badge: "Published rates",
    icon: Bed,
    accent: "from-[#EBF7F5] to-[#CDEEE9]",
    iconColor: "text-[#1B5B52]",
  },
] as const;

export function ActionBar() {
  return (
    <section className="w-full bg-[#FFFFFF] -mt-[5vw] px-3 py-6 sm:px-6 lg:px-8">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;600;700&family=Inter:wght@400;500;600&display=swap');

        .nsh-action-root {
          --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
          --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--font-body);
        }
      `}</style>

      <div className="nsh-action-root mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ACTIONS.map((a, i) => {
            const Icon = a.icon;
            return (
              <Reveal key={a.title} delay={i * 80}>
                <Link
                  href={a.href}
                  className="group relative flex h-full min-h-[140px] flex-col justify-between overflow-hidden rounded-[1.35rem] bg-[#f0eee9] p-1.5 ring-1 ring-black/5 transition-all duration-300  hover:ring-black/10 hover:shadow-lg "
                >
                  {/* Subtle top background sheen */}
                  <div
                    className={`absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${a.accent} opacity-40 blur-xl transition-opacity group-hover:opacity-80`}
                    aria-hidden
                  />

                  <div className="bg-white/70 p-4 rounded-[1.15rem]" >
                    {/* Header Row: Icon + Badge + Arrow */}
                    <div className="relative z-10 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5 ${a.iconColor}`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-[#14181C]/70 backdrop-blur ring-1 ring-black/5">
                          {a.badge}
                        </span>
                      </div>

                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#14181C]/60 shadow-sm ring-1 ring-black/5 transition-all duration-200 group-hover:bg-[#14181C] group-hover:text-white group-hover:shadow-md">
                        <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </div>
                    </div>

                    {/* Body Text */}
                    <div className="relative z-10 pt-4">
                      <h3 className="font-[family-name:var(--font-display)] text-base font-semibold leading-tight text-[#14181C]">
                        {a.title}
                      </h3>
                      <p className="mt-1 text-xs text-[#14181C]/65">
                        {a.sub}
                      </p>
                    </div>
                  </div>
                </Link>
              </Reveal>
            );
          })}

          {/* 24/7 Emergency Card */}
          <Reveal delay={240}>
            <a
              href={`tel:${HOSPITAL.emergency.replace(/\s/g, "")}`}
              className="group relative flex h-full min-h-[140px] flex-col justify-between overflow-hidden rounded-[1.35rem] bg-[#FFF5F5] p-5 ring-1 ring-[#E53E3E]/20 transition-all duration-300 hover:-translate-y-1 hover:bg-[#FFEAEB] hover:shadow-[0_12px_32px_-8px_rgba(229,62,62,0.2)] hover:ring-[#E53E3E]/30"
            >
              {/* Background Glow */}
              <div
                className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br from-[#FED7D7] to-[#FEB2B2] opacity-60 blur-xl transition-opacity group-hover:opacity-90"
                aria-hidden
              />

              {/* Header Row */}
              <div className="relative z-10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#E53E3E] shadow-sm ring-1 ring-[#E53E3E]/20">
                    <PhoneCall className="h-5 w-5" />
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#C53030] shadow-sm ring-1 ring-[#E53E3E]/15">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E53E3E] opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E53E3E]"></span>
                    </span>
                    24×7 Active
                  </span>
                </div>

                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#E53E3E] shadow-sm ring-1 ring-[#E53E3E]/20 transition-all duration-200 group-hover:bg-[#E53E3E] group-hover:text-white">
                  <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
              </div>

              {/* Content */}
              <div className="relative z-10 pt-4">
                <h3 className="font-[family-name:var(--font-display)] text-base font-semibold leading-tight text-[#9B2C2C]">
                  Emergency Care
                </h3>
                <p className="mt-1 font-mono text-xs font-semibold tracking-wider text-[#C53030]">
                  {HOSPITAL.emergency}
                </p>
              </div>
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}