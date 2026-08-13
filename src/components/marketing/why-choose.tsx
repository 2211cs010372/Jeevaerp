"use client";

import { Fragment } from "react";
import Link from "next/link";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { DeptVisual } from "@/components/marketing/dept-visual";
import {
  CARE_AREAS,
  DEPARTMENTS,
  HOSPITAL,
  type CareArea,
  type Department,
} from "@/lib/data";
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
/**
 * The rail is grouped by CARE AREA, not split down the middle.
 *
 * CARE_AREAS already exists for the navbar's mega-menu and already covers all
 * sixteen departments with no overlap, so it is the grouping tier - inventing a
 * second taxonomy would mean the rail and the nav could disagree about where
 * Physiotherapy lives. The two rows are cut between care areas rather than
 * mid-group, so a group never straddles both rows.
 */
const ROWS: CareArea[][] = [CARE_AREAS.slice(0, 4), CARE_AREAS.slice(4)];

export function Departments() {
  const byName = new Map(DEPARTMENTS.map((d) => [d.name, d]));

  // tone is light, not paper: these cards are white and separate from the
  // ground by the paper-on-bone value step, so on a paper ground their edges
  // would simply not exist. Costs the light/paper alternation with chapter 01
  // - see the tone note in section.tsx - and buys a card that can be seen.
  return (
    <Chapter id="departments" tone="light" bleed>
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
          cinematic
          className="rail-shell relative lg:flex lg:h-[100svh] lg:items-center"
          trackClassName="rail-track flex-col lg:px-[max(var(--shell-x),calc((100vw-var(--shell-max))/2))]"
          overlay={<RailProgress />}
        >
          {ROWS.map((row, ri) => (
            <div key={ri} className="flex gap-[clamp(14px,1.6vw,24px)]">
              {row.map((area) => (
                <Fragment key={area.label}>
                  <GroupCard area={area} />
                  {area.departments.map((name) => {
                    const d = byName.get(name);
                    return d ? <DeptCard key={name} dept={d} /> : null;
                  })}
                </Fragment>
              ))}

              {/* the rail ends on the way out, not on a wall */}
              {ri === ROWS.length - 1 && <RailEnd />}
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

/* No fixed height any more: the photograph is square, so a card is exactly as
   tall as its own width plus its caption. The row is a flex container, which
   stretches every card to the tallest of them - so the group cards and the
   rail end still line up without being told a pixel height.

   THE WIDTH AND THE CARD ARE NOW TWO ELEMENTS. `rail-item` is the cell the
   focus lens scales, and the card inside it is what lifts on hover. They have
   to be separate boxes: both effects are transforms, and GSAP writing `scale`
   onto the same element Tailwind is writing `-translate-y` onto means whichever
   ran last wins and the other silently stops working. */
const CELL =
  "rail-item w-[44vw] shrink-0 sm:w-[38vw] lg:w-[clamp(185px,16vw,239px)]";
const CARD = "flex h-full flex-col";

/**
 * The card that opens a care area - the door, before the rooms behind it.
 * Type only, no photograph: it has to read as a heading among the cards that
 * follow it, not as another department competing with them.
 */
function GroupCard({ area }: { area: CareArea }) {
  const n = area.departments.length;

  return (
    <div className={CELL}>
      <div className={`justify-between rounded-[16px] bg-[var(--teal-soft)] p-5 ${CARD}`}>
        <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--teal)]">
          {n} {n === 1 ? "department" : "departments"}
        </span>
        <span>
          <span className="block text-[17px] font-semibold leading-tight tracking-[-0.025em] text-[var(--teal-deep)]">
            {area.label}
          </span>
          <span className="mt-2 block text-[12.5px] leading-[1.55] text-[var(--ink-soft)]">
            {area.blurb}
          </span>
        </span>
      </div>
    </div>
  );
}

function DeptCard({ dept }: { dept: Department }) {
  return (
    <div className={CELL}>
    <Link
      href={careHref(dept.name)}
      className={`group rounded-[16px] bg-[var(--paper)] p-2.5 transition-transform duration-500 ease-[var(--ease-out)] hover:-translate-y-1.5 ${CARD}`}
    >
      {/* the photograph sits inset inside the cell rather than bleeding to the
          edge - the detail that makes a card read as an object. Square, so a
          row of departments reads as a set rather than as crops of different
          shapes. */}
      <div className="relative aspect-square overflow-hidden rounded-[9px]">
        {/* The image no longer zooms on hover. Inside a square crop a 1.08
            scale pushes whatever the photograph is actually of away from the
            centre, which is the one thing a department thumbnail cannot afford.
            The card lifts instead, and the title takes the underline.

            It DRIFTS, though: `data-rail-media` hands the frame below to the
            rail, which slides it a few percent as the card crosses the screen.

            TWO ELEMENTS AGAIN, and for the same reason as the cell and the
            card: GSAP writes a whole `transform` onto the drifting element, so
            a Tailwind `scale-` class on that same element would be erased. The
            overscale therefore lives on the picture inside - 12%, which is 6%
            of slack on each side against a drift that never exceeds 4%, so no
            edge is ever exposed. */}
        <div data-rail-media className="absolute inset-0">
          <DeptVisual
            name={dept.name}
            src={dept.image}
            className="h-full w-full scale-[1.12] object-cover"
          />
        </div>

        {/* the index rides a chip now, not a gradient: without the pine wash
            behind it, white type on an unknown photograph is a coin toss */}
        <span className="mono absolute left-2.5 top-2.5 z-10 rounded-full bg-[var(--paper)]/85 px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] text-[var(--ink)]">
          ({dept.index})
        </span>
        <span
          aria-hidden
          className="absolute right-2.5 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full bg-[var(--paper)]/85 text-[var(--ink)] opacity-0 transition-all duration-400 group-hover:rotate-45 group-hover:bg-[var(--teal)] group-hover:text-white group-hover:opacity-100"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </div>

      <div className="mt-3 px-1.5 pb-1">
        <p className="mono truncate text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
          {dept.common}
        </p>
        {/* the underline sweeps left to right, the same move the navbar links
            make - one hover idiom across the site rather than a new one here */}
        <h3 className="relative mt-1.5 inline-block text-[15px] font-semibold leading-tight tracking-[-0.025em] text-[var(--ink)]">
          {dept.name}
          <span
            aria-hidden
            className="absolute -bottom-1 left-0 h-[2px] w-full origin-left scale-x-0 bg-[var(--teal)] transition-transform duration-400 ease-[var(--ease-out)] group-hover:scale-x-100"
          />
        </h3>
      </div>
    </Link>
    </div>
  );
}

function RailEnd() {
  return (
    <div className={CELL}>
      <Link
        href="/doctors"
        className={`group justify-between rounded-[16px] border border-[var(--line-strong)] bg-transparent p-5 transition-transform duration-500 ease-[var(--ease-out)] hover:-translate-y-1.5 ${CARD}`}
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
    </div>
  );
}

/**
 * The rail's own progress hairline, held still inside the pinned shell while
 * the cards travel underneath it.
 *
 * A pinned section takes the scrollbar away for two-and-a-half screens, and
 * without this the only feedback is that the page has apparently stopped
 * moving. The bar is driven by --rail-progress, which PinnedRail writes on the
 * shell every frame - so it costs no second scroll listener, and it is exactly
 * in step with the travel it is reporting.
 *
 * lg only, because below that the rail is an ordinary swipe strip with a real
 * scroll position and nothing needs explaining.
 */
function RailProgress() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[3vh]  hidden px-[max(var(--shell-x),calc((100vw-var(--shell-max))/2))] lg:block">
      <div className="flex items-center gap-5">
        <span className="mono flex-none text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
          The rail
        </span>
        <span className="relative h-[2px] flex-1 overflow-hidden rounded-full bg-[var(--line-strong)]">
          <span
            className="absolute inset-0 origin-left rounded-full bg-[var(--teal)]"
            style={{ transform: "scaleX(var(--rail-progress, 0))" }}
          />
        </span>
        <span className="mono flex-none text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
          {DEPARTMENTS.length} departments
        </span>
      </div>
    </div>
  );
}
