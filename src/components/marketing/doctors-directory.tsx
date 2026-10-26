"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "@/components/ui/hugeicons";
import type { Doctor } from "@/lib/data";
import { DoctorCard } from "@/components/marketing/doctor-card";
import { searchDoctors } from "@/lib/doctor-search";

/**
 * The full panel, filterable - in the homepage's voice.
 *
 * One quiet row of controls (a search field and a department pill per
 * department that actually has a consultant), a count, then the same card
 * grid the homepage uses: 8px apart, a centred ~1180px track, two / three /
 * four across.
 *
 * THE DEPARTMENT PILLS COME FROM THE PANEL, NOT FROM DEPARTMENTS. The ERP files
 * some consultants under names the public department list does not use
 * ("Gastroenterologist"), and listing a department with nobody in it is a
 * button that always returns "no doctors". So the pills are the departments
 * the doctors in hand are actually in.
 *
 * Reads ?q= and ?dept= on arrival, so the navbar search and the department
 * pages can deep-link into a filtered view.
 */
export function DoctorsDirectory({ doctors }: { doctors: Doctor[] }) {
  const params = useSearchParams();

  const departments = useMemo(
    () => [...new Set(doctors.map((d) => d.department))].sort((a, b) => a.localeCompare(b)),
    [doctors],
  );

  const initialDept = params.get("dept") ?? "";
  const [dept, setDept] = useState(departments.includes(initialDept) ? initialDept : "All");
  const [query, setQuery] = useState(params.get("q") ?? "");

  const filtered = useMemo(() => {
    const inDept = dept === "All" ? doctors : doctors.filter((d) => d.department === dept);
    return searchDoctors(inDept, query).map((m) => m.doctor);
  }, [doctors, dept, query]);

  return (
    <div className="f-sans">
      {/* ── the controls ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 border-t border-[var(--line-strong)] pt-5 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
        <div className="relative w-full lg:max-w-[360px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, speciality or what you need treated"
            aria-label="Search doctors"
            className="w-full rounded-full border border-transparent bg-[var(--bone)] py-2.5 pl-10 pr-4 text-[13.5px] font-medium text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:bg-white"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          {["All", ...departments].map((name) => {
            const on = dept === name;
            return (
              <button
                key={name}
                onClick={() => setDept(name)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ${
                  on
                    ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                    : "border-[var(--line-strong)] text-[var(--ink-soft)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-5 text-[12.5px] font-medium text-[var(--muted)]" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "consultant" : "consultants"}
        {dept !== "All" && ` in ${dept}`}
        {query.trim() && ` matching “${query.trim()}”`}
      </p>

      {/* ── the cards ──────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="mt-4 rounded-[12px] bg-[var(--bone)] px-6 py-16 text-center">
          <p className="f-serif text-[1.6rem] leading-tight text-[var(--ink)]">No consultant matches that.</p>
          <p className="mt-2 text-[13px] font-medium text-[var(--muted)]">
            Try another department, or{" "}
            <button
              onClick={() => {
                setDept("All");
                setQuery("");
              }}
              className="text-[var(--teal)] underline underline-offset-2"
            >
              clear the filters
            </button>
            .
          </p>
        </div>
      ) : (
        <div className="mx-auto mt-4 grid max-w-[1180px] grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((d) => (
            <DoctorCard key={d.id} doctor={d} />
          ))}
        </div>
      )}
    </div>
  );
}
