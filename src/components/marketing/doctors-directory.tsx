"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Search } from "lucide-react";
import type { Doctor } from "@/lib/data";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { OpdBand } from "@/components/marketing/opd-band";
import { CountUp, Reveal } from "@/components/ui/reveal";
import { DEPARTMENTS } from "@/lib/data";
import { searchDoctors } from "@/lib/doctor-search";

/**
 * The directory, in the bento language.
 *
 * The important change here isn't the styling: every card used to link straight
 * to /book?doctor=, asking a family to commit to a consultant the page had told
 * them almost nothing about. The card now opens that doctor's profile, and
 * carries a separate Book action for people who already know who they want -
 * so nobody loses the shortcut, and nobody is forced to guess.
 */
export function DoctorsDirectory({ doctors }: { doctors: Doctor[] }) {
  // The header search sends people here as /doctors?q=… - reading it is the
  // difference between that box working and silently doing nothing. ?dept=
  // is honoured too, so the care menu can link straight to a filtered list.
  const params = useSearchParams();
  const initialDept = params.get("dept") ?? "";
  const [dept, setDept] = useState(
    DEPARTMENTS.some((d) => d.name === initialDept) ? initialDept : "All"
  );
  const [query, setQuery] = useState(params.get("q") ?? "");

  // Same matcher the header typeahead uses. When these drifted apart, the
  // header could suggest a consultant that this page then refused to show.
  const filtered = useMemo(() => {
    const inDept = dept === "All" ? doctors : doctors.filter((d) => d.department === dept);
    return searchDoctors(inDept, query).map((m) => m.doctor);
  }, [doctors, dept, query]);

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 lg:px-8">
      {/* ── the dark stat card + filters, as one bento row ─────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_2.4fr]">
        <Reveal>
          <div className="relative flex h-full min-h-[180px] flex-col justify-between overflow-hidden rounded-[1.75rem] bg-[var(--pine-ink)] p-7 text-white ring-1 ring-black/10">
            <div aria-hidden className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[var(--teal)]/40 blur-2xl" />
            <div className="relative z-10">
              <p className="display text-5xl text-white md:text-6xl">
                <CountUp to={doctors.length} />
              </p>
              <p className="mt-3 max-w-[210px] text-xs leading-relaxed text-white/70">
                consultants across {DEPARTMENTS.length} departments - every one of them
                sees patients in this building, not by video
              </p>
            </div>
            <div className="relative z-10 mt-6 flex items-center isolate -space-x-2">
              {doctors.slice(0, 4).map((d) => (
                <DoctorAvatar key={d.id} name={d.name} image={d.image}
                  className="h-9 w-9 rounded-full border-2 border-[var(--pine-ink)] text-[9px] shadow-sm" />
              ))}
              {doctors.length > 4 && (
                <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--pine-ink)] bg-[var(--teal)] text-[10px] font-semibold text-white">
                  +{doctors.length - 4}
                </span>
              )}
            </div>
          </div>
        </Reveal>

        <Reveal delay={80}>
          <div className="h-full rounded-[1.75rem] bg-[var(--peach-soft)] p-1.5 ring-1 ring-black/5">
            <div className="glass flex h-full flex-col justify-center gap-5 rounded-[1.35rem] p-6 sm:p-7">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, speciality or what you need treated…"
                  aria-label="Search doctors"
                  className="w-full rounded-full border border-[var(--line-strong)] bg-white py-3 pl-11 pr-4 text-[14px] outline-none transition-colors focus:border-[var(--teal)]"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {["All", ...DEPARTMENTS.map((d) => d.name)].map((name) => {
                  const active = dept === name;
                  return (
                    <button key={name} onClick={() => setDept(name)} aria-pressed={active}
                      className={`rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
                        active
                          ? "border-transparent bg-[var(--teal)] text-white"
                          : "border-[var(--line-strong)] bg-white/60 text-[var(--ink-soft)] hover:border-[var(--teal)] hover:text-[var(--teal)]"
                      }`}>
                      {name}
                    </button>
                  );
                })}
              </div>

              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                {filtered.length} {filtered.length === 1 ? "doctor" : "doctors"}
                {dept !== "All" && ` in ${dept}`}
              </p>
            </div>
          </div>
        </Reveal>
      </div>

      {/* ── the cards ──────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="mt-4 rounded-[1.75rem] bg-white p-16 text-center ring-1 ring-black/5">
          <p className="text-[15px] font-semibold text-[var(--ink)]">No doctors match that.</p>
          <p className="mt-1.5 text-[13.5px] text-[var(--muted)]">
            Try another department, or{" "}
            <button onClick={() => { setDept("All"); setQuery(""); }} className="font-semibold text-[var(--teal)] underline underline-offset-2">
              clear the filters
            </button>.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d, i) => (
            <Reveal key={d.id} delay={Math.min(i, 6) * 60}>
              <article className="group relative flex h-full flex-col rounded-[1.75rem] bg-white p-1.5 ring-1 ring-black/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow)]">
                <div className="relative overflow-hidden rounded-[1.35rem]">
                  <DoctorAvatar name={d.name} image={d.image} className="aspect-[5/4] w-full text-[28px]" />
                  <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 font-mono text-[10.5px] font-semibold text-[var(--ink)] shadow-sm backdrop-blur">
                    {d.experience}+ yrs
                  </span>
                  <span className="absolute right-3 top-3 rounded-full bg-[var(--pine-ink)]/80 px-2.5 py-1 font-mono text-[10.5px] font-semibold text-white backdrop-blur">
                    ₹{d.fee}
                  </span>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                    {d.department}
                  </span>
                  {/* the whole card is the profile link; the overlay carries it */}
                  <h3 className="mt-1.5 text-[17px] font-semibold leading-tight text-[var(--ink)]">
                    <Link href={`/doctors/${d.id}`} className="after:absolute after:inset-0 after:content-['']">
                      {d.name}
                    </Link>
                  </h3>
                  <p className="mt-0.5 text-[13px] font-medium text-[var(--teal)]">{d.specialization}</p>
                  <p className="mt-1 text-[12px] text-[var(--muted)]">{d.qualification}</p>

                  {/* when they actually sit - readable before you click anything */}
                  <div className="mt-4">
                    <OpdBand opd={d.opd} days={d.days} />
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
                    <span className="font-mono text-[11.5px] text-[var(--muted)]">{d.opd}</span>
                    {/* sits above the card-wide link so it stays a separate action */}
                    <Link
                      href={`/book?doctor=${d.id}`}
                      className="relative z-10 inline-flex items-center gap-1.5 rounded-full bg-[var(--teal-soft)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--teal-deep)] transition-colors hover:bg-[var(--teal)] hover:text-white"
                    >
                      Book <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
