import type { ReactNode } from "react";
import { Reveal, SplitLead } from "@/components/marketing/motion";

/**
 * The inner-page masthead.
 *
 * Every public route that isn't the homepage opens on this: a full-bleed pine
 * band carrying a rule row, a split display headline and a lede. It does three
 * jobs at once.
 *
 *   1. It gives the fixed navbar something dark to sit on, so the header's
 *      porcelain shell reads as a header rather than as the top of the page.
 *   2. It matches the homepage's dark rooms, which is what makes /doctors and
 *      /book feel like the same publication rather than two templates.
 *   3. It gets the page's one h1 above the fold at display size, with the lede
 *      beside it rather than under it - the same off-axis shape the homepage
 *      chapters use.
 *
 * `title` is split on the newline so a caller can control where the headline
 * breaks; a single-line title just renders as one line.
 */
export function SectionHeading({
  index,
  title,
  subtitle,
  meta,
}: {
  /** The mono label set into the rule - "Our doctors", "Health checks". */
  index?: string;
  /** Use "\n" to control the line break. */
  title: string;
  subtitle?: string;
  /** Optional facts row under the lede - counts, hours, prices. */
  meta?: ReactNode;
}) {
  const lines = title.split("\n").map((text) => ({ text }));

  return (
    <header className="relative isolate overflow-hidden bg-[var(--pine-ink)] below-nav pb-14 text-white lg:pb-20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(115%_85%_at_18%_-10%,rgba(23,112,95,0.3),transparent_62%)]"
      />

      <div className="shell-w">
        {index && (
          <Reveal className="rule-row rule-row-dark" y={12}>
            <span className="rule-idx">(—)</span>
            <span className="rule-line" />
            <span className="rule-label">{index}</span>
          </Reveal>
        )}

        <div className="mt-9 grid gap-x-12 gap-y-7 sm:mt-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
          <SplitLead as="h1" immediate delay={0.08} className="display-lead text-white" lines={lines} />

          {(subtitle || meta) && (
            <div className="lg:pb-2">
              {subtitle && (
                <Reveal as="p" delay={0.3} y={18} className="lede text-white/65">
                  {subtitle}
                </Reveal>
              )}
              {meta && (
                <Reveal delay={0.38} y={14} className="mt-6 flex flex-wrap gap-2">
                  {meta}
                </Reveal>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
