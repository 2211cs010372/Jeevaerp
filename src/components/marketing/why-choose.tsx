import Link from "next/link";
import { Reveal } from "@/components/ui/reveal";
import { DeptVisual } from "@/components/marketing/dept-visual";
import { DEPARTMENTS, STATS, HOSPITAL } from "@/lib/data";

/**
 * Departments — wears the hero's material language: one framed porcelain shell
 * (two-column header + deep-pine feature panel + welded stat rail), followed by
 * a grid of real department photography as pine-tinted tiles. Same tokens as the
 * hero, so the page reads as one system.
 */
export function Departments() {
  const railFacts = [
    STATS[0], // 8 Departments
    STATS[1], // 12+ Specialists
    { value: "Same", suffix: "-day", label: "OPD slots", sub: "walk in or book" },
    { value: "In", suffix: "-house", label: "Diagnostics", sub: "lab · imaging · pharmacy" },
  ] as const;

  return (
    <section id="departments" className="px-3 py-16 sm:px-5 lg:py-24">
      <div className="mx-auto max-w-[1280px]">
        {/* ── hero-style header shell ─────────────────────────────── */}
        <div className="relative overflow-hidden rounded-[36px] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow)]">
          <div aria-hidden className="pointer-events-none absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(11,84,76,0.10),transparent_62%)]" />

          <div className="relative grid items-stretch gap-8 p-6 sm:p-9 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:p-12">
            {/* copy */}
            <div className="flex flex-col justify-center py-2 lg:py-4">
              <Reveal>
                <span className="mb-6 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--muted)]" style={{ fontFamily: "var(--font-mono)" }}>
                  <span className="pulse" aria-hidden /> Departments · {DEPARTMENTS.length} specialties
                </span>
              </Reveal>
              <Reveal delay={40}>
                <h2 className="display text-[clamp(2.1rem,4.4vw,3.4rem)] text-[var(--ink)]">
                  Every specialty,
                  <br />
                  <span className="text-[var(--teal)]">one building.</span>
                </h2>
              </Reveal>
              <Reveal delay={90}>
                <div className="mt-6 flex max-w-lg items-start gap-5">
                  <span className="idx mt-1 shrink-0">(002)</span>
                  <p className="text-[15px] leading-[1.75] text-[var(--ink-soft)]">
                    From a racing heart to a child&apos;s fever, most of a family&apos;s care lives
                    under one roof in {HOSPITAL.locality.split(",")[0]} — each department staffed by
                    its own specialists, with lab, imaging and pharmacy a corridor away.
                  </p>
                </div>
              </Reveal>
              <Reveal delay={160}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link href="/doctors" className="btn btn-solid">
                    Explore specialists <span aria-hidden>→</span>
                  </Link>
                  <a href={`tel:${HOSPITAL.emergency.replace(/\s/g, "")}`} className="btn btn-ghost !text-[var(--alert)]">
                    Emergency 24×7
                  </a>
                </div>
              </Reveal>
            </div>

            {/* feature panel — the building */}
            <Reveal delay={140} className="relative min-h-[360px] lg:min-h-0">
              <div className="relative h-full min-h-[360px] overflow-hidden rounded-[26px] bg-[var(--pine-ink)]">
                <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 z-10 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(23,112,95,0.5),transparent_65%)]" />
                <img
                  src="/images/hospital_banner.jpeg"
                  alt={`Inside ${HOSPITAL.name}`}
                  className="absolute inset-0 h-full w-full object-cover opacity-90"
                />
                <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[var(--pine-ink)] via-[var(--pine-ink)]/70 to-transparent" />
                <div className="absolute right-4 top-4 z-20 rounded-full border border-white/15 bg-black/25 px-3.5 py-1.5 text-[11px] font-medium text-white backdrop-blur" style={{ fontFamily: "var(--font-mono)" }}>
                  {HOSPITAL.locality.split(",")[0]}
                </div>
                <div className="absolute inset-x-4 bottom-4 z-20 rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-md sm:inset-x-5 sm:bottom-5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--teal-tint)]" style={{ fontFamily: "var(--font-mono)" }}>
                    One roof, one record
                  </p>
                  <p className="mt-1.5 text-[14px] leading-snug text-white">
                    Consult, test and collect medicines in a single visit — every step on your
                    permanent Jeeva ID.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>

          {/* stat rail */}
          <div className="relative grid grid-cols-2 gap-px border-t border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">
            {railFacts.map((s) => (
              <div key={s.label} className="bg-[var(--paper)] px-6 py-6 sm:px-7">
                <p className="display text-[clamp(1.5rem,2.4vw,2rem)] text-[var(--ink)]">
                  <span className="tabular">{s.value}</span>
                  <span className="text-[var(--teal)]">{s.suffix}</span>
                </p>
                <p className="mt-1 text-[13px] font-medium text-[var(--ink-soft)]">{s.label}</p>
                <p className="text-[12px] text-[var(--muted)]">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── department photo grid ───────────────────────────────── */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {DEPARTMENTS.map((d, i) => (
            <Reveal key={d.name} delay={Math.min(i * 40, 280)}>
              <Link
                href={`/book?dept=${encodeURIComponent(d.name)}`}
                className="group relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-[22px] bg-[var(--pine-ink)] ring-1 ring-[var(--line)]"
              >
                <DeptVisual
                  name={d.name}
                  src={d.image}
                  className="absolute inset-0 h-full w-full transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.07]"
                />
                <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--pine-ink)] via-[var(--pine-ink)]/30 to-transparent" />
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 ring-2 ring-inset ring-[var(--teal-lift)] transition-opacity duration-300 group-hover:opacity-100" />

                {/* index */}
                <span className="absolute left-3.5 top-3.5 z-10 rounded-full bg-black/30 px-2 py-0.5 text-[10.5px] text-white/90 backdrop-blur" style={{ fontFamily: "var(--font-mono)" }}>
                  {d.index}
                </span>
                {/* book affordance */}
                <span
                  aria-hidden
                  className="absolute right-3.5 top-3.5 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-all duration-300 group-hover:rotate-45 group-hover:bg-[var(--teal)]"
                >
                  ↗
                </span>

                {/* label */}
                <div className="relative z-10 p-4">
                  <h3 className="display text-[19px] leading-tight text-white">{d.name}</h3>
                  <p className="mt-1.5 text-[10px] uppercase tracking-[0.1em] text-[var(--teal-tint)]" style={{ fontFamily: "var(--font-mono)" }}>
                    {d.common}
                  </p>
                  <span className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-white/0 transition-colors duration-300 group-hover:text-white">
                    Book appointment
                    <span className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden>→</span>
                  </span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
