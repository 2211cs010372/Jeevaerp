import Link from "next/link";
import { ArrowUpRight, Phone } from "lucide-react";
import { HOSPITAL, CARE_AREAS } from "@/lib/data";
import { careHref } from "@/lib/care";
import { Reveal, SplitLead, Stagger } from "./motion";

/**
 * The 404.
 *
 * A dead end on a hospital site is worse than on most: the person is often
 * anxious, on a phone, and following a link someone sent them. So this doesn't
 * apologise or joke - it says plainly that the page is gone, reassures them
 * that nothing has happened to their appointment or their records, and puts
 * the things they were probably looking for one tap away.
 *
 * Set as a pine room rather than a porcelain card, for the same reason the
 * inner-page mastheads are: it is unmistakably a different kind of page, and
 * it gives the fixed navbar something to sit on.
 */
export function NotFoundPanel() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <div className="bg-[var(--bone)]">
      <section className="relative isolate overflow-hidden bg-[var(--pine-ink)] below-nav pb-16 text-white lg:pb-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(115%_85%_at_18%_-10%,rgba(23,112,95,0.3),transparent_62%)]"
        />

        <div className="shell-w">
          <div className="rule-row rule-row-dark">
            <span className="rule-idx">(404)</span>
            <span className="rule-line" />
            <span className="rule-label">Page not found</span>
          </div>

          <div className="mt-10 grid gap-x-12 gap-y-8 sm:mt-14 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
            <SplitLead
              as="h1"
              immediate
              delay={0.08}
              className="display-lead text-white"
              lines={[{ text: "That page" }, { text: "isn't here." }]}
            />

            <div className="lg:pb-2">
              <Reveal as="p" delay={0.3} y={18} className="lede text-white/65">
                The link may be old, or the address mistyped. Nothing has happened to your
                appointment or your records - this is only a missing page.
              </Reveal>

              <Reveal delay={0.38} y={16} className="mt-8 flex flex-wrap gap-2.5">
                <Link href="/" className="btn btn-light">
                  Back to home
                </Link>
                <Link href="/doctors" className="btn btn-ghost-dark">
                  Find a doctor <ArrowUpRight className="h-4 w-4" />
                </Link>
                <a href={`tel:${emergency}`} className="btn btn-alert">
                  <Phone className="h-4 w-4" /> Call 24×7
                </a>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* the doors, so this page still gets someone where they were going */}
      <section className="shell-w py-14 sm:py-20">
        <div className="rule-row">
          <span className="rule-idx">(→)</span>
          <span className="rule-line" />
          <span className="rule-label">Looking for care?</span>
        </div>

        <Stagger
          each={0.07}
          y={20}
          className="mt-10 grid border-t border-[var(--line-strong)] sm:grid-cols-2 lg:grid-cols-3"
        >
          {CARE_AREAS.map((a) => (
            <Link
              key={a.label}
              href={careHref(a.departments[0])}
              className="group flex items-start justify-between gap-4 border-b border-[var(--line)] px-1 py-6 transition-colors hover:bg-[var(--paper)] sm:px-6 lg:border-l lg:first:border-l-0"
            >
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                  {a.label}
                </span>
                <span className="mt-1.5 block text-[12.5px] leading-snug text-[var(--muted)]">
                  {a.blurb}
                </span>
              </span>
              <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)] transition-all duration-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--teal)]" />
            </Link>
          ))}
        </Stagger>
      </section>
    </div>
  );
}
