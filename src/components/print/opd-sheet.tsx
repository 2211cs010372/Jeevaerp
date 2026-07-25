"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import {
  PRINT_CSS, PrintToolbar, LetterHead, PatientStrip, VisitTypeBand, RuledLine, FilledLine, LabList, RxTable, FooterBand,
  type HospitalInfo,
} from "@/components/print/stationery";

/**
 * The ONE OPD case sheet - shared by every portal (like InvoiceSheet is for
 * bills). It renders the same Jeeva stationery in four modes:
 *
 *   /print/opd/{id}                          computer-filled from the visit record
 *   /print/opd/blank                         an empty pad to print and hand-write
 *   /print/opd/blank?patient=JMH…&type=OP    HEADED BLANK: the patient's own
 *                                            details and a visit-type band, with
 *                                            the clinical body left for the pen
 *   append ?paper=letterhead                 suppress the printed header/footer for
 *                                            feeding pre-printed letterhead stock
 *
 * The headed blank is what the desk hands a walk-in who is about to be seen: the
 * name, UHID, phone and blood group are the parts that get mis-copied by hand,
 * and everything a doctor must actually decide stays blank. It carries NO OP
 * number, because no visit exists yet - that line is a rule to write on.
 *
 * There is NO generated PDF anywhere: the sheet is the live view of the visit's
 * ℞ items + clinical fields, so it's identical across reception, doctor, labs,
 * pharmacy and admin - and always current.
 */

interface Data {
  hospital: HospitalInfo | null;
  appointment: { id: string; opNumber: string; type: string; status: string; visitDate: string; time: string; referredByName: string | null; visitNumber: number };
  /** `named: false` = a casualty case with no consultant on record yet. */
  doctor: { name: string; specialization: string; department: string; named: boolean };
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null; bloodGroup: string | null; phone: string; address: string | null; city: string | null };
  rxItems: { medicineName: string; qty: number; dosage: string | null }[];
  vitals: {
    bpSystolic: number | null; bpDiastolic: number | null; pulse: number | null;
    tempF: number | null; spo2: number | null; heightCm: number | null; weightKg: number | null;
  } | null;
  clinical: { diagnosis: string | null; advice: string | null; labs: string[]; nextVisit: string | null } | null;
}

const to12h = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return hhmm;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m ?? 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const pretty = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/**
 * The vitals boxes - blank for the triage pen until reception types the
 * handwritten numbers in. BMI / BSA are computed here from height + weight -
 * never stored, so they can't go stale if either number is corrected later.
 */
function vitalsBoxes(v: Data["vitals"]): { label: string; value: string | null }[] {
  const heightM = v?.heightCm ? v.heightCm / 100 : null;
  const bmi = heightM && v?.weightKg ? v.weightKg / (heightM * heightM) : null;
  const bsa = v?.heightCm && v?.weightKg ? Math.sqrt((v.heightCm * v.weightKg) / 3600) : null;
  return [
    { label: "BP (mmHg)", value: v?.bpSystolic != null && v?.bpDiastolic != null ? `${v.bpSystolic}/${v.bpDiastolic}` : null },
    { label: "Pulse (bpm)", value: v?.pulse != null ? String(v.pulse) : null },
    { label: "Height (cm)", value: v?.heightCm != null ? v.heightCm.toFixed(1) : null },
    { label: "Weight (kg)", value: v?.weightKg != null ? v.weightKg.toFixed(1) : null },
    { label: "Temp (°F)", value: v?.tempF != null ? v.tempF.toFixed(1) : null },
    { label: "BMI", value: bmi ? bmi.toFixed(1) : null },
    { label: "SpO₂ (%)", value: v?.spo2 != null ? String(v.spo2) : null },
    { label: "BSA (m²)", value: bsa ? bsa.toFixed(2) : null },
  ];
}

/** "staff" reads the staff endpoint; "portal" reads the patient-scoped one. */
export function OpdSheet({ source = "staff" }: { source?: "staff" | "portal" } = {}) {
  return (
    <Suspense fallback={<div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the OPD sheet…</div>}>
      <OpdSheetInner source={source} />
    </Suspense>
  );
}

function OpdSheetInner({ source }: { source: "staff" | "portal" }) {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const params = useSearchParams();
  const isBlank = appointmentId === "blank";
  const onLetterhead = params.get("paper") === "letterhead";
  /** Headed-blank mode: a Jeeva ID to print the patient block from. */
  const headedFor = isBlank && source === "staff" ? params.get("patient")?.trim() : null;
  const headedType = params.get("type")?.trim() || "OP";
  const [data, setData] = useState<Data | null>(null);
  const [headed, setHeaded] = useState<Data["patient"] | null>(null);
  const [headedFailed, setHeadedFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isBlank) return; // nothing to fetch - the emptiness is the point
    const path = source === "portal"
      ? `/portal/appointments/${appointmentId}/print`
      : `/reception/appointments/${appointmentId}/print`;
    api.get<Data>(path)
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the sheet."));
  }, [appointmentId, isBlank, source]);

  // The patient block for a headed blank. A failure here does NOT block the
  // page: an unheaded pad is still a usable sheet, and refusing to print one at
  // a busy desk would be worse than printing it without the name filled in.
  useEffect(() => {
    if (!headedFor) return;
    let live = true;
    api.get<{ patient: Data["patient"] }>(`/reception/patients/${encodeURIComponent(headedFor)}`)
      .then((r) => { if (live) setHeaded(r.patient); })
      .catch(() => { if (live) setHeadedFailed(true); });
    return () => { live = false; };
  }, [headedFor]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!isBlank && !data) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the OPD sheet…</div>;
  if (headedFor && !headed && !headedFailed) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the OPD sheet…</div>;

  const hospital = data?.hospital ?? null;
  const a = data?.appointment ?? null;
  const doctor = data?.doctor ?? null;
  const p = data?.patient ?? null;
  const rxItems = data?.rxItems ?? [];
  const v = data?.vitals ?? null;
  const clin = data?.clinical ?? null;
  const blankRows = isBlank ? 10 : Math.max(0, 5 - rxItems.length);
  const dash = "";
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <PrintToolbar title={
        headed ? `OPD case sheet · ${headed.fullName} · ${headed.displayId}`
          : isBlank ? "OPD case sheet · blank pad"
          : `OPD sheet · ${a!.opNumber} · ${p!.fullName}`
      } />

      {/* Screen only - the pad below still prints, just without the name block. */}
      {headedFailed && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] rounded-lg border border-[#e0c9a6] bg-[#fdf6e9] px-4 py-2.5 text-[13px] text-[#8a6414] print:hidden">
          Couldn&apos;t load that patient&apos;s details - printing an unheaded blank pad instead.
        </p>
      )}

      <div id="print-sheet">
        {onLetterhead ? (
          <div style={{ height: "34mm" }} aria-hidden />
        ) : (
          <LetterHead hospital={hospital} doctor={isBlank || !doctor?.named ? null : doctor} />
        )}

        {headed ? (
          /* HEADED BLANK - identity printed, everything clinical left for the pen.
             OP No and Doctor stay as rules: no visit exists yet, and printing a
             number that no record backs would be worse than an empty line. */
          <>
            <VisitTypeBand type={headedType} />
            <PatientStrip cells={[
              { k: "Name", v: `${headed.fullName}${headed.age != null || headed.gender ? ` (${[headed.age != null ? `${headed.age}y` : null, headed.gender ?? null].filter(Boolean).join(", ")})` : ""}`, grow: true },
              { k: "Date", v: today, mono: true },
            ]} />
            <PatientStrip cells={[
              { k: "Phone", v: headed.phone, mono: true },
              { k: "UHID", v: headed.displayId, mono: true },
              { k: "OP No", v: dash, pen: true },
            ]} />
            <PatientStrip cells={[
              { k: "Address", v: [headed.address, headed.city].filter(Boolean).join(", "), grow: true },
              { k: "Blood", v: headed.bloodGroup ?? "-" },
              { k: "Doctor", v: dash, pen: true },
            ]} />
          </>
        ) : isBlank ? (
          <>
            <PatientStrip cells={[
              { k: "Name", v: dash, grow: true, pen: true },
              { k: "Age / Sex", v: dash, pen: true },
              { k: "Phone", v: dash, pen: true },
              { k: "UHID", v: dash, pen: true },
              { k: "OP No", v: dash, pen: true },
            ]} />
            <PatientStrip cells={[
              { k: "Address", v: dash, grow: true, pen: true },
              { k: "Blood", v: dash, pen: true },
              { k: "Date", v: dash, pen: true },
              { k: "Doctor", v: dash, pen: true },
            ]} />
          </>
        ) : (
          <>
            <VisitTypeBand type={a!.type} />
            <PatientStrip cells={[
              { k: "Name", v: `${p!.fullName}${p!.age != null || p!.gender ? ` (${[p!.age != null ? `${p!.age}y` : null, p!.gender ?? null].filter(Boolean).join(", ")})` : ""}`, grow: true },
              { k: "Date", v: `${pretty(a!.visitDate)} · ${to12h(a!.time)}`, mono: true },
            ]} />
            <PatientStrip cells={[
              { k: "Phone", v: p!.phone, mono: true },
              { k: "UHID", v: p!.displayId, mono: true },
              { k: "OP No", v: a!.opNumber, mono: true },
            ]} />
            <PatientStrip cells={[
              { k: "Address", v: [p!.address, p!.city].filter(Boolean).join(", "), grow: true },
              { k: "Blood", v: p!.bloodGroup ?? "-" },
              { k: "#Visit", v: String(a!.visitNumber), mono: true },
              // Nobody was named at the desk. Give casualty a line to write who
              // actually attended - the sheet is a medico-legal record, and a
              // printed "Duty Medical Officer" alone does not identify anyone.
              ...(doctor && !doctor.named ? [{ k: "Attended by", v: dash, pen: true }] : []),
            ]} />
          </>
        )}

        {/* vitals - computerized once reception has typed them in; still a blank
            ruled box for the triage pen for anything not typed yet */}
        <div className=" flex flex-wrap gap-x-4 gap-y-2.5 py-4.5">
          {vitalsBoxes(isBlank ? null : v).map((b) => (
            <span key={b.label} className="flex items-end gap-1 text-[9.5px] font-semibold text-[#3c4a45]">
              {b.label}{" "}
              {b.value ? (
                <span className="mb-0.5 inline-block min-w-[72px] border-b border-[var(--pr-line)] px-3.5 text-center font-mono text-[10.5px] font-bold" style={{ color: "var(--pr-primary)" }}>
                  {b.value}
                </span>
              ) : (
                <span className="mb-0.5 inline-block w-[52px] border-b border-[var(--pr-line)]" />
              )}
            </span>
          ))}
        </div>

        <div className="rule py-5 text-[11px]">
          <span className="font-bold uppercase tracking-wide text-[#3c4a45]">Allergy:</span>
          <span className="mx-2 inline-block w-[220px] border-b border-[var(--pr-line)] align-middle" />
          <span className="text-[9px] text-[#6b7772]">(REVIEW SOS IN CASE OF DRUG INTOLERANCE)</span>
        </div>

        <RuledLine label="Evaluation / Investigations" lines={2} />
        <FilledLine label="Diagnosis" value={clin?.diagnosis} />

        <RxTable
          items={rxItems}
          blankRows={blankRows}
          note="As transcribed at the front desk from the doctor's handwritten prescription - the scanned original stays on the patient's record."
        />

        <div className="mt-2">
          {clin?.labs?.length ? (
            <LabList tests={clin.labs} />
          ) : (
            <RuledLine label="Tests prescribed" />
          )}
          <FilledLine label="Advice" value={clin?.advice} />
          <div className="flex gap-6">
            <div className="flex-1" />
            <div className="w-[260px]"><FilledLine label="Next visit" value={clin?.nextVisit} /></div>
          </div>
        </div>

        {/* signature */}
        <div className="mb-4 mt-6 flex items-end justify-between">
          <p className="text-[8.5px] text-[#6b7772]">
            {headed
              ? `Attach to ${headed.displayId}'s visit record once the OP number is written above. Not valid for medico-legal use without signature.`
              : isBlank
              ? "Attach to the patient's visit record. Not valid for medico-legal use without signature."
              : `This sheet accompanies the visit record ${a!.opNumber}. Not valid for medico-legal use without signature.`}
          </p>
          <div className="text-center">
            <div className="mx-auto w-[180px] border-b border-[var(--pr-ink)]" />
            {/* "Dr." belongs to a person. An unattributed casualty sheet prints
                the ROLE and leaves the name to the pen - "Dr. Duty Medical
                Officer" would be a signature block for nobody. */}
            <div className="mt-1 text-[11px] font-semibold">
              {isBlank ? "Doctor's signature & seal" : doctor!.named ? `Dr. ${doctor!.name}` : doctor!.name}
            </div>
            <div className="text-[8.5px] text-[#57655f]">
              {isBlank ? "Reg. no." : doctor!.named ? `${doctor!.specialization} · ${doctor!.department}` : `${doctor!.department} · Name & Reg. no.`}
            </div>
          </div>
        </div>

        {onLetterhead ? <div style={{ height: "14mm" }} aria-hidden /> : <FooterBand hospital={hospital} />}
      </div>
    </div>
  );
}
