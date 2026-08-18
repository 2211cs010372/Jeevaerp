"use client";

/**
 * WHO THE TEST IS FOR - the first step of every lab counter screen.
 *
 * Two ways in, because the counter has two kinds of person in front of it:
 *
 *   · someone with a file already - found by name, Jeeva ID or mobile;
 *   · someone with neither - a chit from an outside doctor, or nothing at all.
 *
 * The second used to be a dead end: the lab could not create a record, so a
 * walk-in was sent to reception to be typed in before a sample could be taken,
 * and plenty of them didn't come back. This asks for a name and a mobile, which
 * is the least the schema needs and the least a report needs to reach anybody.
 *
 * The record is NOT created here. The draft rides along with the order, so a
 * form that is abandoned halfway leaves no empty patient behind - a Jeeva ID is
 * issued at the moment the tests are ordered, not a moment before.
 */

import { useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Req, Spinner } from "@/components/portal/ui/form-atoms";
import { api } from "@/lib/api-client";
import { formatPhone, isIndianMobile, toBare10 } from "@/lib/phone";

export interface LabPatient {
  id: string; displayId: string; fullName: string; phone: string;
  age: number | null; gender?: string | null;
}

/** A walk-in as typed, before they have a record. Strings throughout - it's a form. */
export interface PatientDraft {
  firstName: string; lastName: string; phone: string;
  age: string; gender: "" | "MALE" | "FEMALE" | "OTHER";
}

export type PatientChoice =
  | { kind: "existing"; patient: LabPatient }
  | { kind: "new"; draft: PatientDraft };

export const EMPTY_DRAFT: PatientDraft = { firstName: "", lastName: "", phone: "", age: "", gender: "" };

export const draftName = (d: PatientDraft) =>
  [d.firstName, d.lastName].map((s) => s.trim()).filter(Boolean).join(" ");

/** Name and a reachable mobile. Everything else on a patient record can wait. */
export const draftValid = (d: PatientDraft) => d.firstName.trim().length > 0 && isIndianMobile(d.phone);

/** The draft in the shape `POST /labs/walk-in` wants. */
export function draftPayload(d: PatientDraft) {
  return {
    firstName: d.firstName.trim(),
    lastName: d.lastName.trim() || undefined,
    phone: toBare10(d.phone),
    age: d.age.trim() ? Number(d.age) : undefined,
    gender: d.gender || undefined,
  };
}

/** Name, Jeeva ID or phone - whatever the patient can produce. */
export const choiceLabel = (c: PatientChoice) =>
  c.kind === "existing" ? c.patient.fullName : draftName(c.draft) || "New patient";

const inits = (n: string) => n.split(" ").map((x) => x[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

const fld =
  "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";
const lbl = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]";

export function PatientStep({
  value,
  onChange,
  step = "1",
  className = "",
}: {
  value: PatientChoice | null;
  onChange: (c: PatientChoice | null) => void;
  step?: string;
  className?: string;
}) {
  const [mode, setMode] = useState<"find" | "new">("find");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LabPatient[]>([]);
  const [recent, setRecent] = useState<LabPatient[]>([]);
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState<PatientDraft>(EMPTY_DRAFT);
  /** Existing records on the number being typed into the NEW form - see below. */
  const [dupes, setDupes] = useState<LabPatient[]>([]);

  const chosen = value?.kind === "existing" ? value.patient : null;

  useEffect(() => {
    api.get<{ patients: LabPatient[] }>("/reception/patients/recent")
      .then((r) => setRecent(r.patients))
      .catch(() => setRecent([]));
  }, []);

  // ── search ──
  useEffect(() => {
    if (chosen || !query.trim()) { setResults([]); return; }
    let active = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { patients } = await api.get<{ patients: LabPatient[] }>(
          `/reception/patients?q=${encodeURIComponent(query)}&limit=6`
        );
        if (active) setResults(patients);
      } catch { if (active) setResults([]); }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [query, chosen]);

  // ── the duplicate a busy counter creates without noticing ──
  //
  // The same person walks in three times in a year and gets typed in fresh each
  // time, because looking them up is a deliberate act and typing is not. Their
  // results then live under three Jeeva IDs and no screen shows a history.
  // Searching the number AS IT IS TYPED costs nothing and catches it at the one
  // moment somebody can still choose the existing record.
  useEffect(() => {
    if (mode !== "new" || !isIndianMobile(draft.phone)) { setDupes([]); return; }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const { patients } = await api.get<{ patients: LabPatient[] }>(
          `/reception/patients?q=${encodeURIComponent(toBare10(draft.phone))}&limit=3`
        );
        if (active) setDupes(patients);
      } catch { if (active) setDupes([]); }
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [draft.phone, mode]);

  function pick(p: LabPatient) {
    onChange({ kind: "existing", patient: p });
    setQuery("");
  }

  function edit(patch: Partial<PatientDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange(draftValid(next) ? { kind: "new", draft: next } : null);
  }

  function clear() {
    onChange(null);
    setQuery("");
    setDupes([]);
  }

  // ── chosen: an existing record ──
  if (chosen) {
    return (
      <section data-rise className={`surface overflow-hidden ${className}`}>
        <div className="border-b border-[var(--p-border)] px-6 py-4">
          <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">{step} · Patient</h3>
        </div>
        <div className="p-6">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--p-teal)] bg-[var(--p-teal-soft)]/40 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--p-teal)] font-serif-p text-[13px] font-semibold text-white">
                {inits(chosen.fullName)}
              </div>
              <div>
                <div className="text-[14px] font-semibold text-[var(--p-ink)]">{chosen.fullName}</div>
                <div className="text-[11px] text-[var(--p-muted)]">
                  <span className="tabular">{chosen.displayId}</span> · {formatPhone(chosen.phone)}
                  {chosen.age != null && ` · ${chosen.age}y`}
                </div>
              </div>
            </div>
            <button onClick={clear} className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-teal)]">
              Change
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-rise className={`surface overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] px-6 py-4">
        <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">{step} · Patient</h3>
        <div className="flex gap-1 rounded-full border border-[var(--p-border)] bg-white p-1">
          {([["find", "Registered"], ["new", "New walk-in"]] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => { setMode(m); onChange(m === "new" && draftValid(draft) ? { kind: "new", draft } : null); }}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                mode === m ? "bg-[var(--p-teal)] text-white" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {mode === "find" ? (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3.5 py-2.5">
              <Icon name="search" size={16} />
              <input
                value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                placeholder="Name, mobile or JMH2026OP00123…"
                className="w-full text-sm outline-none"
              />
              {searching && <Spinner size={14} />}
            </div>
            {(query ? results : recent).length > 0 ? (
              <div className="mt-3 space-y-2">
                {(query ? results : recent).map((p) => (
                  <button
                    key={p.id} onClick={() => pick(p)}
                    className="surface-hover flex w-full items-center justify-between rounded-lg border border-[var(--p-border)] p-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--p-teal-soft)] font-serif-p text-[12px] font-semibold text-[var(--p-teal)]">
                        {inits(p.fullName)}
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-[var(--p-ink)]">{p.fullName}</div>
                        <div className="text-[11px] text-[var(--p-muted)]">
                          <span className="tabular">{p.displayId}</span> · {formatPhone(p.phone)}
                        </div>
                      </div>
                    </div>
                    <Icon name="chevron" size={16} />
                  </button>
                ))}
              </div>
            ) : query && !searching ? (
              <div className="mt-3 rounded-lg border border-dashed border-[var(--p-border)] px-4 py-6 text-center">
                <p className="text-[13px] text-[var(--p-muted)]">Nobody on file matches “{query}”.</p>
                <button
                  onClick={() => { setMode("new"); edit({ firstName: /^\d/.test(query) ? draft.firstName : query, phone: /^\d/.test(query) ? query : draft.phone }); }}
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--p-teal)]"
                >
                  <Icon name="plus" size={13} /> Register them as a walk-in
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={lbl}>First name<Req /></label>
                <input value={draft.firstName} onChange={(e) => edit({ firstName: e.target.value })} className={fld} autoFocus placeholder="Lakshmi" />
              </div>
              <div>
                <label className={lbl}>Last name</label>
                <input value={draft.lastName} onChange={(e) => edit({ lastName: e.target.value })} className={fld} placeholder="Rao" />
              </div>
              <div>
                <label className={lbl}>Mobile<Req /></label>
                <input
                  value={draft.phone} inputMode="numeric" maxLength={14}
                  onChange={(e) => edit({ phone: e.target.value })}
                  className={`${fld} font-mono`} placeholder="9848012345"
                />
                {draft.phone.trim() && !isIndianMobile(draft.phone) && (
                  <p className="mt-1.5 flex items-center gap-1 text-[12px] text-[var(--p-rose)]">
                    <Icon name="alert" size={11} /> 10 digits, starting 6-9.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Age</label>
                  <input
                    value={draft.age} inputMode="numeric" maxLength={3}
                    onChange={(e) => edit({ age: e.target.value.replace(/\D/g, "") })}
                    className={`${fld} font-mono`} placeholder="34"
                  />
                </div>
                <div>
                  <label className={lbl}>Sex</label>
                  <select value={draft.gender} onChange={(e) => edit({ gender: e.target.value as PatientDraft["gender"] })} className={fld}>
                    <option value="">-</option>
                    <option value="FEMALE">Female</option>
                    <option value="MALE">Male</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>
            </div>

            {dupes.length > 0 && (
              <div className="mt-4 rounded-lg border border-[var(--p-amber)]/30 bg-[var(--p-amber-soft)] p-3">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#8a6414]">
                  <Icon name="alert" size={13} /> This mobile is already on file. Use the existing record so the results stay together.
                </p>
                <div className="mt-2 space-y-1.5">
                  {dupes.map((p) => (
                    <button
                      key={p.id} onClick={() => { setMode("find"); pick(p); }}
                      className="flex w-full items-center justify-between rounded-lg border border-[var(--p-border)] bg-white p-2.5 text-left transition-colors hover:border-[var(--p-teal)]"
                    >
                      <span className="text-[13px] text-[var(--p-ink)]">
                        {p.fullName} <span className="tabular text-[11px] text-[var(--p-muted)]">{p.displayId}</span>
                      </span>
                      <span className="text-[12px] font-semibold text-[var(--p-teal)]">Use this record</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-[var(--p-muted)]">
              A Jeeva ID is issued when the tests are ordered. Age and sex are optional here but they change
              how several analytes are read, so fill them in when the patient can tell you.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
