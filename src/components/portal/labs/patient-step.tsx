"use client";

/**
 * WHO THE TEST IS FOR - the first step of every lab counter screen.
 *
 * Three ways in, because the lab serves three kinds of person:
 *
 *   · someone with a file already - found by name, Jeeva ID or mobile;
 *   · someone with neither - a chit from an outside doctor, or nothing at all;
 *   · someone who is upstairs in a bed.
 *
 * The third used to go through the same search box as the first, and that was
 * a worse experience than it looks. A ward sends down a request slip carrying a
 * bed number and an IP number, and neither of those is what the search box
 * takes - so the technician had to work back to a name, type it, and hope the
 * right record came up. Picking from the occupied beds is the same list the
 * ward is looking at, and it carries the admission, so the test lands on that
 * stay instead of against a patient who merely has the same name.
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
import { InpatientPicker } from "@/components/portal/reception/inpatient-picker";
import { formatPhone, isIndianMobile, notAPatientPhone, toBare10 } from "@/lib/phone";
import { PhoneOnFileHint } from "@/components/portal/duplicate-patient-dialog";
import { AGE_MAX, ageInRange, agePayload, formatAge, type AgeUnit } from "@/lib/age";
import { AgeUnitSwitch } from "@/components/portal/ui/age-unit-switch";

export interface LabPatient {
  id: string; displayId: string; fullName: string; phone: string;
  age: number | null; gender?: string | null;
  /** Set for the infants registered by unit - see lib/age. Ages itself, `age` doesn't. */
  dob?: string | null;
}

/** A walk-in as typed, before they have a record. Strings throughout - it's a form. */
export interface PatientDraft {
  firstName: string; lastName: string; phone: string;
  /** The NUMBER only. What it counts is `ageUnit` - "11" is days, months or years. */
  age: string;
  ageUnit: AgeUnit;
  gender: "" | "MALE" | "FEMALE" | "OTHER";
}

/** Where an inpatient currently is, carried so the screen can say so. */
export interface AdmissionContext {
  admissionId: string;
  ipNumber: string;
  ward: string;
  bedNo: string;
}

export type PatientChoice =
  | { kind: "existing"; patient: LabPatient; admission?: AdmissionContext }
  | { kind: "new"; draft: PatientDraft };

export const EMPTY_DRAFT: PatientDraft = { firstName: "", lastName: "", phone: "", age: "", ageUnit: "Y", gender: "" };

export const draftName = (d: PatientDraft) =>
  [d.firstName, d.lastName].map((s) => s.trim()).filter(Boolean).join(" ");

/**
 * Age is OPTIONAL, but an age that is out of range for its unit is not the same
 * as a blank one: it would write a date of birth in the future or in 1900. A
 * typed age has to make sense before the form will hand the draft over.
 */
export const ageValid = (d: PatientDraft) =>
  !d.age.trim() || ageInRange(Number(d.age), d.ageUnit);

/**
 * Name and a reachable mobile. Everything else on a patient record can wait.
 * The hospital's own number is not reachable - 170 lab walk-ins were filed on
 * it before the server started refusing it.
 */
export const draftValid = (d: PatientDraft) =>
  d.firstName.trim().length > 0 && isIndianMobile(d.phone) && !notAPatientPhone(d.phone) && ageValid(d);

/**
 * The draft in the shape `POST /labs/walk-in` wants.
 *
 * The unit does not travel - `agePayload` resolves it here into the two things
 * the patient record actually holds: completed years, and (for an infant, whose
 * years are 0) the date of birth those months or days imply.
 */
export function draftPayload(d: PatientDraft) {
  const typedAge = d.age.trim() ? Number(d.age) : null;
  const age = typedAge != null && ageInRange(typedAge, d.ageUnit) ? agePayload(typedAge, d.ageUnit) : null;
  return {
    firstName: d.firstName.trim(),
    lastName: d.lastName.trim() || undefined,
    phone: toBare10(d.phone),
    age: age?.age,
    dob: age?.dob,
    gender: d.gender || undefined,
  };
}

/** Name, Jeeva ID or phone - whatever the patient can produce. */
export const choiceLabel = (c: PatientChoice) =>
  c.kind === "existing" ? c.patient.fullName : draftName(c.draft) || "New patient";

const inits = (n: string) => n.split(" ").map((x) => x[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

const fld =
  "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";
const lblText = "text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]";
const lbl = `mb-1.5 block ${lblText}`;
/** The label ROW, pinned to the height of a bare label so every control in the
 *  grid below starts on the same line - one of them carries the unit switch. */
const lblRow = "mb-1.5 flex h-[17px] items-center gap-2";

/** A plausible value for each unit, so the placeholder reads as an example. */
const AGE_PLACEHOLDER: Record<AgeUnit, string> = { Y: "34", M: "5", D: "11" };
const AGE_UNIT_WORD: Record<AgeUnit, string> = { Y: "years", M: "months", D: "days" };

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
  const [mode, setMode] = useState<"find" | "inpatient" | "new">("find");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LabPatient[]>([]);
  const [recent, setRecent] = useState<LabPatient[]>([]);
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState<PatientDraft>(EMPTY_DRAFT);

  const chosen = value?.kind === "existing" ? value.patient : null;
  const ward = value?.kind === "existing" ? value.admission : undefined;

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
          `/reception/patients?q=${encodeURIComponent(query)}`
        );
        if (active) setResults(patients);
      } catch { if (active) setResults([]); }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [query, chosen]);

  function pick(p: LabPatient, admission?: AdmissionContext) {
    onChange({ kind: "existing", patient: p, ...(admission ? { admission } : {}) });
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
                  {formatAge(chosen) && ` · ${formatAge(chosen)}`}
                </div>
                {/* Said here, at the moment of choosing, because it changes what
                    happens with the money: nothing is collected at the window
                    and the test goes onto the stay. A technician who learns
                    that only from the confirmation screen has already asked a
                    relative to pay. */}
                {ward && (
                  <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[10.5px] font-semibold text-[var(--p-teal-deep)]">
                    <Icon name="bed" size={11} />
                    <span className="tabular">{ward.ipNumber}</span>
                    <span className="text-[var(--p-muted)]">·</span>
                    {ward.ward} {ward.bedNo}
                    <span className="text-[var(--p-muted)]">· billed to the stay</span>
                  </div>
                )}
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
          {/* The counter's own words for the three - the same split the
              pharmacy works to: an outpatient on file, somebody in a bed, and
              somebody who has never been here. */}
          {([["find", "OP patient"], ["inpatient", "Inpatient (IP)"], ["new", "New walk-in"]] as const).map(([m, label]) => (
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
        {mode === "inpatient" ? (
          /* The occupied beds, exactly as the ward sees them. One click from a
             request slip to an order - no name to retype and no wrong Jeeva ID
             to pick. The admission rides along so the test is billed to the
             stay rather than taken at the counter. */
          <InpatientPicker
            alwaysOpen
            pickedPatientId={null}
            onPick={(ip) =>
              onChange({
                kind: "existing",
                patient: {
                  id: ip.patient.id, displayId: ip.patient.displayId, fullName: ip.patient.fullName,
                  phone: ip.patient.phone, age: ip.patient.age, dob: ip.patient.dob, gender: ip.patient.gender,
                },
                admission: { admissionId: ip.id, ipNumber: ip.ipNumber, ward: ip.ward, bedNo: ip.bedNo },
              })
            }
          />
        ) : mode === "find" ? (
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
              <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
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
              {/* TWO EQUAL COLUMNS. `grid-cols-2` is minmax(0,1fr) twice, and
                  the minmax is the point: a bare `1.5fr` track still respects
                  the Sex select's min-content width, so the select took the row
                  and squeezed the age box down to 26 real pixels. Nothing here
                  is a hard-coded pixel width for the same reason. */}
              <div className="grid grid-cols-2 gap-3">
                {/* AGE, IN WHATEVER UNIT THE ANSWER CAME IN.
                    A lab that registers newborns cannot ask everyone for a
                    number of years: "0" is the same answer for a nine-day-old
                    and a nine-month-old, and the reference range for bilirubin
                    or haemoglobin is not.

                    The unit is a THREE-WAY SWITCH ON THE LABEL LINE, not a
                    second box beside the number. Two boxes do not fit across
                    half of half a form at any ratio - that is what kept
                    overflowing into Sex. Up on the label it costs the number
                    box nothing, reads as one question rather than two, and is
                    one tap at a counter instead of open-scroll-pick. */}
                <div>
                  <div className={`${lblRow} justify-between`}>
                    <label className={lblText} htmlFor="walkin-age">Age</label>
                    <AgeUnitSwitch value={draft.ageUnit} onChange={(u) => edit({ ageUnit: u })} />
                  </div>
                  <input
                    id="walkin-age" value={draft.age} inputMode="numeric" maxLength={5}
                    onChange={(e) => edit({ age: e.target.value.replace(/\D/g, "") })}
                    className={`${fld} font-mono`} placeholder={AGE_PLACEHOLDER[draft.ageUnit]}
                  />
                  {!ageValid(draft) && (
                    <p className="mt-1.5 flex items-center gap-1 text-[12px] text-[var(--p-rose)]">
                      <Icon name="alert" size={11} /> Up to {AGE_MAX[draft.ageUnit]} {AGE_UNIT_WORD[draft.ageUnit]}.
                    </p>
                  )}
                </div>
                <div>
                  <div className={lblRow}><label className={lblText}>Sex</label></div>
                  <select value={draft.gender} onChange={(e) => edit({ gender: e.target.value as PatientDraft["gender"] })} className={fld}>
                    <option value="">-</option>
                    <option value="FEMALE">Female</option>
                    <option value="MALE">Male</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── the duplicate a busy counter creates without noticing ──
                The same person walks in three times in a year and gets typed in
                fresh each time, because looking them up is a deliberate act and
                typing is not. Searching the number AS IT IS TYPED catches it at
                the one moment somebody can still choose the existing record.
                This used to be the only guard, and it could be ignored - the
                lab made half of all duplicate records past it. The server now
                refuses too, and the order screen opens the same dialog. */}
            <PhoneOnFileHint
              phone={draft.phone} name={draftName(draft)} className="mt-4"
              onUse={(p) => { setMode("find"); pick(p, p.admission ? { ...p.admission } : undefined); }}
            />

            <p className="mt-4 text-[11px] leading-relaxed text-[var(--p-muted)]">
              A Jeeva ID is issued when the tests are ordered. Age and sex are optional here but they change
              how several analytes are read, so fill them in when the patient can tell you. For a baby, switch
              the unit to months or days - the report carries what you type, not a rounded-down “0 years”.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
