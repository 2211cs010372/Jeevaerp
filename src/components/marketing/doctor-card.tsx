"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import type { Doctor } from "@/lib/data";
import { doctorHref } from "@/lib/doctors";

/**
 * The consultant card, in the reference site's people-card shape.
 *
 * A portrait at 3:4 filling a 10px-cornered cell, with a white pill floating
 * clear of the bottom edge carrying the name and the department. The reference
 * builds its card the same way: 10px outer, 10px padding, an 8px inner frame,
 * and a 5px pill inset 14px from the sides and foot.
 *
 * THE PORTRAIT IS THE POINT. A directory of consultants is scanned by face
 * before it is read by name - people recognise the doctor they saw last time
 * long before they recall how it was spelled. So the photograph gets the whole
 * cell and the type gets a pill, rather than the other way round.
 *
 * ONE DIFFERENCE FROM THE REFERENCE, DELIBERATELY. Its pill leads with a 44px
 * circular headshot beside the name. Ours does not: the face is already the
 * entire card behind it, and printing the same person twice in one card reads
 * as a mistake. The years-in-practice badge takes that slot instead, up on the
 * portrait where it does not squeeze the name.
 *
 * THE PILL OPENS ON HOVER. Specialisation, years in practice and age sit in a
 * panel that is closed until the pointer arrives, then grows the pill upward
 * over the portrait. Three reasons it is built this way and not another:
 *
 *   - The badge leaves as the panel arrives. "12 yrs" is printed on the
 *     portrait already, so the two would otherwise say the same thing twice
 *     with the panel open. Read it as the figure moving into the pill rather
 *     than as two separate animations.
 *   - The panel is real markup, not a tooltip. With JavaScript off nothing
 *     runs, the panel is never collapsed, and the card simply renders taller
 *     with every field visible - the same bargain the scroll primitives in
 *     motion.tsx make.
 *   - Under prefers-reduced-motion the effect installs nothing at all. The
 *     panel stays open, because a card that hides a doctor's specialisation
 *     behind an interaction the visitor has switched off would be worse than
 *     a card that is simply a little taller.
 *
 * A hover is a pointer's idea, so on a phone none of this fires - which is
 * why nothing here is unique to the card. Every field in the panel is also on
 * the consultant's profile, one tap away.
 *
 * No fee. Consultation prices are published on the doctor's own profile and in
 * the booking flow, not on the browsing card.
 */

/** useLayoutEffect that doesn't warn during SSR - as in motion.tsx. */
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function DoctorCard({ doctor: d }: { doctor: Doctor }) {
  const root = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLSpanElement>(null);

  useIsoLayoutEffect(() => {
    const card = root.current;
    const detail = panel.current;
    const chip = badge.current;
    if (!card || !detail || !chip) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.set(detail, { height: 0, autoAlpha: 0 });

      /* One paused timeline played forward and reversed, rather than a tween
         per event: a pointer crossing three cards in a second interrupts
         mid-open, and reversing an existing timeline picks up from wherever it
         got to instead of restarting from the closed state. */
      const tl = gsap
        .timeline({ paused: true, defaults: { ease: "power3.out" } })
        .to(detail, { height: "auto", autoAlpha: 1, duration: 0.42 }, 0)
        .to(chip, { autoAlpha: 0, y: -6, duration: 0.26 }, 0);

      const open = () => tl.play();
      const close = () => tl.reverse();

      /* focusin/focusout rather than focus/blur - they bubble, so a keyboard
         visitor tabbing onto the card gets the same panel a mouse does. */
      card.addEventListener("mouseenter", open);
      card.addEventListener("mouseleave", close);
      card.addEventListener("focusin", open);
      card.addEventListener("focusout", close);

      return () => {
        card.removeEventListener("mouseenter", open);
        card.removeEventListener("mouseleave", close);
        card.removeEventListener("focusin", open);
        card.removeEventListener("focusout", close);
      };
    }, card);

    return () => ctx.revert();
  }, []);

  return (
    <Link
      ref={root}
      href={doctorHref(d)}
      className="group block rounded-[10px] bg-[var(--bone)] p-2.5 transition-colors duration-300 hover:bg-[var(--bone-deep)]"
    >
      <div className="zoom-media relative aspect-[3/4] overflow-hidden rounded-[8px] bg-[var(--bone-deep)]">
        <DoctorAvatar
          name={d.name}
          image={d.image}
          className="h-full w-full text-3xl"
        />

        {/* years in practice - kept on the portrait so the pill below can give
            the whole of its width to a name that must not be truncated */}
        <span
          ref={badge}
          className="mono absolute left-3 top-3 z-10 rounded-full bg-black/40 px-2.5 py-1 text-[9.5px] uppercase tracking-[0.14em] text-white backdrop-blur"
        >
          {d.experience} yrs
        </span>

        {/* the reference's box_white: 5px corners, 8px of padding, sitting
            clear of the frame rather than flush to it */}
        <div className="absolute inset-x-3 bottom-3 z-10 rounded-[5px] bg-[var(--paper)] p-2">
          <h3 className="text-[12.5px] font-semibold leading-[1.25] tracking-[-0.02em] text-[var(--ink)] sm:text-[13.5px]">
            {d.name}
          </h3>
          <p className="mono mt-0.5 truncate text-[9px] uppercase tracking-[0.12em] text-[var(--muted)] sm:text-[9.5px]">
            {d.department}
          </p>

          {/* what the hover opens. `overflow-hidden` is what makes a height
              tween to `auto` clip rather than spill while it runs. */}
          <div ref={panel} className="overflow-hidden">
            <dl className="mt-1.5 border-t border-[var(--line)] pt-1.5">
              <dt className="sr-only">Specialisation</dt>
              <dd className="mono text-[9px] uppercase leading-[1.35] tracking-[0.1em] text-[var(--teal)]">
                {d.specialization}
              </dd>

              <dt className="sr-only">Experience and age</dt>
              <dd className="mt-1 text-[10.5px] leading-[1.4] text-[var(--ink-soft)]">
                {d.experience} yrs in practice · Age {d.age}
              </dd>
            </dl>
          </div>
        </div>
      </div>
    </Link>
  );
}
