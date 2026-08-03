import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { JOURNEY } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Reveal, Stagger } from "./motion";

/**
 * Chapter 05 - a first visit, in order.
 *
 * REBUILT FROM RULED COLUMNS TO CARDS, in the "Why Jeeva" palette: white cells
 * on porcelain, 16px corners, no borders and no shadows, a counted teal numeral
 * carrying each cell, and the accent spent in exactly one filled card.
 *
 * WHAT THE HAIRLINES WERE DOING, AND HOW IT SURVIVED. The old version hung the
 * four steps off one rule running across the top of the row, and that rule was
 * load-bearing: it was the promise that these happen in sequence and that there
 * are only four of them, which is the actual reassurance a first-timer needs.
 * Cards separate rather than connect, so the sequence would have been lost -
 * hence the connector above the grid, a hairline with a node over each card.
 * It says the same thing the old rule said, over a layout that can now give
 * each step a shape of its own.
 *
 * WHAT THIS CHAPTER IS FOR, SAID OUT LOUD. It used to list four desks and leave
 * the reader to work out why that was worth reading. A first-timer is not
 * curious about the hospital's process; they are asking how long this will take,
 * how many trips it will cost them, and what they have to carry. So each card
 * leads with the expectation (`meta`) and closes on the point of it (`why`),
 * and the filled card at the foot states the payoff all four add up to.
 *
 * FOUR STEPS ARE A 2x2 ON A PHONE. Two columns from 320px up, which is the
 * shape "four of something in order" wants on a small screen - the count is
 * legible at a glance instead of being a stack you have to scroll to the end
 * of to learn it was only four.
 *
 * WHAT A TILE KEEPS, AND WHY IT IS THESE THREE. A 160px column cannot hold a
 * sentence, so below `sm` a step is its numeral, its desk and its `meta` - the
 * sequence, the place, and how long it takes. That is deliberately the trio a
 * person standing in the lobby is asking about; `text` mostly restates the
 * title in a sentence, and `why` is the argument for the step rather than the
 * step. Both come back at `sm`, where there is width to set them. This is the
 * one chapter whose prose is not published anywhere else on the site, so the
 * three fields that survive had to be the load-bearing ones.
 */
export function Journey() {
  return (
    <Chapter tone="light">
      <ChapterHead
        index="05"
        label="Your first visit"
        lines={[{ text: "Four steps," }, { text: "start to finish." }]}
        lede="Never been here before? This is a first visit end to end - what happens at each desk, and roughly how long it takes. Registration happens once; after that your Jeeva ID is the only thing you need to bring."
        action={{ href: "/book", label: "Start with step 01" }}
      />

      {/* the sequence, before the steps: a node per card on one hairline. Only
          at lg, where the four cards actually sit in a row - stacked on a
          phone they are already read top to bottom and a connector across
          nothing would be decoration. */}
      <Reveal className="mt-12 hidden sm:mt-16 lg:block" y={14}>
        {/* THE SAME GRID AS THE CARDS, not four flex segments. A flex row
            divides the full width into four equal parts; the grid below divides
            it into four parts MINUS three 12px gaps. Laid out the first way the
            fourth node ends up nine pixels adrift of the card it belongs to -
            small enough to look like a mistake rather than a decision. */}
        <div className="grid grid-cols-4 gap-3">
          {JOURNEY.map((j, i) => (
            <div key={j.step} className="flex items-center">
              <span aria-hidden className="h-2 w-2 flex-none rounded-full bg-[var(--teal)]" />
              <span
                aria-hidden
                className={`h-px flex-1 ${
                  i === JOURNEY.length - 1
                    ? "bg-gradient-to-r from-[var(--line-strong)] to-transparent"
                    : "bg-[var(--line-strong)]"
                }`}
              />
            </div>
          ))}
        </div>
      </Reveal>

      <Stagger
        as="ol"
        each={0.09}
        y={24}
        className="mt-3 grid grid-cols-2 gap-3 max-lg:mt-12 lg:grid-cols-4"
      >
        {JOURNEY.map((j) => (
          <li
            key={j.step}
            className="flex flex-col rounded-[16px] bg-[var(--paper)] p-4 sm:p-7"
          >
            {/* the step number IS the label here, so there is no second one
                above it - printing "Step 01" over a large 01 says it twice */}
            <p className="stat-num text-[var(--teal)] [font-size:clamp(1.9rem,3vw,2.7rem)]">
              {j.step}
            </p>

            <h3 className="mt-3 text-[17px] font-semibold leading-tight tracking-[-0.025em] text-[var(--ink)] sm:mt-4">
              {j.title}
            </h3>

            {/* what to expect, before what happens - this is the line that
                answers "how long will I be here", and the reason it is one of
                the three fields a phone tile keeps */}
            <p className="mono mt-2.5 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {j.meta}
            </p>

            <p className="mt-3.5 text-[13px] leading-[1.65] text-[var(--ink-soft)] max-sm:hidden">
              {j.text}
            </p>

            {/* the point of the step, stated as what it spares you. On its own
                tinted strip at the foot so the four of them line up down the
                row and can be read as a column of their own. Hidden on the
                paragraph's wrapper rather than the strip, so `pt-6` does not
                leave its gap behind on a phone. */}
            <p className="mt-auto pt-6 max-sm:hidden">
              <span className="block rounded-[9px] bg-[var(--teal-soft)] px-4 py-3.5 text-[12.5px] font-medium leading-[1.55] text-[var(--teal-deep)]">
                {j.why}
              </span>
            </p>
          </li>
        ))}
      </Stagger>

      {/* the one filled cell - the payoff the four steps add up to, and the
          only place this chapter spends the accent */}
      <Reveal className="mt-3" y={22}>
        <div className="flex flex-col justify-between gap-8 rounded-[16px] bg-[var(--teal)] p-6 sm:p-8 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <p className="mono text-[10px] uppercase tracking-[0.18em] text-white/55">
              One building · one trip
            </p>
            <p className="display-sm mt-6 max-w-[26ch] text-white">
              Consult, test and collect medicines in a single visit.
            </p>
            <p className="mt-3 max-w-[58ch] text-[13.5px] leading-[1.7] text-white/70">
              That is what the four steps are for. Registration happens once, ever - every visit
              after this one starts at step 02.
            </p>
          </div>

          <Link href="/book" className="btn btn-light flex-none">
            Book your first appointment
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </Reveal>
    </Chapter>
  );
}
