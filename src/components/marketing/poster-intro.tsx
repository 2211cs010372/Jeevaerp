import Link from "next/link";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { Reveal, SplitLead, type LeadLine } from "./motion";

/**
 * The opening of every homepage chapter, in the hero's voice.
 *
 * Three narrow Montserrat columns pinned to the 1.5rem edges - a numbered
 * label, a stacked aside, and a short paragraph with one ghost button - then
 * the one large Instrument Serif line, its second half in teal italic. Every
 * chapter opens on exactly this, which is what makes a scroll down the page
 * read as one designed piece and any single chapter, screenshotted on an
 * iPad, read as a poster in a series.
 *
 * Kept as one component so the type sizes and the spacing cannot drift
 * between chapters - they did, twice, while these were hand-copied.
 */
export function PosterIntro({
  index,
  label,
  aside,
  lede,
  action,
  lines,
  as = "h2",
}: {
  /** "01" - set as "(01) Label" */
  index: string;
  label: string;
  /** Short lines stacked in the second column. */
  aside: string[];
  lede: string;
  action?: { href: string; label: string; external?: boolean };
  /** The headline; give the last line `italic text-[var(--teal)]` for the accent. */
  lines: LeadLine[];
  /** "h1" at the top of a page of its own (the directory, a profile) - it
   *  also animates on mount there, since it starts above the fold. */
  as?: "h1" | "h2";
}) {
  const btn = action && (
    <>
      {action.label} <ArrowUpRight size={14} />
    </>
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-12">
        <Reveal y={10} className="text-[12.5px] font-medium text-[var(--muted)] md:col-span-3">
          ({index}) {label}
        </Reveal>

        <Reveal y={10} delay={0.08} className="text-[12.5px] font-medium leading-[1.4] text-[var(--muted)] md:col-span-3">
          {aside.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </Reveal>

        <Reveal y={14} delay={0.16} className="col-span-2 md:col-span-5 md:col-start-8 lg:col-span-4 lg:col-start-9">
          <p className="max-w-[36ch] text-[14px] font-medium leading-[1.15] text-[var(--ink)]">{lede}</p>
          {action && (
            <div className="mt-4">
              {action.external ? (
                <a href={action.href} target="_blank" rel="noreferrer" className="btn-ghost-sm">
                  {btn}
                </a>
              ) : (
                <Link href={action.href} className="btn-ghost-sm">
                  {btn}
                </Link>
              )}
            </div>
          )}
        </Reveal>
      </div>

      <SplitLead
        as={as}
        immediate={as === "h1"}
        className="f-serif mt-[clamp(2rem,4.5vw,3.5rem)] text-[clamp(2.5rem,4.8vw,4.6rem)] leading-[0.95] tracking-[-0.02em] text-[var(--ink)]"
        lines={lines}
      />
    </>
  );
}

/** The chapter shell every homepage section after the hero sits in. */
export const POSTER_SECTION =
  "f-sans scroll-mt-[var(--nav-h)] bg-white px-[1.5rem] py-[clamp(3.5rem,7vw,6rem)]";
