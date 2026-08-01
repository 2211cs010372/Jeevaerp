"use client";

import { useEffect, useState } from "react";

/**
 * The profile's section index - the reference site's sticky left rail, doing
 * something useful.
 *
 * The reference sticks 75px of share buttons beside a long article. A doctor's
 * profile is longer than any article on it and asks harder questions, so the
 * rail carries the contents instead: where you are in the profile, and one
 * click to any other part of it.
 *
 * THIS is what may be sticky, and the booking panel is not. A sticky element
 * taller than the viewport strands its own last row permanently off-screen -
 * which for a booking form means an unreachable submit button. Nine short
 * links fit in any laptop viewport; a slot picker does not.
 *
 * Anchor clicks are handled globally by SmoothScroll, which glides through
 * Lenis with an offset for the fixed header. Nothing here intercepts them, so
 * with JavaScript off the rail degrades to a list of working jump links.
 */

export interface ProfileSection {
  id: string;
  label: string;
}

export function DoctorIndex({ sections }: { sections: ProfileSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;

    // A reading band across the upper third of the viewport, not the whole of
    // it: with the full height, a short section sandwiched between two long
    // ones never wins the comparison and its label never lights up.
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen[0]) setActive(seen[0].target.id);
      },
      { rootMargin: "-18% 0px -66% 0px", threshold: 0 },
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  return (
    // `self-start` is load-bearing, not tidiness. As a grid child this nav
    // stretches to the height of the tallest cell in its row by default - all
    // 5,000-odd pixels of the profile beside it - and a sticky element as tall
    // as its own container has nowhere to stick to, so it silently does
    // nothing. Shrinking it to its content is what turns the rail on.
    <nav
      aria-label="Sections of this profile"
      className="lg:sticky lg:top-[calc(var(--nav-h)-10px)] lg:self-start"
    >
      <p className="mono hidden text-[9.5px] uppercase tracking-[0.18em] text-[var(--muted)] lg:block">
        In this profile
      </p>

      {/* Below lg the rail lies down and becomes a swipe strip - a vertical
          contents list above the content it indexes would just be a wall. */}
      <ul className="nav-rail -mx-[var(--shell-x)] mt-0 flex gap-2 overflow-x-auto px-[var(--shell-x)] lg:mx-0 lg:mt-4 lg:block lg:space-y-0.5 lg:overflow-visible lg:px-0">
        {sections.map((s) => {
          const on = active === s.id;
          return (
            <li key={s.id} className="flex-none lg:flex-auto">
              <a
                href={`#${s.id}`}
                aria-current={on ? "location" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[12.5px] transition-colors lg:whitespace-normal lg:rounded-[8px] lg:py-[7px] ${
                  on
                    ? "bg-[var(--teal-soft)] font-semibold text-[var(--teal-deep)] lg:bg-transparent"
                    : "text-[var(--muted)] hover:bg-[var(--bone-deep)] hover:text-[var(--ink)] lg:hover:bg-transparent lg:hover:text-[var(--teal)]"
                }`}
              >
                <span
                  aria-hidden
                  className={`hidden h-px flex-none transition-all duration-300 lg:block ${
                    on ? "w-5 bg-[var(--teal)]" : "w-2.5 bg-[var(--line-strong)]"
                  }`}
                />
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
