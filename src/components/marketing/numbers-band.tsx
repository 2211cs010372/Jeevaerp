import { WARDS, DEPARTMENTS, DOCTORS } from "@/lib/data";
import { Chapter } from "./section";
import { Counter, Stagger } from "./motion";

/**
 * The capacity band.
 *
 * Four figures, set at display size on porcelain, divided by hairlines. Every
 * one is derived from the data the rest of the site is built from - beds come
 * from the published ward table, specialties from the department list - so it
 * cannot drift out of step with the pages that quote them.
 *
 * No badges, no glows, no pills. The numbers are the design.
 */
export function NumbersBand() {
  const beds = WARDS.reduce((s, w) => s + w.beds, 0);
  const icu = WARDS.find((w) => w.name === "ICU")?.beds ?? 0;

  const FIGURES = [
    { value: beds, suffix: "", label: "Inpatient beds", sub: "Across four ward classes" },
    { value: icu, suffix: "", label: "ICU units", sub: "Continuously monitored" },
    { value: DEPARTMENTS.length, suffix: "", label: "Specialties", sub: "Consulting daily" },
    { value: DOCTORS.length, suffix: "+", label: "Consultants", sub: "Named, with published fees" },
  ];

  return (
    <Chapter tone="light" className="chapter-tight">
      <Stagger
        each={0.09}
        y={22}
        className="grid grid-cols-2 border-t border-[var(--line-strong)] lg:grid-cols-4"
      >
        {FIGURES.map((f) => (
          <div
            key={f.label}
            className="border-b border-[var(--line)] px-1 py-8 sm:px-6 lg:border-b-0 lg:border-l lg:first:border-l-0 lg:first:pl-0"
          >
            <p className="stat-num text-[var(--ink)]">
              <Counter value={f.value} suffix={f.suffix} />
            </p>
            <h3 className="mt-4 text-[14.5px] font-semibold tracking-[-0.015em] text-[var(--ink)]">
              {f.label}
            </h3>
            <p className="mono mt-1.5 text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {f.sub}
            </p>
          </div>
        ))}
      </Stagger>
    </Chapter>
  );
}
