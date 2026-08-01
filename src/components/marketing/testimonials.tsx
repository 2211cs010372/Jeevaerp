"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Quote } from "lucide-react";
import { Chapter, ChapterHead } from "./section";
import { Stagger } from "./motion";

/**
 * Chapter 08 - what people say on the way out.
 *
 * Deliberately small and specific. Every quote names one concrete thing that
 * happened - a report arriving before lunch, a bill matching a quote - because
 * "excellent service, highly recommended" is what a review farm writes and
 * everybody knows it.
 *
 * THE REFERENCE SITE'S TESTIMONIAL CARD, TRANSLATED. Its card leads with the
 * person - a round portrait, then their name, then what they do - and puts the
 * testimony itself in an inset block filling the rest of the card. That order
 * is the whole idea: you decide whether a stranger's opinion is worth reading
 * by looking at the stranger first. The cards then sit in a swipe strip with
 * arrows rather than a grid, so they are read one at a time.
 *
 * WHERE IT DIFFERS. The reference insets a video thumbnail; ours insets the
 * quote, because these are things people said at a desk and we have no footage
 * of any of it. And the portrait is an initial rather than a photograph: these
 * are real patients, and inventing a face for one - or worse, buying a stock
 * one - would be the single most dishonest thing on this site.
 */
const STORIES: { quote: string; name: string; role: string }[] = [
  {
    quote:
      "The doctor already had my last visit open when I walked in. I didn't have to explain anything twice.",
    name: "Ramesh K.",
    role: "OPD patient",
  },
  {
    quote:
      "Blood test at 9, report on my phone before lunch. My father's diabetes review was done in one morning.",
    name: "Priya M.",
    role: "Attendant",
  },
  {
    quote:
      "They told me the ward rate before admission, and the discharge bill matched it to the rupee.",
    name: "Suresh V.",
    role: "IPD attendant",
  },
  {
    quote:
      "The pharmacist noticed the prescription was a day short and checked with the doctor before billing me.",
    name: "Lakshmi D.",
    role: "Pharmacy patient",
  },
  {
    quote: "Booked online for my mother at 8 in the morning - she was seen by 8:40.",
    name: "Anita R.",
    role: "Attendant",
  },
];

export function Testimonials() {
  const rail = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    // 2px of slack: sub-pixel widths mean scrollLeft rarely lands exactly on
    // the end, and an arrow that never greys out looks broken.
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  /** One card at a time, measured off a real card rather than a guess. */
  const page = (dir: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-story]");
    const step = card ? card.offsetWidth + 12 : Math.round(el.clientWidth * 0.8);
    el.scrollBy({
      left: dir * step,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

  return (
    <Chapter id="stories" tone="light" bleed>
      <div className="shell-w">
        <ChapterHead
          index="08"
          label="In their words"
          lines={[{ text: "What people tell us" }, { text: "on their way out." }]}
          lede="Kept short, and kept exactly as they said it at the desk."
        />
      </div>

      {/* full-bleed strip: the cards run off the right edge of the screen, which
          is the cue that there are more of them than fit */}
      <div
        ref={rail}
        className="nav-rail mt-12 flex snap-x snap-mandatory gap-3 overflow-x-auto px-[max(var(--shell-x),calc((100vw-var(--shell-max))/2))] sm:mt-16"
        style={{ scrollPaddingInline: "max(var(--shell-x), calc((100vw - var(--shell-max)) / 2))" }}
      >
        <Stagger each={0.07} y={24} className="flex gap-3">
          {STORIES.map((s) => (
            <Story key={s.name} {...s} />
          ))}
        </Stagger>
      </div>

      {/* the arrows, on the shell's own track so they line up with the head */}
      <div className="shell-w mt-8 flex items-center gap-3">
        <Arrow
          label="Previous"
          onClick={() => page(-1)}
          disabled={atStart}
          icon={<ArrowLeft className="h-4 w-4" />}
        />
        <Arrow
          label="Next"
          onClick={() => page(1)}
          disabled={atEnd}
          icon={<ArrowRight className="h-4 w-4" />}
        />
        <p className="mono ml-2 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
          {STORIES.length} notes · swipe or use the arrows
        </p>
      </div>
    </Chapter>
  );
}

/**
 * One card, in the reference's shape: the person at the top, the testimony in
 * an inset block below. White cell, 16px outside and 9px inside - the same
 * outer/inner pair the doctor and department cards use, so a card is a card
 * wherever you meet one on this site.
 */
function Story({ quote, name, role }: { quote: string; name: string; role: string }) {
  return (
    <figure
      data-story
      className="flex w-[80vw] shrink-0 snap-start flex-col rounded-[16px] bg-[var(--paper)] p-2.5 sm:w-[46vw] lg:w-[clamp(320px,26vw,384px)]"
    >
      <figcaption className="flex items-center gap-3.5 px-3 pb-4 pt-3">
        {/* an initial, not a face - see the note at the top of this file */}
        <span
          aria-hidden
          className="grid h-11 w-11 flex-none place-items-center rounded-full bg-[var(--teal-soft)] text-[15px] font-bold text-[var(--teal-deep)]"
        >
          {name[0]}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            {name}
          </span>
          <span className="mono mt-0.5 block truncate text-[9.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {role}
          </span>
        </span>
      </figcaption>

      <blockquote className="relative flex flex-1 flex-col justify-between gap-6 rounded-[9px] bg-[var(--bone)] p-5">
        <p className="text-[14.5px] leading-[1.65] text-[var(--ink)]">
          &ldquo;{quote}&rdquo;
        </p>
        <Quote
          aria-hidden
          className="h-5 w-5 self-end text-[var(--line-strong)]"
          strokeWidth={2.5}
        />
      </blockquote>
    </figure>
  );
}

function Arrow({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--ink)] transition-colors hover:border-[var(--teal)] hover:bg-[var(--teal)] hover:text-white disabled:pointer-events-none disabled:opacity-30"
    >
      {icon}
    </button>
  );
}
