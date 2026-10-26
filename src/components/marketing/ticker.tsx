import { DEPARTMENTS } from "@/lib/data";

/**
 * The department marquee.
 *
 * A quiet line of type under the hero, on the hero's own white, ruled top and
 * bottom by hairlines. It used to be a pine strip at display weight - the
 * loudest band on the page directly under the quietest one. Now it carries on
 * in the hero's voice: department names in Instrument Serif, every other one
 * in italic and a step lighter, so the line reads with a rhythm rather than as
 * a list. A small teal dot between them is the only colour.
 *
 * Two copies of the list, translated -50%, gives a seamless loop. It pauses on
 * hover, and prefers-reduced-motion stops it dead (see .ticker in site-theme).
 */
export function Ticker() {
  const items = [...DEPARTMENTS, ...DEPARTMENTS];

  return (
    <div className="ticker-wrap relative overflow-hidden border-y border-[var(--line)] bg-white py-5 sm:py-7">
      {/* the ends fade into the white rather than being cut off by the viewport */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-white to-transparent sm:w-40"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-white to-transparent sm:w-40"
      />

      {/* The visible copy is aria-hidden and the real list is read once, in
          order, by a screen reader - a duplicated marquee otherwise announces
          every department twice. */}
      <ul className="sr-only">
        {DEPARTMENTS.map((d) => (
          <li key={d.name}>{d.name}</li>
        ))}
      </ul>

      <div className="ticker" aria-hidden>
        {items.map((d, i) => (
          <span key={`${d.name}-${i}`} className="flex shrink-0 items-center">
            <span
              className={`f-serif px-6 text-[clamp(1.7rem,3.2vw,2.9rem)] leading-none tracking-[-0.01em] sm:px-10 ${
                i % 2 ? "italic text-[var(--muted)]" : "text-[var(--ink)]"
              }`}
            >
              {d.name}
            </span>
            <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--teal)]" />
          </span>
        ))}
      </div>
    </div>
  );
}
