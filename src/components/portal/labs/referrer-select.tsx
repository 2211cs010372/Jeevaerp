"use client";

/**
 * WHO REFERRED THIS SAMPLE.
 *
 * A lab test knew its doctor only through a consultation in this hospital. The
 * patient who walks up to the window holding a chit from a clinic across town
 * has no consultation here, so their report printed "Ref. Doctor: Self /
 * walk-in" - and went back to a doctor whose name was nowhere on it.
 *
 * This is that name, asked for at the one moment somebody is looking at the
 * chit. It is optional on every screen it appears on: plenty of samples really
 * are self-referred, and a required field would only get the first name in the
 * list.
 *
 * Shared by the lab counter, the reception desk and the queue's correction
 * panel so the three can't drift into asking for it three ways.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

export interface RosterDoctor {
  id: string; name: string; specialization: string; department: string;
}

/**
 * The roster, loaded once per screen.
 *
 * Failure is silent and lands as an empty list, which the select renders as
 * "no doctors on the roster". A doctor dropdown that couldn't load is not worth
 * an error banner on a screen whose actual job is ordering a blood test.
 */
export function useDoctorRoster(): RosterDoctor[] {
  const [doctors, setDoctors] = useState<RosterDoctor[]>([]);
  useEffect(() => {
    api.get<{ doctors: RosterDoctor[] }>("/labs/doctors")
      .then((r) => setDoctors(r.doctors))
      .catch(() => setDoctors([]));
  }, []);
  return doctors;
}

export function ReferrerSelect({
  doctors, value, onChange, label = "Referred by", hint, disabled = false, compact = false,
}: {
  doctors: RosterDoctor[];
  /** "" is nobody - a genuinely self-referred sample. */
  value: string;
  onChange: (doctorId: string) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  /** Drops the label to a plain line - for the queue's inline correction panel. */
  compact?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-55" : ""}>
      <label className={`mb-1.5 block ${compact
        ? "text-[12px] font-semibold text-[var(--p-ink)]"
        : "text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]"}`}>
        {label} <span className="font-normal normal-case text-[var(--p-muted)]">(optional)</span>
      </label>
      <select
        value={value}
        disabled={disabled || doctors.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-teal)] disabled:bg-[var(--p-bg)]"
      >
        <option value="">{doctors.length === 0 ? "No doctors on the roster" : "Self / walk-in - nobody referred them"}</option>
        {doctors.map((d) => (
          <option key={d.id} value={d.id}>{d.name} - {d.department}</option>
        ))}
      </select>
      {hint && <p className="mt-1 text-[12px] leading-snug text-[var(--p-muted)]">{hint}</p>}
    </div>
  );
}
