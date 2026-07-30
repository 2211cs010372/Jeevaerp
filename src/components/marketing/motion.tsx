"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * The motion layer for the public site.
 *
 * Design rule behind every primitive here: THE PAGE MUST BE READABLE WITHOUT
 * JAVASCRIPT. Nothing sets an element to opacity:0 in CSS. The hidden starting
 * state is applied by `gsap.set()` inside a layout effect - which runs after
 * hydration but before the browser paints - so a no-JS visitor gets plain,
 * fully visible text and a JS visitor never sees a flash of unstyled content.
 * A hospital site that renders blank because a CDN dropped one bundle is not
 * a design decision, it is an outage.
 *
 * Second rule: prefers-reduced-motion is checked once per primitive and, when
 * set, the primitive renders its final state and installs no ScrollTrigger at
 * all. No half-speed compromise - people who ask for stillness get stillness.
 */

gsap.registerPlugin(ScrollTrigger);

/** useLayoutEffect that doesn't warn during SSR. */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const EASE = "power3.out";

function prefersReduced() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Live version, for components that branch on it during render. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/* ══════════════════════════════════════════════════════════════════════════
   REVEAL - the workhorse. A short rise + fade as the element enters.
   ══════════════════════════════════════════════════════════════════════════ */

export function Reveal({
  children,
  as: Tag = "div",
  className,
  delay = 0,
  y = 26,
  blur = false,
  start = "top 88%",
  style,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Seconds. Use for hand-tuned pairs, not for lists - see Stagger. */
  delay?: number;
  y?: number;
  /** Adds a small defocus to the entry. Reserve for hero-adjacent moments. */
  blur?: boolean;
  start?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;

    const ctx = gsap.context(() => {
      gsap.set(el, { opacity: 0, y, filter: blur ? "blur(8px)" : "none" });
      gsap.to(el, {
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
        duration: 0.95,
        delay,
        ease: EASE,
        scrollTrigger: { trigger: el, start, once: true },
      });
    }, el);

    return () => ctx.revert();
  }, [delay, y, blur, start]);

  return (
    <Tag ref={ref} className={className} style={style}>
      {children}
    </Tag>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   STAGGER - reveals direct children in sequence. One ScrollTrigger for a
   whole grid instead of one per card, which matters on the doctors page
   where there are forty of them.
   ══════════════════════════════════════════════════════════════════════════ */

export function Stagger({
  children,
  as: Tag = "div",
  className,
  each = 0.08,
  y = 30,
  start = "top 85%",
  style,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  each?: number;
  y?: number;
  start?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;

    const kids = Array.from(el.children) as HTMLElement[];
    if (!kids.length) return;

    const ctx = gsap.context(() => {
      gsap.set(kids, { opacity: 0, y });
      gsap.to(kids, {
        opacity: 1,
        y: 0,
        duration: 0.9,
        ease: EASE,
        stagger: each,
        scrollTrigger: { trigger: el, start, once: true },
      });
    }, el);

    return () => ctx.revert();
  }, [each, y, start]);

  return (
    <Tag ref={ref} className={className} style={style}>
      {children}
    </Tag>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SPLIT LEAD - the signature headline move. Each word rides up out of a
   mask, line by line. Words are split on the SERVER, so the headline is in
   the HTML as real text for crawlers and for anyone without JS.
   ══════════════════════════════════════════════════════════════════════════ */

export interface LeadLine {
  text: string;
  className?: string;
}

export function SplitLead({
  lines,
  as: Tag = "h2",
  className,
  delay = 0,
  /** Fire immediately on mount instead of on scroll. For above-the-fold copy. */
  immediate = false,
  style,
  id,
}: {
  lines: LeadLine[];
  as?: ElementType;
  className?: string;
  delay?: number;
  immediate?: boolean;
  style?: CSSProperties;
  id?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;

    const words = el.querySelectorAll<HTMLElement>("[data-word]");
    if (!words.length) return;

    const ctx = gsap.context(() => {
      gsap.set(words, { yPercent: 126, opacity: 0 });
      gsap.to(words, {
        yPercent: 0,
        opacity: 1,
        duration: 1.05,
        delay,
        ease: "expo.out",
        stagger: 0.055,
        ...(immediate
          ? {}
          : { scrollTrigger: { trigger: el, start: "top 86%", once: true } }),
      });
    }, el);

    return () => ctx.revert();
  }, [delay, immediate]);

  return (
    <Tag ref={ref} id={id} className={className} style={style}>
      {lines.map((line, li) => (
        <span key={li} className={`split-line ${line.className ?? ""}`}>
          {line.text.split(" ").map((word, wi, all) => (
            // The space lives BETWEEN the masks, never inside one: a space
            // inside an overflow:hidden box widens the mask by a space, and
            // the gaps then grow with the type until words look kerned apart.
            <Fragment key={wi}>
              <span className="split-mask">
                <span data-word className="split-word">
                  {word}
                </span>
              </span>
              {wi < all.length - 1 ? " " : null}
            </Fragment>
          ))}
        </span>
      ))}
    </Tag>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SCRUB TEXT - a paragraph whose words light up as you scroll through it.
   The manifesto move. Used once per page, in a dark room, or it stops
   meaning anything.
   ══════════════════════════════════════════════════════════════════════════ */

export function ScrubText({
  text,
  as: Tag = "p",
  className,
  dim = 0.2,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  /** Opacity of a word that hasn't been reached yet. */
  dim?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;

    const words = el.querySelectorAll<HTMLElement>("[data-word]");
    if (!words.length) return;

    const ctx = gsap.context(() => {
      gsap.set(words, { opacity: dim });
      gsap.to(words, {
        opacity: 1,
        ease: "none",
        stagger: 0.5,
        scrollTrigger: {
          trigger: el,
          start: "top 78%",
          end: "bottom 58%",
          scrub: 0.6,
        },
      });
    }, el);

    return () => ctx.revert();
  }, [dim]);

  return (
    <Tag ref={ref} className={className}>
      {text.split(" ").map((word, i) => (
        <span key={i} data-word className="scrub-word">
          {word}{" "}
        </span>
      ))}
    </Tag>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PARALLAX - media that drifts against the scroll. Small numbers only;
   anything over ~14% starts to read as a bug rather than depth.
   ══════════════════════════════════════════════════════════════════════════ */

export function Parallax({
  children,
  className,
  /** Percentage of the element's height to travel across the whole scroll. */
  amount = 12,
  style,
}: {
  children: ReactNode;
  className?: string;
  amount?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { yPercent: -amount / 2 },
        {
          yPercent: amount / 2,
          ease: "none",
          scrollTrigger: {
            trigger: el.parentElement ?? el,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        },
      );
    }, el);

    return () => ctx.revert();
  }, [amount]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   COUNTER - a number that counts to its value once, on entry.
   Tabular figures in CSS, so the layout doesn't jitter while it runs.
   ══════════════════════════════════════════════════════════════════════════ */

export function Counter({
  value,
  suffix = "",
  className,
  duration = 1.9,
}: {
  value: number;
  suffix?: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;

    const ctx = gsap.context(() => {
      const box = { n: 0 };
      gsap.to(box, {
        n: value,
        duration,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = String(Math.round(box.n));
        },
        scrollTrigger: { trigger: el, start: "top 92%", once: true },
      });
    }, el);

    return () => ctx.revert();
  }, [value, duration]);

  return (
    <span className={className}>
      {/* server-rendered as the final value: correct without JS, correct for
          a crawler, and the count-up simply overwrites it on hydration */}
      <span ref={ref} className="tabular">
        {value}
      </span>
      {suffix}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAGNETIC - a control that leans toward the cursor. Pointer-fine only:
   on a touch screen there is no cursor to lean towards, and the transform
   just makes the tap target drift.
   ══════════════════════════════════════════════════════════════════════════ */

export function Magnetic({
  children,
  className,
  strength = 0.32,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const target = el.firstElementChild as HTMLElement | null;
    if (!target) return;

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      gsap.to(target, {
        x: (e.clientX - (r.left + r.width / 2)) * strength,
        y: (e.clientY - (r.top + r.height / 2)) * strength,
        duration: 0.5,
        ease: "power3.out",
      });
    };
    const leave = () =>
      gsap.to(target, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.4)" });

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(target);
    };
  }, [strength]);

  return (
    <span ref={ref} className={`magnetic ${className ?? ""}`}>
      {children}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PINNED RAIL - the section that holds still while its contents travel
   sideways. The one genuinely cinematic move on the page.

   Disabled below 1024px on purpose: hijacking vertical scroll on a phone
   fights the gesture the user already made, and traps people who are trying
   to get past the section to the phone number.
   ══════════════════════════════════════════════════════════════════════════ */

export function PinnedRail({
  children,
  className,
  trackClassName,
  /** Extra scroll distance, as a multiple of the horizontal overflow. */
  ease = 1,
}: {
  children: ReactNode;
  className?: string;
  trackClassName?: string;
  ease?: number;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const shellEl = shell.current;
    const trackEl = track.current;
    if (!shellEl || !trackEl || prefersReduced()) return;

    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px)", () => {
      const distance = () => trackEl.scrollWidth - shellEl.clientWidth;
      if (distance() <= 0) return;

      const tween = gsap.to(trackEl, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: shellEl,
          start: "top top",
          end: () => `+=${distance() * ease}`,
          pin: true,
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });
      return () => tween.kill();
    });

    return () => mm.revert();
  }, [ease]);

  return (
    <div ref={shell} className={className}>
      <div ref={track} className={trackClassName}>
        {children}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CURTAIN - a panel that lifts its own scale/radius as it enters. Used for
   the full-bleed dark rooms so a section change reads as a change of room,
   not just a change of background colour.
   ══════════════════════════════════════════════════════════════════════════ */

export function Curtain({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { scaleX: 0.93, borderRadius: 72 },
        {
          scaleX: 1,
          borderRadius: 0,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "top 55%",
            scrub: 0.7,
          },
        },
      );
    }, el);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
