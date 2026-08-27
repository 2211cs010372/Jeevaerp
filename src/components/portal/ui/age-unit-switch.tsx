"use client";

/**
 * YEARS / MONTHS / DAYS, as a three-way switch that lives on a field's LABEL
 * line rather than in a box beside the number.
 *
 * Two boxes do not fit. Both registration forms tried it and both broke the
 * same way: half of half a form is about 140px, a `<select>` wide enough to
 * read "Months" claims most of it, and the number box collapsed to 26px while
 * the select overflowed into the field next to it. No ratio fixes that - a
 * `1fr` track still respects a select's min-content width, and `w-[6.5rem]`
 * loses to the `w-full` in the shared field class, since neither wins on
 * source order in the attribute.
 *
 * Up on the label it costs the number box nothing, reads as one question
 * instead of two, and is one tap at a counter instead of open-scroll-pick.
 */

import { AGE_UNITS, type AgeUnit } from "@/lib/age";

export function AgeUnitSwitch({
  value,
  onChange,
}: {
  value: AgeUnit;
  onChange: (u: AgeUnit) => void;
}) {
  return (
    <div className="flex items-center gap-px rounded-full border border-[var(--p-border)] bg-white p-px">
      {AGE_UNITS.map((u) => (
        <button
          key={u.value}
          type="button"
          aria-label={u.label}
          title={u.label}
          aria-pressed={value === u.value}
          onClick={() => onChange(u.value)}
          className={`rounded-full px-1.5 text-[10px] font-bold uppercase leading-[13px] transition-colors ${
            value === u.value
              ? "bg-[var(--p-teal)] text-white"
              : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"
          }`}
        >
          {u.short}
        </button>
      ))}
    </div>
  );
}
