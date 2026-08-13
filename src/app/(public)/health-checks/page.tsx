import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, Clock, Phone, Utensils } from "@/components/ui/hugeicons";
import { SectionHeading } from "@/components/ui/section-heading";
import { Chapter, ChapterHead } from "@/components/marketing/section";
import { Reveal, Stagger } from "@/components/marketing/motion";
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
 *
 * The one package marked `popular` gets the pine card. Everything else is
 * porcelain, so "most people pick this" is carried by the material rather than
 * by a badge shouting it.
 */
export default function HealthChecksPage() {
  const phone = HOSPITAL.phone.replace(/\s/g, "");
  const cheapest = Math.min(...HEALTH_PACKAGES.map((p) => p.price));

  return (
    <div className="bg-[var(--bone)]">
      <SectionHeading
        index="Health checks"
        title={"Know what it costs\nbefore you come."}
        subtitle="Six packages, every test listed, every price on the page. Book one at the desk or by phone - reports are explained by a doctor the same day, not posted to you."
        meta={
          <>
            <span className="chip chip-dark">{HEALTH_PACKAGES.length} packages</span>
            <span className="chip chip-dark">From ₹{cheapest.toLocaleString("en-IN")}</span>
            <span className="chip chip-dark">Reports same day</span>
          </>
        }
      />

      <Chapter tone="light" className="chapter-flush-t pt-14 sm:pt-18">
        <Stagger each={0.07} y={26} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {HEALTH_PACKAGES.map((p) => {
            const dark = !!p.popular;
            return (
              <article
                key={p.slug}
                className={`flex h-full min-w-0 flex-col rounded-[var(--r-xl)] p-7 ${
                  dark
                    ? "bg-[var(--pine-ink)] text-white"
                    : "border border-[var(--line)] bg-[var(--paper)]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className={`display-sm ${dark ? "text-white" : "text-[var(--ink)]"}`}>
                    {p.name}
                  </h2>
                  {dark && (
                    <span className="mono shrink-0 rounded-full bg-[var(--teal)] px-2.5 py-1 text-[9px] uppercase tracking-[0.14em] text-white">
                      Most picked
                    </span>
                  )}
                </div>

                <p
                  className={`mt-2.5 text-[13px] leading-[1.65] ${
                    dark ? "text-white/60" : "text-[var(--muted)]"
                  }`}
                >
                  {p.forWhom}
                </p>

                <p
                  className={`mono mt-6 text-[clamp(1.8rem,3vw,2.3rem)] font-semibold tabular leading-none ${
                    dark ? "text-white" : "text-[var(--ink)]"
                  }`}
                >
                  ₹{p.price.toLocaleString("en-IN")}
                  <span
                    className={`ml-2 text-[12px] font-normal ${
                      dark ? "text-white/45" : "text-[var(--muted)]"
                    }`}
                  >
                    all tests included
                  </span>
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  <span className={`chip !py-1.5 !text-[10.5px] ${dark ? "chip-dark" : ""}`}>
                    <Clock className="h-3 w-3" /> {p.duration}
                  </span>
                  <span className={`chip !py-1.5 !text-[10.5px] ${dark ? "chip-dark" : ""}`}>
                    <Utensils className="h-3 w-3" /> {p.fasting ? "Come fasting" : "No fasting"}
                  </span>
                </div>

                <ul
                  className={`mt-6 flex-1 space-y-2 border-t pt-6 ${
                    dark ? "border-white/12" : "border-[var(--line)]"
                  }`}
                >
                  {p.includes.map((t) => (
                    <li
                      key={t}
                      className={`flex items-start gap-2.5 text-[13px] leading-snug ${
                        dark ? "text-white/70" : "text-[var(--ink-soft)]"
                      }`}
                    >
                      <Check
                        className={`mt-[3px] h-3.5 w-3.5 flex-none ${
                          dark ? "text-[var(--teal-tint)]" : "text-[var(--teal)]"
                        }`}
                        aria-hidden
                      />
                      {t}
                    </li>
                  ))}
                </ul>

                <a
                  href={`tel:${phone}`}
                  className={`btn mt-7 w-full ${dark ? "btn-light" : "btn-solid"}`}
                >
                  Book this check <ArrowUpRight className="h-4 w-4" />
                </a>
              </article>
            );
          })}
        </Stagger>
      </Chapter>

      {/* what happens on the day */}
      <Chapter tone="paper">
        <ChapterHead
          index="01"
          label="On the day"
          lines={[{ text: "How a health check" }, { text: "actually runs." }]}
          lede="No appointment slot needed. Come any morning, fasting, and plan on being here for the time listed on your package."
        />

        <Stagger
          as="ol"
          each={0.1}
          y={24}
          className="mt-14 grid gap-x-10 border-t border-[var(--line-strong)] sm:mt-18 sm:grid-cols-3"
        >
          <Step
            n="Before"
            text="Most checks need you fasting - nothing but water for 10 hours. Book by phone and come any morning; no appointment slot needed."
          />
          <Step
            n="At the hospital"
            text="Registration, then bloods first so the lab has them early. Scans and the physical examination follow while those run."
          />
          <Step
            n="Same day"
            text="Routine bloods come back in about 30 minutes, so a doctor sits with you and goes through the results before you leave."
          />
        </Stagger>

        <Reveal className="mt-10" y={16}>
          <p className="max-w-3xl rounded-[var(--r-md)] bg-[var(--teal-soft)] px-6 py-5 text-[14px] leading-[1.7] text-[var(--teal-deep)]">
            Anything the check turns up is referred straight to the right department in
            this building. You will not be handed a report and left to work out who to see.
          </p>
        </Reveal>

        <Reveal className="mt-4" y={16}>
          <div className="flex flex-wrap items-center justify-between gap-5 rounded-[var(--r-xl)] bg-[var(--bone-deep)] px-6 py-6 sm:px-8">
            <p className="max-w-md text-[14.5px] leading-[1.6] text-[var(--ink-soft)]">
              Not sure which one you need? The front desk will ask three questions and
              tell you.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <a href={`tel:${phone}`} className="btn btn-solid">
                <Phone className="h-3.5 w-3.5" /> {HOSPITAL.phone}
              </a>
              <Link href="/doctors" className="btn btn-ghost">
                See a doctor instead
              </Link>
            </div>
          </div>
        </Reveal>
      </Chapter>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <li className="border-b border-[var(--line)] py-8 sm:border-b-0 sm:border-l sm:border-[var(--line)] sm:pl-10 sm:first:border-l-0 sm:first:pl-0">
      <p className="mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--teal)]">{n}</p>
      <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-soft)]">{text}</p>
    </li>
  );
}
