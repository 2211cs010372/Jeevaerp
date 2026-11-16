"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { SvgArrow } from "@/components/portal/ui/svg-arrow";
import { Field, Spinner, SuccessCheck } from "@/components/portal/ui/form-atoms";
import { AgeUnitSwitch } from "@/components/portal/ui/age-unit-switch";
import { api, ApiClientError } from "@/lib/api-client";
import { AGE_MAX, ageFromDob, ageInRange, ageYears, dobFromAge, type AgeUnit } from "@/lib/age";
import { localDateISO } from "@/lib/date";
import { DuplicatePatientDialog, PhoneOnFileHint, type FiledPatient } from "@/components/portal/duplicate-patient-dialog";
import { notAPatientPhone } from "@/lib/phone";
import { phoneOnFile, type PhoneOnFile } from "@/lib/patient-duplicates";

const BLOODS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/** A plausible value for each unit, so the placeholder reads as an example. */
const AGE_PLACEHOLDER: Record<AgeUnit, string> = { Y: "29", M: "5", D: "11" };
const AGE_UNIT_WORD: Record<AgeUnit, string> = { Y: "years", M: "months", D: "days" };

interface Registered { id: string; displayId: string; fullName: string; firstName: string; age: number | null; gender: string | null; bloodGroup: string | null; }
interface EmergencyAppt { id: string; opNumber: string; time: string }
type Errs = Partial<Record<"firstName" | "phone" | "age" | "email", string>>;

/**
 * Reads ?emergency=1 - the red chip on the Today desk lands straight in casualty
 * mode, so nobody has to remember which button to press at 2 AM.
 *
 * Its own component so useSearchParams sits under <Suspense>; Next 15 requires
 * it. Same shape as PatientFromUrl on the booking form. The state lift happens
 * in an effect, never during render - a parent setState from a child's render
 * body is a React error, not just a smell.
 */
function EmergencyFromUrl({ onSet }: { onSet: () => void }) {
  const params = useSearchParams();
  const wants = params.get("emergency");
  useEffect(() => {
    if (wants) onSet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wants]);
  return null;
}

const empty = {
  firstName: "", middleName: "", lastName: "", dob: "", age: "", ageUnit: "Y" as AgeUnit, gender: "FEMALE",
  blood: "", maritalStatus: "", phone: "", altPhone: "", email: "",
  address: "", city: "", state: "", country: "India", postalCode: "",
  occupation: "", nationality: "", preferredLanguage: "",
  emergencyName: "", emergencyRelation: "", emergencyPhone: "", allergies: "", govtId: "",
  referredByName: "", referralSource: "", isVip: false, remarks: "",
};

export default function RegisterPage() {
  const [f, setF] = useState({ ...empty });
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errs>({});
  const [issued, setIssued] = useState<Registered | null>(null);
  const [emergencyAppt, setEmergencyAppt] = useState<EmergencyAppt | null>(null);
  const [emergencyMode, setEmergencyMode] = useState(false);
  /**
   * Registration is TWO writes: create the patient, then issue the emergency OP.
   * If the second one failed we used to surface a generic error and drop the
   * patient we had just created - so the receptionist pressed the button again
   * and the person ended up with two UHIDs and two files. Holding the created
   * patient here makes the retry resume from step two instead of redoing step one.
   */
  const [pendingPatient, setPendingPatient] = useState<Registered | null>(null);
  /**
   * The server's "this mobile is already on file", and which button raised it -
   * a different-person resubmit has to finish the same way (casualty or not).
   */
  const [dupe, setDupe] = useState<{ onFile: PhoneOnFile; emergency: boolean } | null>(null);
  /** The patient was on file already: nothing was registered, their ID was used. */
  const [reused, setReused] = useState(false);
  /**
   * An existing record picked in casualty mode, waiting for "yes, this one".
   * Picking is one tap on a list of everyone sharing the phone; opening an
   * emergency OP on the wrong family member is a clinical record in the wrong
   * file. So the pick only proposes - the OP is issued on the confirmation.
   */
  const [casualtyPick, setCasualtyPick] = useState<FiledPatient | null>(null);

  /** Casualty mode asks first; any other pick goes straight through. */
  const choose = (p: FiledPatient, emergency: boolean) => {
    if (emergency) { setDupe(null); setCasualtyPick(p); return; }
    void pickFiled(p, false);
  };

  const set = (k: keyof typeof empty) => (v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    if (typeof k === "string" && k in errors) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  // AGE AND DOB STAY IN SYNC, IN WHICHEVER UNIT THE ANSWER CAME IN.
  //
  // Age used to be a number of years and nothing else, which is not an answer
  // for the babies this desk registers: a nine-day-old and a nine-month-old
  // both came out as 0, and 0 put 1 January of this year in the DOB field. The
  // unit beside the number fixes both ends - what gets stored is a date of
  // birth that is right to the day for an infant, instead of a January guess.
  //
  // YEARS KEEP THE OLD RULE (1 Jan of the birth year). Somebody who says "34"
  // has not told us their birthday, and pretending they were born today would
  // be a more confident lie than the one the field already tells; the desk can
  // still type the real date over it. Months and days DO pin the exact day,
  // because for an infant the day is the whole of the answer.
  const dobForAge = (n: string, unit: AgeUnit, fallback: string) => {
    if (n === "" || !ageInRange(Number(n), unit)) return fallback;
    return unit === "Y" ? `${new Date().getFullYear() - Number(n)}-01-01` : dobFromAge(Number(n), unit);
  };

  function onAgeChange(v: string) {
    const age = v.replace(/\D/g, "").slice(0, 5);
    setF((p) => ({ ...p, age, dob: dobForAge(age, p.ageUnit, p.dob) }));
    if ("age" in errors) setErrors((p) => ({ ...p, age: undefined }));
  }
  function onAgeUnitChange(unit: AgeUnit) {
    setF((p) => ({ ...p, ageUnit: unit, dob: dobForAge(p.age, unit, p.dob) }));
    if ("age" in errors) setErrors((p) => ({ ...p, age: undefined }));
  }
  /**
   * The other direction. A date of birth eleven days ago now reads back as
   * "11 Days" rather than as "0" - same rule the rest of the system prints by
   * (lib/age): days under a month, months under two years, years after.
   */
  function onDobChange(v: string) {
    setF((p) => {
      const next = { ...p, dob: v };
      // A date in the future blanks the age rather than reading as "0 days" -
      // the same thing the years-only version did, and the only honest answer
      // to a birthday that hasn't happened.
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        if (v > localDateISO()) next.age = "";
        else {
          const said = ageFromDob(v);
          next.age = String(said.value);
          next.ageUnit = said.unit;
        }
      }
      return next;
    });
    if ("age" in errors) setErrors((p) => ({ ...p, age: undefined }));
  }

  function validate(): boolean {
    const e: Errs = {};
    if (f.firstName.trim().length < 1) e.firstName = "First name is required";
    if (!/^\d{10}$/.test(f.phone)) e.phone = "Must be a 10-digit mobile number";
    else if (notAPatientPhone(f.phone)) e.phone = "Not the patient's number - see below";
    if (f.age && !ageInRange(Number(f.age), f.ageUnit)) {
      e.age = `Enter an age up to ${AGE_MAX[f.ageUnit]} ${AGE_UNIT_WORD[f.ageUnit]}`;
    }
    if (f.email && !/^[^@]+@[^@]+\.[^@]+$/.test(f.email)) e.email = "Invalid email";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /**
   * @param reason  typed in the duplicate dialog - this is a different person
   *                from the ones already on the number.
   */
  async function submit(isEmergency = false, reason?: string) {
    setFormError(null);
    // A half-finished emergency registration resumes at the OP step. Retrying
    // the whole form would mint a second UHID for a patient already on file.
    if (pendingPatient) return issueEmergencyOp(pendingPatient);
    if (!validate()) return;
    setLoading(true);
    try {
      const { patient } = await api.post<{ patient: Registered }>("/reception/patients", {
        firstName: f.firstName.trim(), middleName: f.middleName || undefined, lastName: f.lastName || undefined,
        // The unit does not travel: `age` is completed years, and the exact
        // day - the part months and days would otherwise lose - rides in `dob`.
        dob: f.dob || undefined,
        age: f.age ? ageYears(Number(f.age), f.ageUnit) : undefined,
        // Empty means "not recorded" - the enum has no member for it, so the
        // field is left off the payload entirely rather than sent blank.
        gender: f.gender, bloodGroup: f.blood || undefined, maritalStatus: f.maritalStatus || undefined,
        phone: f.phone, alternatePhone: f.altPhone || undefined, email: f.email || undefined,
        address: f.address || undefined, city: f.city || undefined, state: f.state || undefined,
        country: f.country || undefined, postalCode: f.postalCode || undefined,
        occupation: f.occupation || undefined, nationality: f.nationality || undefined,
        preferredLanguage: f.preferredLanguage || undefined,
        emergencyContactName: f.emergencyName || undefined, emergencyContactRelation: f.emergencyRelation || undefined,
        emergencyContactPhone: f.emergencyPhone || undefined, allergies: f.allergies || undefined, govtIdNumber: f.govtId || undefined,
        referredByName: f.referredByName || undefined, referralSource: f.referralSource || undefined,
        isVip: f.isVip, remarks: f.remarks || undefined,
        sharedPhoneReason: reason,
      });

      setDupe(null);
      if (isEmergency) { await issueEmergencyOp(patient); return; }
      setIssued(patient);
    } catch (err) {
      const onFile = phoneOnFile(err);
      if (onFile) { setDupe({ onFile, emergency: isEmergency }); return; }
      setDupe(null);
      setFormError(err instanceof ApiClientError ? err.message : "Could not register. Please try again.");
    } finally { setLoading(false); }
  }

  /**
   * The patient is already on file. Nothing is registered: a casualty case goes
   * straight on to its emergency OP against the existing ID, anybody else lands
   * on the same "done" card with their existing ID to book or open.
   */
  async function pickFiled(p: FiledPatient, emergency: boolean) {
    setDupe(null); setFormError(null); setReused(true);
    if (emergency) { await issueEmergencyOp(p); return; }
    setIssued(p);
  }

  /**
   * Step two of the emergency flow: turn a registered patient into a casualty OP.
   * The patient is ALREADY saved by the time this runs, so a failure here must
   * never look like "registration failed" - it is one retryable step, and the
   * UHID is kept so the retry doesn't duplicate the person.
   */
  async function issueEmergencyOp(patient: Registered) {
    setLoading(true); setFormError(null);
    try {
      const { appointment } = await api.post<{ appointment: EmergencyAppt }>("/reception/appointments", {
        patientId: patient.id,
        type: "EMERGENCY",
      });
      setEmergencyAppt(appointment);
      setPendingPatient(null);
      setIssued(patient);
    } catch (err) {
      setPendingPatient(patient);
      setFormError(
        `${patient.firstName} is registered as ${patient.displayId} - do NOT register them again. ` +
        `Only the emergency OP number failed: ${err instanceof ApiClientError ? err.message : "please try again"}`
      );
    } finally { setLoading(false); }
  }

  function registerAnother() {
    setIssued(null); setEmergencyAppt(null); setPendingPatient(null); setDupe(null); setReused(false);
    setF({ ...empty }); setErrors({}); setFormError(null);
  }

  const fld = "w-full rounded-lg border bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none transition-all duration-200 focus:ring-2 focus:ring-[var(--p-teal)]/15";
  const ok = "border-[var(--p-border)] focus:border-[var(--p-teal)]";
  const bad = "border-[var(--p-rose)] focus:border-[var(--p-rose)]";
  const cls = (e: unknown) => `${fld} ${e ? bad : ok}`;

  if (issued) {
    return (
      <div className="mx-auto max-w-md">
        <Card enter={0} className="flex flex-col items-center p-8 text-center">
          <SuccessCheck />
          <div className="mt-3 flex items-center gap-1.5">
            <span className={`rounded px-2.5 py-0.5 font-mono text-[10.5px] font-bold uppercase text-white ${emergencyAppt ? "bg-[#dc2626]" : "bg-[#0b5f55]"}`}>
              {emergencyAppt ? "Emergency OP" : "OP"}
            </span>
          </div>
          <h3 className="mt-2 font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">
            {issued.firstName} is {reused ? "already registered" : "registered"}
          </h3>
          <p className="mt-1 text-[14px] text-[var(--p-muted)]">
            {reused
              ? emergencyAppt
                ? "No new ID - the casualty OP is open on their existing Jeeva ID, and they are marked as arrived."
                : "No new ID was issued. This is their existing Jeeva ID - their history stays in one file."
              : emergencyAppt
                ? "Jeeva ID issued and the casualty OP is open - they are already marked as arrived."
                : "Their permanent Jeeva ID has been issued and saved."}
          </p>
          <div className="mt-4 flex flex-col gap-2 rounded-xl bg-[var(--p-teal-soft)] px-6 py-3">
            <span className="font-mono text-base font-semibold text-[var(--p-teal-deep)]">UHID: {issued.displayId}</span>
            {emergencyAppt && (
              <span className="font-mono text-base font-bold text-[#dc2626]">
                OP NO: {emergencyAppt.opNumber} · {emergencyAppt.time}
              </span>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-2.5 self-stretch">
            {emergencyAppt ? (
              <a href={`/print/opd/${emergencyAppt.id}`} target="_blank" rel="noopener noreferrer"
                 className="group inline-flex items-center justify-center gap-2 rounded-lg bg-[#dc2626] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#b91c1c]">
                <Icon name="file" size={15} />
                <span>Print emergency OPD sheet</span>
                <SvgArrow size={13} className="transition-transform group-hover:translate-x-0.5" />
              </a>
            ) : (
              <a href={`/book?patient=${issued.displayId}`}
                 className="group inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)]">
                <Icon name="calendar" size={15} />
                <span>Book appointment for {issued.firstName}</span>
                <SvgArrow size={13} className="transition-transform group-hover:translate-x-0.5" />
              </a>
            )}
            <div className="flex gap-2.5">
              <a href={`/patients/${issued.displayId}`}
                 className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-[14px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                Open file
              </a>
              <button onClick={registerAnother}
                 className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-[14px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                <Icon name="plus" size={14} /> Register another
              </button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Suspense fallback={null}>
        <EmergencyFromUrl onSet={() => setEmergencyMode(true)} />
      </Suspense>
      <Card enter={0} className={`dotgrid p-6 ${emergencyMode ? "!border-[#dc2626]/40" : ""}`}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Register patient</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--p-muted)]">A permanent Jeeva ID is issued and saved instantly. Only first name and phone are required.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#dc2626]/30 bg-[#dc2626]/[0.07] px-3 py-2">
            <input type="checkbox" checked={emergencyMode} onChange={(e) => setEmergencyMode(e.target.checked)} className="h-4 w-4 accent-[#dc2626]" />
            <span className="text-[12.5px] font-bold text-[#dc2626]">Emergency / casualty case</span>
          </label>
        </div>

        {emergencyMode && (
          <div className="mb-4 rounded-lg border border-[#dc2626]/25 bg-[#dc2626]/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-[#a3160f]">
            <b>Casualty mode.</b> One press issues the Jeeva ID <i>and</i> an emergency OP number, with no doctor
            and no time slot, and marks the patient as already arrived. Fill in only what you know -
            first name and phone are the only required fields; the rest can be completed from the patient
            file once the patient is stable.
          </div>
        )}

        {formError && (
          <div data-enter className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">
            <Icon name="alert" size={15} /> <span>{formError}</span>
          </div>
        )}

        {/* The patient exists; only the OP number is missing. Offer the ONE
            action that finishes the job, and hide the paths that would create
            a second record for the same person. */}
        {pendingPatient && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--p-amber)]/30 bg-[var(--p-amber-soft)] px-4 py-3">
            <span className="text-[13px] text-[#8a6414]">
              <b>{pendingPatient.displayId}</b> is saved. Issue the emergency OP number to finish.
            </span>
            <button type="button" onClick={() => issueEmergencyOp(pendingPatient)} disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-[#dc2626] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#b91c1c] disabled:opacity-50">
              {loading ? <><Spinner /> Retrying…</> : <>Retry emergency OP</>}
            </button>
            <button type="button" onClick={() => { setPendingPatient(null); setIssued(pendingPatient); setFormError(null); }}
              className="rounded-lg border border-[var(--p-border)] px-3.5 py-2 text-[13px] font-medium text-[var(--p-text)]">
              Skip - keep registration only
            </button>
          </div>
        )}

        {casualtyPick && (
          <div className="modal-veil" role="dialog" aria-modal="true"
            onClick={(e) => { if (e.target === e.currentTarget && !loading) setCasualtyPick(null); }}>
            <div className="surface w-full max-w-sm bg-white">
              <div className="border-b border-[#dc2626]/20 bg-[#dc2626]/[0.06] px-5 py-4">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[#a3160f]">
                  <Icon name="alert" size={16} /> Issue emergency OP?
                </h3>
                <p className="mt-0.5 text-[12px] text-[var(--p-text)]">Check it is the right person - this number is shared.</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[15px] font-semibold text-[var(--p-ink)]">{casualtyPick.fullName}</p>
                <p className="font-mono text-[12px] text-[var(--p-muted)]">
                  {casualtyPick.displayId}{casualtyPick.age != null && ` · ${casualtyPick.age}y`}{casualtyPick.gender && ` · ${casualtyPick.gender}`}
                </p>
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
                <button type="button" onClick={() => setCasualtyPick(null)} disabled={loading}
                  className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">
                  Not this person
                </button>
                <button type="button" disabled={loading}
                  onClick={() => { const p = casualtyPick; setCasualtyPick(null); void pickFiled(p, true); }}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#dc2626] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#b91c1c] disabled:opacity-50">
                  {loading ? <><Spinner /> Issuing…</> : <>Yes - issue emergency OP</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {dupe && (
          <DuplicatePatientDialog
            onFile={dupe.onFile} phone={f.phone} busy={loading}
            newName={[f.firstName, f.middleName, f.lastName].map((s) => s.trim()).filter(Boolean).join(" ")}
            onUse={(p) => choose(p, dupe.emergency)}
            onDifferentPerson={(reason) => submit(dupe.emergency, reason)}
            onClose={() => setDupe(null)}
          />
        )}

        <Sec>Name</Sec>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="First name" icon="users" required error={errors.firstName}><input className={cls(errors.firstName)} value={f.firstName} onChange={(e) => set("firstName")(e.target.value)} placeholder="Divya" autoFocus /></Field>
          <Field label="Middle name"><input className={cls(false)} value={f.middleName} onChange={(e) => set("middleName")(e.target.value)} placeholder="-" /></Field>
          <Field label="Last name"><input className={cls(false)} value={f.lastName} onChange={(e) => set("lastName")(e.target.value)} placeholder="Prasad" /></Field>
        </div>

        <Sec>Demographics</Sec>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date of birth"><input type="date" className={cls(false)} value={f.dob} onChange={(e) => onDobChange(e.target.value)} /></Field>
          {/* The unit rides on the label line - the cell is one box wide.
              See AgeUnitSwitch for what went wrong when it was two. */}
          <Field label="Age" error={errors.age} aside={<AgeUnitSwitch value={f.ageUnit} onChange={onAgeUnitChange} />}>
            <input className={cls(errors.age)} value={f.age} onChange={(e) => onAgeChange(e.target.value)} inputMode="numeric" maxLength={5} placeholder={AGE_PLACEHOLDER[f.ageUnit]} />
          </Field>
          <Field label="Gender"><select className={cls(false)} value={f.gender} onChange={(e) => set("gender")(e.target.value)}><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></select></Field>
          {/* Blank first, and blank by default. A blood group nobody stated is
              not O+ - and a wrong one on the record is read as fact by whoever
              needs it in a hurry. Left empty it simply isn't recorded. */}
          <Field label="Blood group"><select className={cls(false)} value={f.blood} onChange={(e) => set("blood")(e.target.value)}><option value="">Not recorded</option>{BLOODS.map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
          <Field label="Marital status"><select className={cls(false)} value={f.maritalStatus} onChange={(e) => set("maritalStatus")(e.target.value)}><option value="">-</option><option value="SINGLE">Single</option><option value="MARRIED">Married</option><option value="DIVORCED">Divorced</option><option value="WIDOWED">Widowed</option><option value="OTHER">Other</option></select></Field>
        </div>

        <Sec>Contact</Sec>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" icon="clock" required error={errors.phone}><input className={cls(errors.phone)} value={f.phone} onChange={(e) => set("phone")(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="9000012345" /></Field>
          <Field label="Alternate phone"><input className={cls(false)} value={f.altPhone} onChange={(e) => set("altPhone")(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="-" /></Field>
          {/* Asked the moment the number is complete, not after the whole form
              is filled - the cheapest point to stop a second Jeeva ID. */}
          <PhoneOnFileHint phone={f.phone} name={[f.firstName, f.middleName, f.lastName].join(" ")}
            onUse={(p) => choose(p, emergencyMode)}
            useLabel={emergencyMode ? "Emergency OP on this record" : "Use this record"}
            className="sm:col-span-2" />
          <Field label="Email" error={errors.email} span><input className={cls(errors.email)} value={f.email} onChange={(e) => set("email")(e.target.value)} placeholder="name@example.com" /></Field>
          <Field label="Address" span><input className={cls(false)} value={f.address} onChange={(e) => set("address")(e.target.value)} placeholder="House no, area" /></Field>
          <Field label="City"><input className={cls(false)} value={f.city} onChange={(e) => set("city")(e.target.value)} placeholder="Hanamkonda" /></Field>
          <Field label="State"><input className={cls(false)} value={f.state} onChange={(e) => set("state")(e.target.value)} placeholder="Telangana" /></Field>
          <Field label="Country"><input className={cls(false)} value={f.country} onChange={(e) => set("country")(e.target.value)} /></Field>
          <Field label="PIN code"><input className={cls(false)} value={f.postalCode} onChange={(e) => set("postalCode")(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="506001" /></Field>
        </div>

        <Sec>Personal <span className="font-normal normal-case text-[var(--p-muted)]">· optional</span></Sec>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Occupation"><input className={cls(false)} value={f.occupation} onChange={(e) => set("occupation")(e.target.value)} placeholder="-" /></Field>
          <Field label="Nationality"><input className={cls(false)} value={f.nationality} onChange={(e) => set("nationality")(e.target.value)} placeholder="Indian" /></Field>
          <Field label="Preferred language"><input className={cls(false)} value={f.preferredLanguage} onChange={(e) => set("preferredLanguage")(e.target.value)} placeholder="Telugu" /></Field>
        </div>

        <Sec>Emergency &amp; medical <span className="font-normal normal-case text-[var(--p-muted)]">· optional</span></Sec>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Emergency contact name"><input className={cls(false)} value={f.emergencyName} onChange={(e) => set("emergencyName")(e.target.value)} placeholder="Ravi" /></Field>
          <Field label="Relationship"><input className={cls(false)} value={f.emergencyRelation} onChange={(e) => set("emergencyRelation")(e.target.value)} placeholder="Brother / spouse" /></Field>
          <Field label="Emergency phone"><input className={cls(false)} value={f.emergencyPhone} onChange={(e) => set("emergencyPhone")(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="9000012345" /></Field>
          <Field label="Known allergies" span><input className={cls(false)} value={f.allergies} onChange={(e) => set("allergies")(e.target.value)} placeholder="Penicillin, sulfa - or none" /></Field>
          <Field label="Govt ID (Aadhaar / ABHA)"><input className={cls(false)} value={f.govtId} onChange={(e) => set("govtId")(e.target.value)} placeholder="XXXX XXXX XXXX" /></Field>
        </div>

        <Sec>Referral <span className="font-normal normal-case text-[var(--p-muted)]">· admin-only · optional</span></Sec>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Referred by (doctor / clinic)" icon="stethoscope"><input className={cls(false)} value={f.referredByName} onChange={(e) => set("referredByName")(e.target.value)} placeholder="Dr. Anil, City Clinic" /></Field>
          <Field label="Referral source"><input className={cls(false)} value={f.referralSource} onChange={(e) => set("referralSource")(e.target.value)} placeholder="Camp / online / walk-in" /></Field>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <input id="vip" type="checkbox" checked={f.isVip} onChange={(e) => set("isVip")(e.target.checked)} className="h-4 w-4 accent-[var(--p-teal)]" />
          <label htmlFor="vip" className="text-[14px] text-[var(--p-text)]">Mark as VIP patient</label>
        </div>

        {/* Casualty mode swaps the primary action rather than sitting beside it:
            two near-identical submit buttons at 2 AM is how the wrong one gets
            pressed. The other path stays reachable, just not as the default. */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {emergencyMode ? (
            <>
              <button type="button" onClick={() => submit(true)} disabled={loading || !!pendingPatient}
                className="inline-flex items-center gap-2 rounded-lg bg-[#dc2626] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#b91c1c] disabled:opacity-50">
                {loading ? <><Spinner /> Issuing emergency OP…</> : <><Icon name="alert" size={15} /> Register &amp; issue emergency OP</>}
              </button>
              <button type="button" onClick={() => submit(false)} disabled={loading || !!pendingPatient}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-50">
                Register only
              </button>
            </>
          ) : (
            <PrimaryButton onClick={() => submit(false)} disabled={loading || !!pendingPatient}>
              {loading ? <><Spinner /> Registering…</> : <><Icon name="plus" size={15} /> Register patient</>}
            </PrimaryButton>
          )}
        </div>
      </Card>
    </div>
  );
}

function Sec({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 mt-7 border-t border-[var(--p-border)] pt-5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--p-ink)] first:mt-0 first:border-0 first:pt-0">{children}</p>;
}
