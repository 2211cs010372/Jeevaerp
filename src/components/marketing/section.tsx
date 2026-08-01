import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Reveal, SplitLead, type LeadLine } from "./motion";

/**
 * The sectioning system.
 *
 * Every band on the public site is a <Chapter>, and every chapter opens with
 * the same three-part header: a mono index, a label on a hairline rule, and a
 * display headline. That repetition is the point - a visitor who has scrolled
 * past two chapters knows, without reading, that a new one has started and
 * roughly how far down the page they are.
 *
 * Tone is what carries the contrast rhythm the homepage is built on:
 *
 *   light   porcelain canvas, the default
 *   paper   white, for chapters that are mostly cards
 *   dark    full-bleed pine. A change of room, used sparingly and always
 *           for the emotional beats: what we believe, who treats you,
 *           and what it costs.
 *
 * Nothing here is animated by itself. Motion comes from the primitives in
 * motion.tsx, which the header composes - so a chapter renders correctly with
 * JavaScript switched off.
 */

export type Tone = "light" | "paper" | "dark";

const TONE_BG: Record<Tone, string> = {
  light: "bg-[var(--bone)]",
  paper: "bg-[var(--paper)]",
  dark: "bg-[var(--pine-ink)] text-white",
};

export function Chapter({
  id,
  tone = "light",
  className = "",
  bleed = false,
  children,
  style,
}: {
  id?: string;
  tone?: Tone;
  className?: string;
  /** Skip the inner container - the chapter manages its own full-bleed layout. */
  bleed?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      id={id}
      data-tone={tone}
      style={style}
      className={`chapter relative isolate ${TONE_BG[tone]} ${className}`}
    >
      {bleed ? children : <div className="shell-w">{children}</div>}
    </section>
  );
}

/**
 * The chapter header. Two rows:
 *
 *   ── (01) ───────────────────────────────── THE CARE MODEL ──
 *   Registered once.                    Lede paragraph sits in the
 *   Known ever after.                   right column, one third wide.
 *                                       [ optional action ]
 *
 * The asymmetry is deliberate. A centred headline over a centred paragraph is
 * the single most common shape on the internet; an off-axis lede reads as
 * something a person laid out.
 */
export function ChapterHead({
  index,
  label,
  lines,
  lede,
  action,
  tone = "light",
  align = "split",
  className = "",
  id,
}: {
  /** "01" - the mono chapter number. */
  index: string;
  /** "The care model" - set in the rule. */
  label: string;
  /** The display headline, one entry per line. */
  lines: LeadLine[];
  lede?: string;
  action?: { href: string; label: string };
  tone?: Tone;
  /** `split` puts the lede beside the headline; `stack` puts it beneath. */
  align?: "split" | "stack";
  className?: string;
  /** Heading id, when something needs to point at it with aria-labelledby. */
  id?: string;
}) {
  const dark = tone === "dark";

  return (
    <header className={`chapter-head ${className}`}>
      <Reveal className={`rule-row ${dark ? "rule-row-dark" : ""}`} y={14}>
        <span className="rule-idx">({index})</span>
        <span className="rule-line" />
        <span className="rule-label">{label}</span>
      </Reveal>

      <div
        className={
          align === "split"
            ? "mt-8 grid gap-x-12 gap-y-7 sm:mt-11 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-end"
            : "mt-8 sm:mt-11"
        }
      >
        <SplitLead
          id={id}
          as="h3"
          lines={lines}
          className={`display-lead md:text-[5vw] text-[7vw] ${dark ? "text-white" : "text-[var(--ink)]"}`}
        />

        {(lede || action) && (
          <div className={align === "stack" ? "mt-6 max-w-[54ch]" : "lg:pb-2"}>
            {lede && (
              <Reveal
                as="p"
                delay={0.08}
                y={18}
                className={`lede ${dark ? "text-white/70" : "text-[var(--ink-soft)]"}`}
              >
                {lede}
              </Reveal>
            )}
            {action && (
              <Reveal delay={0.16} y={14} className="mt-6">
                <Link
                  href={action.href}
                  className={`link-arrow ${dark ? "link-arrow-dark" : ""}`}
                >
                  {action.label}
                  <span className="link-arrow-dot">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              </Reveal>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

/** A hairline with an optional label - for dividing content inside a chapter. */
export function Rule({
  label,
  dark = false,
  className = "",
}: {
  label?: string;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div className={`rule-row ${dark ? "rule-row-dark" : ""} ${className}`}>
      <span className="rule-line" />
      {label && <span className="rule-label">{label}</span>}
    </div>
  );
}
