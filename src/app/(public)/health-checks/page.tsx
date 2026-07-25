import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, Clock, Phone, Utensils } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/ui/reveal";
import { HEALTH_PACKAGES, HOSPITAL } from "@/lib/data";

export const metadata: Metadata = {
  title: "Health check packages & prices",
  description:
    "Health check-up packages at Jeeva Multispeciality Hospital, Hanamkonda - what each one includes and what it costs, published up front. Basic, full body, heart, women's health, diabetes and pre-employment checks.",
  alternates: { canonical: "/health-checks" },
};

/**
 * Health checks, priced on the page.
 *
 * Same argument as the room rates: the alternative is a family finding out at
 * the billing counter. Publishing the contents beside the price also stops the
 * commonest complaint about check-up packages - that nobody knew what was in
 * one until afterwards.
 */
export default function HealthChecksPage() {
  const phone = HOSPITAL.phone.replace(/\s/g, "");

  return (
    <div className="pb-8">
      <SectionHeading
        index="Health checks"
        title="Know what it costs before you come."
        subtitle="Six packages, every test listed, every price on the page. Book one at the desk or by phone - reports are explained by a doctor the same day, not posted to you."
      />

      <div className="mx-auto max-w-[1200px] px-5 pb-24 lg:px-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {HEALTH_PACKAGES.map((p, i) => (
            <Reveal key={p.slug} delay={Math.min(i, 5) * 60} className="min-w-0">
              <article
                className={`flex h-full flex-col rounded-[1.75rem] p-1.5 ring-1 ${
                  p.popular ? "bg-[var(--pine-ink)] ring-black/10" : "bg-[var(--peach-soft)] ring-black/5"
                }`}
              >
                <div className={`flex h-full flex-col rounded-[1.35rem] p-6 ${p.popular ? "bg-white/95" : "glass"}`}>
                  {p.popular && (
                    <span className="mb-3 self-start rounded-full bg-[var(--teal)] px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-white">
                      Most people pick this
                    </span>
                  )}

                  <h2 className="display text-[21px] text-[var(--ink)]">{p.name}</h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">{p.forWhom}</p>

                  <div className="mt-4 flex items-baseline gap-1.5">
                    <span className="font-mono text-[30px] font-bold leading-none text-[var(--teal)]">₹{p.price.toLocaleString("en-IN")}</span>
                    <span className="text-[12px] text-[var(--muted)]">all tests included</span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-2.5 py-1 text-[11px] text-[var(--ink-soft)]">
                      <Clock className="h-3 w-3" /> {p.duration}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-2.5 py-1 text-[11px] text-[var(--ink-soft)]">
                      <Utensils className="h-3 w-3" /> {p.fasting ? "Come fasting" : "No fasting"}
                    </span>
                  </div>

                  <ul className="mt-5 flex-1 space-y-1.5 border-t border-[var(--line)] pt-4">
                    {p.includes.map((t) => (
                      <li key={t} className="flex items-start gap-2 text-[13px] leading-snug text-[var(--ink-soft)]">
                        <Check className="mt-[3px] h-3.5 w-3.5 flex-none text-[var(--teal)]" aria-hidden />
                        {t}
                      </li>
                    ))}
                  </ul>

                  <a
                    href={`tel:${phone}`}
                    className="group mt-5 flex items-center justify-between gap-3 rounded-full bg-[var(--ink)] px-5 py-3 text-[13.5px] font-semibold text-white transition-colors hover:bg-black"
                  >
                    Book this check
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-white/15 transition-transform duration-200 group-hover:rotate-45">
                      <ArrowUpRight className="h-3 w-3" />
                    </span>
                  </a>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        {/* what happens on the day */}
        <Reveal delay={40}>
          <section className="mt-4 rounded-[1.75rem] bg-white p-6 ring-1 ring-black/5 sm:p-8">
            <h2 className="display text-[21px] text-[var(--ink)]">How a health check works here</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              <Step n="Before" text="Most checks need you fasting - nothing but water for 10 hours. Book by phone and come any morning; no appointment slot needed." />
              <Step n="At the hospital" text="Registration, then bloods first so the lab has them early. Scans and the physical examination follow while those run." />
              <Step n="Same day" text="Routine bloods come back in about 30 minutes, so a doctor sits with you and goes through the results before you leave." />
            </div>
            <p className="mt-6 rounded-[0.9rem] bg-[var(--teal-soft)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--teal-deep)]">
              Anything the check turns up is referred straight to the right department in this
              building - you won&apos;t be handed a report and left to work out who to see.
            </p>
          </section>
        </Reveal>

        <Reveal delay={60}>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[1.75rem] bg-[var(--bone-deep)] px-6 py-5">
            <p className="text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
              Not sure which one you need? The front desk will ask three questions and tell you.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <a href={`tel:${phone}`} className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2.5 text-[13.5px] font-semibold text-white">
                <Phone className="h-3.5 w-3.5" /> {HOSPITAL.phone}
              </a>
              <Link href="/doctors" className="inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-white px-5 py-2.5 text-[13.5px] font-semibold text-[var(--ink)]">
                See a doctor instead
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--teal)]">{n}</p>
      <p className="mt-2 text-[13.5px] leading-[1.7] text-[var(--ink-soft)]">{text}</p>
    </div>
  );
}
