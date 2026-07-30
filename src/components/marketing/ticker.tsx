import { DEPARTMENTS } from "@/lib/data";

/**
 * The department marquee.
 *
 * A pine strip immediately under the hero, running the eight department names
 * at display size. It does one job: the moment after the headline, prove there
 * is substance behind it. Names only, no photos - a marquee of thumbnails is
 * a slideshow, and nobody reads a slideshow.
 *
 * Two copies of the list, translated -50%, gives a seamless loop. It pauses on
 * hover, and prefers-reduced-motion stops it dead (see .ticker in site-theme).
 */
export function Ticker() {
  const items = [...DEPARTMENTS, ...DEPARTMENTS];

  return (
    <div className="ticker-wrap relative overflow-hidden bg-[var(--pine-ink)] py-5 sm:py-7">
      {/* the ends fade into the pine rather than being cut off by the viewport */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[var(--pine-ink)] to-transparent sm:w-32"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[var(--pine-ink)] to-transparent sm:w-32"
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
            <span className="display px-5 text-[clamp(1.05rem,1.9vw,1.65rem)] text-white/85 sm:px-8">
              {d.name}
            </span>
            <span className="text-[var(--teal-lift)]" aria-hidden>
              <svg width="11" height="11" viewBox="0 0 14 14">
                <path d="M5 0h4v5h5v4H9v5H5V9H0V5h5z" fill="currentColor" />
              </svg>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
