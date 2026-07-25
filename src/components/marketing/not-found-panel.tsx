import Link from "next/link";
import { ArrowUpRight, Phone } from "lucide-react";
import { HOSPITAL, CARE_AREAS } from "@/lib/data";

/**
 * The 404.
 *
 * A dead end on a hospital site is worse than on most: the person is often
 * anxious, on a phone, and following a link someone sent them. So this doesn't
 * apologise or joke - it says plainly that the page is gone and puts the three
 * things they were probably looking for one tap away, plus the phone number,
 * because at that point calling is the fastest route to an answer.
 */
export function NotFoundPanel() {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 pt-28 lg:px-8 lg:pt-36">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-[1.75rem] bg-[var(--peach-soft)] p-1.5 ring-1 ring-black/5">
          <div className="glass rounded-[1.35rem] p-7 sm:p-10">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
              Page not found
            </p>
            <h1 className="display mt-3 text-[clamp(1.9rem,4vw,2.8rem)] text-[var(--ink)]">
              That page isn&apos;t here.
            </h1>
            <p className="mt-3 max-w-md text-[15px] leading-[1.75] text-[var(--ink-soft)]">
              The link may be old, or the address mistyped. Nothing is wrong with your
              appointment or your records - this is only a missing page.
            </p>

            <div className="mt-7 flex flex-wrap gap-2.5">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-black"
              >
                Back to home
              </Link>
              <Link
                href="/doctors"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-white px-5 py-3 text-[14px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]"
              >
                Find a doctor <ArrowUpRight className="h-4 w-4" />
              </Link>
              <a
                href={`tel:${emergency}`}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--alert)]/30 bg-[var(--alert-soft)] px-5 py-3 text-[14px] font-semibold text-[var(--alert)]"
              >
                <Phone className="h-4 w-4" /> Call 24×7
              </a>
            </div>
          </div>
        </div>

        {/* the doors, so this page still gets someone where they were going */}
        <div className="rounded-[1.75rem] bg-white p-1.5 ring-1 ring-black/5">
          <div className="rounded-[1.35rem] p-6">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
              Looking for care?
            </p>
            <div className="mt-3 grid gap-1.5">
              {CARE_AREAS.map((a) => (
                <Link
                  key={a.label}
                  href={`/care/${slugify(a.departments[0])}`}
                  className="group flex items-center justify-between gap-3 rounded-[0.9rem] px-3.5 py-2.5 transition-colors hover:bg-[var(--bone)]"
                >
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-[var(--ink)]">{a.label}</span>
                    <span className="block truncate text-[11.5px] text-[var(--muted)]">{a.blurb}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--muted)] transition-colors group-hover:text-[var(--teal)]" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "General Medicine" -> "general-medicine". Mirrors src/lib/care.ts. */
function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
