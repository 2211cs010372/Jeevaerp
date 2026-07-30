"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DeptVisual } from "@/components/marketing/dept-visual";
import { DEPARTMENTS, HOSPITAL, type Department } from "@/lib/data";
import { careHref } from "@/lib/care";
import { Chapter, ChapterHead } from "./section";
import { PinnedRail, Reveal } from "./motion";

/**
 * Chapter 02 - the departments, as a rail.
 *
 * The one cinematic move on the page: from 1024px up the section pins itself
 * and the departments travel sideways as you scroll down. It earns the hijack
 * because a horizontal rail is genuinely the right shape for sixteen peers of
 * equal weight - a 4x4 grid silently ranks them by reading order.
 *
 * TWO ROWS, not one. Sixteen cards in a single row is 5,500px of horizontal
 * travel, which is either a pin that lasts six screens or a track that moves
 * two and a half times faster than the wheel. Splitting the list halves the
 * distance and, as a bonus, makes the rail read as a dense index rather than
 * a carousel.
 *
 * Below 1024px the pin is off entirely and the same markup becomes a
 * scroll-snapped swipe strip (see .rail-shell in site-theme.css). Nobody on a
 * phone has their vertical scroll taken away from them: that is the gesture
 * they use to reach the emergency number.
 */
export function Departments() {
  const half = Math.ceil(DEPARTMENTS.length / 2);
  const rows = [DEPARTMENTS.slice(0, half), DEPARTMENTS.slice(half)];

  return (
    <Chapter id="departments" tone="paper" bleed>
      <div className="shell-w">
        <ChapterHead
          index="02"
          label="Departments"
          lines={[{ text: "Every specialty," }, { text: "one corridor apart." }]}
          lede={`From a racing heart to a child's fever, most of a family's care lives in this one building in ${HOSPITAL.locality.split(",")[0]}. Consult, test and collect medicines in a single visit.`}
          action={{ href: "/doctors", label: "Browse all consultants" }}
        />
      </div>

      {/* The pin needs a full-viewport shell to hold still inside. */}
      <div className="mt-12 sm:mt-16">
        <PinnedRail
          ease={1.15}
          className="rail-shell lg:flex lg:h-[100svh] lg:items-center"
          trackClassName="rail-track flex-col lg:px-[max(var(--shell-x),calc((100vw-var(--shell-max))/2))]"
        >
          {rows.map((row, ri) => (
            <div key={ri} className="flex gap-[clamp(14px,1.6vw,24px)]">
              {row.map((d) => (
                <DeptCard key={d.name} dept={d} />
              ))}

              {/* the rail ends on the way out, not on a wall */}
              {ri === rows.length - 1 && <RailEnd />}
            </div>
          ))}
        </PinnedRail>
      </div>

      <Reveal className="shell-w mt-10 lg:mt-14" y={14}>
        <p className="mono flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
          <span className="hidden h-px w-10 bg-[var(--line-strong)] lg:block" />
          <span className="lg:hidden">Swipe to browse all {DEPARTMENTS.length}</span>
          <span className="hidden lg:inline">
            Keep scrolling to travel the rail · {DEPARTMENTS.length} departments
          </span>
        </p>
      </Reveal>
    </Chapter>
  );
}

const CARD =
  "rail-item w-[62vw] shrink-0 sm:w-[38vw] lg:h-[clamp(190px,25vh,248px)] lg:w-[clamp(238px,20vw,296px)]";

function DeptCard({ dept }: { dept: Department }) {
  return (
    <Link
      href={careHref(dept.name)}
      className={`group relative flex h-[188px] flex-col justify-end overflow-hidden rounded-[var(--r-lg)] bg-[var(--pine-ink)] ${CARD}`}
    >
      <DeptVisual
        name={dept.name}
        src={dept.image}
        className="absolute inset-0 h-full w-full object-cover opacity-60 transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.08]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--pine-ink)] via-[var(--pine-ink)]/40 to-transparent"
      />

      <span className="mono absolute left-5 top-5 z-10 text-[10px] uppercase tracking-[0.18em] text-white/55">
        ({dept.index})
      </span>
      <span
        aria-hidden
        className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/12 text-white opacity-0 transition-all duration-400 group-hover:rotate-45 group-hover:bg-white group-hover:text-[var(--pine-ink)] group-hover:opacity-100"
      >
        <ArrowUpRight className="h-3.5 w-3.5" />
      </span>

      <div className="relative z-10 p-5">
        <p className="mono text-[9px] uppercase tracking-[0.16em] text-[var(--teal-tint)]">
          {dept.common}
        </p>
        <h3 className="mt-2 text-[17px] font-semibold leading-tight tracking-[-0.025em] text-white">
          {dept.name}
        </h3>
      </div>
    </Link>
  );
}

function RailEnd() {
  return (
    <Link
      href="/doctors"
      className={`group flex h-[188px] flex-col justify-between rounded-[var(--r-lg)] border border-[var(--line-strong)] bg-[var(--bone)] p-5 ${CARD}`}
    >
      <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
        (all)
      </span>
      <span>
        <span className="block text-[17px] font-semibold leading-tight tracking-[-0.025em] text-[var(--ink)]">
          Who consults in each department
        </span>
        <span className="link-arrow mt-4 text-[13px]">
          Directory
          <span className="link-arrow-dot !h-8 !w-8">
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </span>
      </span>
    </Link>
  );
}
