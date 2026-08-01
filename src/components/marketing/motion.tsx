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
  /** Entry scale. 1 keeps the plain rise; below 1 blooms the child open. */
  scaleFrom = 1,
  start = "top 85%",
  style,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  each?: number;
  y?: number;
  scaleFrom?: number;
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
      gsap.set(kids, { opacity: 0, y, scale: scaleFrom });
      gsap.to(kids, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.9,
        ease: EASE,
        stagger: each,
        scrollTrigger: { trigger: el, start, once: true },
      });
    }, el);

    return () => ctx.revert();
  }, [each, y, scaleFrom, start]);

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
  /**
   * Fire on mount instead of on scroll. Required above the fold: a counter
   * that starts the page already past `top 92%` never gets an onEnter, so the
   * tween writes its opening 0 over the server-rendered value and stops there.
   * Same escape hatch SplitLead has, for the same reason.
   */
  immediate = false,
}: {
  value: number;
  suffix?: string;
  className?: string;
  duration?: number;
  immediate?: boolean;
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
        ...(immediate
          ? {}
          : { scrollTrigger: { trigger: el, start: "top 92%", once: true } }),
      });
    }, el);

    return () => ctx.revert();
  }, [value, duration, immediate]);

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
  /**
   * Turn on the depth choreography: the focus lens, the row weave, the media
   * parallax and the velocity skew described below. Off by default so a plain
   * rail stays a plain rail.
   */
  cinematic = false,
  /** Rendered inside the pinned shell but OUTSIDE the moving track - for a
   *  progress bar or a legend that should hold still while the cards travel. */
  overlay,
}: {
  children: ReactNode;
  className?: string;
  trackClassName?: string;
  ease?: number;
  cinematic?: boolean;
  overlay?: ReactNode;
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

      /* ── the choreography ──────────────────────────────────────────────
       *
       * FOUR MOVES, all driven off one number: where a card currently sits
       * across the screen. Nothing here reads the DOM per frame - every
       * element's position inside the track is measured once on setup and on
       * refresh, and the rest is arithmetic. Twenty-three cards updating on
       * every scrub frame is only cheap if it never touches layout.
       *
       *   LENS      a card at the centre of the screen is at full size and
       *             full contrast; one at either edge has receded. The rail
       *             gets a focal plane, so the eye is told where to look
       *             without anything being made louder.
       *   WEAVE     the two rows travel at slightly different rates, so they
       *             slide against each other instead of marching in lockstep.
       *             That is the difference between a rail and a conveyor.
       *   PARALLAX  each photograph drifts against its own frame as the card
       *             crosses the screen, which turns a square crop into a
       *             window with something behind it.
       *   SKEW      the whole track leans a degree or so into the scroll and
       *             springs back when it stops. Borrowed from the smooth-
       *             scroll idiom the rest of the site already uses.
       */
      /** One card, with everything needed to move it already resolved. */
      interface Cell {
        setScale: (v: number) => void;
        setFade: (v: number) => void;
        setMedia: (v: number) => void;
        /** Centre of the card, measured from the track's own left edge. */
        base: number;
        /** Which row it rides, so it can be given that row's drift. */
        row: number;
        el: HTMLElement;
        media: HTMLElement | null;
      }

      let cells: Cell[] = [];
      let rows: HTMLElement[] = [];
      let setRow: ((v: number) => void)[] = [];
      let setSkew: ((v: number) => void) | null = null;
      let trackOrigin = 0;
      let half = 1;
      let settle = 0;

      /** How far a row leans against its neighbour, at full travel. */
      const WEAVE = 70;
      const rowDrift = (row: number, progress: number) =>
        (row % 2 === 0 ? 1 : -1) * WEAVE * progress;

      const measure = () => {
        if (!cinematic) return;
        rows = Array.from(trackEl.children) as HTMLElement[];

        // Measure from a clean slate: the drift and the lean are transforms
        // this function's own output depends on, so leaving last frame's
        // values on the elements would fold them into the new baseline.
        gsap.set(trackEl, { skewX: 0 });
        rows.forEach((row) => gsap.set(row, { x: 0 }));

        const x = Number(gsap.getProperty(trackEl, "x")) || 0;
        // Where the track's left edge sits with x = 0, in screen space. The
        // shell is pinned, so this holds for the whole travel.
        const trackLeft = trackEl.getBoundingClientRect().left;
        trackOrigin = trackLeft - x;
        half = Math.max(1, window.innerWidth / 2);

        setRow = rows.map((row) => gsap.quickSetter(row, "x", "px") as (v: number) => void);
        setSkew = gsap.quickSetter(trackEl, "skewX", "deg") as (v: number) => void;

        cells = [];
        rows.forEach((row, ri) => {
          row.querySelectorAll<HTMLElement>(".rail-item").forEach((el) => {
            const r = el.getBoundingClientRect();
            const media = el.querySelector<HTMLElement>("[data-rail-media]");
            cells.push({
              el,
              media,
              row: ri,
              base: r.left - trackLeft + r.width / 2,
              setScale: gsap.quickSetter(el, "scale") as (v: number) => void,
              setFade: gsap.quickSetter(el, "opacity") as (v: number) => void,
              setMedia: media
                ? (gsap.quickSetter(media, "xPercent") as (v: number) => void)
                : () => {},
            });
          });
        });
      };

      const paint = (x: number, progress: number) => {
        if (!cinematic) return;

        // The weave. Small numbers on purpose - this is a shear between two
        // rows, not a second animation competing with the travel.
        for (let i = 0; i < rows.length; i++) setRow[i]?.(rowDrift(i, progress));

        for (const c of cells) {
          const centre = trackOrigin + x + c.base + rowDrift(c.row, progress);
          // -1 at the left edge of the screen, 0 dead centre, +1 at the right
          const off = (centre - half) / half;
          const away = Math.min(1, Math.abs(off));
          c.setScale(1 - 0.11 * away);
          c.setFade(1 - 0.42 * away);
          // Kept under the 6% of slack the overscaled picture has on each side
          // - any more and the drift would slide a hard edge into frame.
          c.setMedia(off * -4);
        }
      };

      measure();

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
          onRefresh: (self) => {
            measure();
            paint(Number(gsap.getProperty(trackEl, "x")) || 0, self.progress);
          },
          onUpdate: (self) => {
            shellEl.style.setProperty("--rail-progress", String(self.progress));
            paint(Number(gsap.getProperty(trackEl, "x")) || 0, self.progress);

            if (!setSkew) return;
            // getVelocity is the page scroll in px/second. A degree per
            // 1200px/s leans into the movement without reading as a glitch.
            setSkew(gsap.utils.clamp(-2.4, 2.4, self.getVelocity() / -1200));
            clearTimeout(settle);
            settle = window.setTimeout(() => {
              gsap.to(trackEl, { skewX: 0, duration: 0.7, ease: "elastic.out(1, 0.5)" });
            }, 90);
          },
        },
      });

      return () => {
        clearTimeout(settle);
        tween.kill();
        if (!cinematic) return;
        gsap.set(trackEl, { clearProps: "skewX" });
        rows.forEach((row) => gsap.set(row, { clearProps: "x" }));
        cells.forEach((c) => {
          gsap.set(c.el, { clearProps: "scale,opacity" });
          if (c.media) gsap.set(c.media, { clearProps: "xPercent" });
        });
      };
    });

    return () => mm.revert();
  }, [ease, cinematic]);

  return (
    <div ref={shell} className={className}>
      <div ref={track} className={trackClassName}>
        {children}
      </div>
      {overlay}
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
