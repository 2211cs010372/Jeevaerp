import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { WARDS, DEPARTMENTS, HOSPITAL } from "@/lib/data";
import { listPublicDoctors } from "@/server/services/public-doctors.service";
import { Chapter } from "./section";
import { Counter, Parallax, Reveal, Stagger } from "./motion";

/**
 * The capacity band.
 *
 * Four figures, every one derived from the data the rest of the site is built
 * from - beds come from the published ward table, specialties from the
 * department list - so it cannot drift out of step with the pages that quote
 * them.
 *
 * NOW THE LANES' CARD, NOT HAIRLINES. These four used to be cells in a ruled
 * table: a border on top of the grid, one under each figure, and a vertical
 * hairline between them above `lg`. It read as a spec sheet, and it was the
 * only band left on the homepage still drawing its own edges now that "Why
 * Jeeva" and the care model are bentos. Same flat panel as the fast lanes
 * under the marquee - 10px corners, no border, no shadow, separation by the
 * value step alone - so the page has one card idiom rather than three.
 *
 * The composition follows the lanes too: the qualifier sits up top as a mono
 * meta line and the figure with its noun sits at the foot of the card, which
 * is what makes `justify-between` and the minimum height mean something.
 *
 * ON THE BUILDING, FROM HERE ON. The band runs full-bleed over a photograph of
 * the hospital rather than over porcelain. Capacity is the one claim on this
 * page that is about the premises - thirty beds, eight of them monitored, are
 * a fact about a building - so the building is what sits behind it. The white
 * cards do the work they always did; the photograph only says where.
 *
 * No badges, no glows, no pills. The numbers are still the design.
 */

/* The lanes' card with the interaction taken off - these are facts, not tap
   targets, so `group`, the hover fill and the colour transition come away and
   the panel stays put. Paper on porcelain here; the lanes are the other way
   round because they sit on a white band. */
const CARD =
  "flex min-h-[9.5rem] flex-col justify-between gap-7 rounded-[10px] bg-[var(--paper)] p-5 sm:p-6";

export async function NumbersBand() {
  const consultants = (await listPublicDoctors()).length;
  const beds = WARDS.reduce((s, w) => s + w.beds, 0);
  const icu = WARDS.find((w) => w.name === "ICU")?.beds ?? 0;

  const FIGURES = [
    { value: beds, suffix: "", label: "Inpatient beds", sub: "Across four ward classes" },
    { value: icu, suffix: "", label: "ICU units", sub: "Continuously monitored" },
    { value: DEPARTMENTS.length, suffix: "", label: "Specialties", sub: "Consulting daily" },
    { value: consultants, suffix: "+", label: "Consultants", sub: "Named, with published fees" },
  ];

  return (
    <Chapter
      tone="light"
      bleed
      className="chapter-tight relative min-h-[50svh] isolate overflow-hidden"
    >
      {/* The building the figures are counting. `bleed` is what lets it run
          edge to edge - the chapter's own container would have stopped the
          photograph at the 1320px shell and left a porcelain margin either
          side, which reads as a picture pasted on rather than a room.

          Held behind the cards at -z-20 with the wash at -z-10, both inside
          the section's own stacking context, so nothing here can climb over
          the header or the scroll-progress bar. The bone from `tone="light"`
          stays underneath as the fallback if the photograph never arrives.
          `overflow-hidden` on the chapter is load-bearing now that the frame
          is taller than the band - see the note on the drift below.

          The half-viewport height is a FLOOR, not a fixed height. As `h-[50svh]`
          it measured 406px on a 375px phone against 415px of cards, so
          `overflow-hidden` - which the drift needs - quietly took 9px off the
          bottom of the bottom row, and the line under the cards would have
          gone entirely. `min-h` keeps the band at least half a screen tall on
          a desktop, where the content is shorter than the floor anyway, and
          lets it grow on a phone where it is not. */}
      {/* The drift. 12% of the frame's height across the whole pass, which on
          a band this short works out at about 25px - the same perceived depth
          the taller diagnostics cell gets from 9%, since the travel is a
          percentage of an element less than half its height.

          THE FRAME HAS TO OUTRUN THE TRAVEL AT BOTH ENDS. It is oversized to
          120% and pulled up 10%, which leaves ~35px of slack above and below
          against ~25px of movement. The first sizing here was 114%/7% and it
          measured 22px of slack at the foot against 24px of travel: a 2px
          sliver of bare wash along the bottom edge at one end of the scroll,
          which is small enough to read as a rendering fault rather than a
          decision. `Parallax` installs no ScrollTrigger at all under
          prefers-reduced-motion, so the still version is simply the
          photograph sitting where it always was. */}
      <Parallax amount={12} className="absolute inset-0  -top-[10%] -z-20 h-[120%]">
        <Image
          src="/images/hospital_banner.jpeg"
          alt=""
          aria-hidden
          fill
          sizes="100vw"
          className="object-cover backdrop-blur-xl object-center"
        />
      </Parallax>

      {/* Dark enough that white cards are unmistakably the content, light
          enough that the building is still a building. The type sits on paper
          here, not on the photograph, so this wash is only buying contrast for
          the cards - it does not need the 42% the facilities cells used to
          run, and going that far would just switch the band off. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-[var(--pine-ink)]/72 via-[var(--pine-ink)]/58 to-[var(--pine-ink)]/76"
      />

      <div className="shell-w">
        <Stagger
          each={0.09}
          y={22}
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          {FIGURES.map((f) => (
            <div key={f.label} className={CARD}>
              <p className="mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
                {f.sub}
              </p>

              <div>
                <p className="stat-num text-[var(--ink)]">
                  <Counter value={f.value} suffix={f.suffix} />
                </p>
                <h3 className="mt-4 text-[14.5px] font-semibold tracking-[-0.015em] text-[var(--ink)]">
                  {f.label}
                </h3>
              </div>
            </div>
          ))}
        </Stagger>

        {/* The line under the cards, and the only type on this page set
            directly on a photograph. It gets white rather than ink because
            there is no cell beneath it - the wash at the foot of the band is
            the darkest part of the gradient for exactly this reason.

            It says the one thing four bare numbers cannot: that the count is
            of this building, and that the rates attached to those beds are
            published rather than quoted at a counter. */}
        <Reveal className="mt-8 sm:mt-10" y={16}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="mono text-[10.5px] uppercase tracking-[0.16em] text-white/60">
                {HOSPITAL.locality} · one building
              </p>
              <p className="mt-3 max-w-[54ch] text-[14px] leading-[1.65] text-white/80">
                Every bed, theatre and consulting room counted here is inside
                it. The ward rates that go with them are published on this site
                too, and locked at admission - so the figure you are quoted is
                the figure you are billed.
              </p>
            </div>

            <Link href="/#wards" className="link-arrow link-arrow-dark flex-none">
              See every ward rate
              <span className="link-arrow-dot">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </div>
        </Reveal>
      </div>
    </Chapter>
  );
}
