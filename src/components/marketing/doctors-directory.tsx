"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import type { Doctor } from "@/lib/data";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { DoctorCard } from "@/components/marketing/doctor-card";
import { CountUp, Reveal } from "@/components/ui/reveal";
import { DEPARTMENTS } from "@/lib/data";
import { searchDoctors } from "@/lib/doctor-search";

/**
 * The directory.
 *
 * The card itself lives in doctor-card.tsx and is shared with the panel on the
 * homepage, so the two cannot drift apart again - they were two separate card
 * designs for the same object until this was pulled out.
 *
 * WHAT THE CARD NO LONGER SHOWS, AND WHY IT MATTERS. The consultation fee is
 * hidden by request. The OPD band, the qualification, the specialisation line
 * and the inline Book shortcut came off with it, because none of them survive a
 * card sized for four columns. That last one is a real loss: every card used to
 * carry a separate Book action for people who already knew who they wanted, and
 * they now have to go through the profile to reach it. The whole card is still
 * the profile link, so nothing is unreachable - it is one tap further away.
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
          <div className="relative flex h-full min-h-[180px] flex-col justify-between overflow-hidden rounded-[16px] bg-[var(--pine-ink)] p-7 text-white">
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
          <div className="h-full rounded-[16px] bg-[var(--paper)]">
            <div className="flex h-full flex-col justify-center gap-5 p-6 sm:p-7">
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
        <div className="mt-4 rounded-[16px] bg-[var(--paper)] p-16 text-center">
          <p className="text-[15px] font-semibold text-[var(--ink)]">No doctors match that.</p>
          <p className="mt-1.5 text-[13.5px] text-[var(--muted)]">
            Try another department, or{" "}
            <button onClick={() => { setDept("All"); setQuery(""); }} className="font-semibold text-[var(--teal)] underline underline-offset-2">
              clear the filters
            </button>.
          </p>
        </div>
      ) : (
        /* Two up on a phone, three at tablet, four on a desk. The row layout is
           what makes two columns survive 375px at all: a stacked card would put
           a full-width photo above the name and turn the grid into a wall of
           faces you have to scroll past to read anything. */
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((d, i) => (
            <Reveal key={d.id} delay={Math.min(i, 6) * 60}>
              <DoctorCard doctor={d} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
