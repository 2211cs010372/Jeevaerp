"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import {
  PRINT_CSS, STATIONERY_PRINT_CSS, PrintToolbar, LetterHead, DoctorHead, PreprintedGuide,
  SheetTitle, SectionHead, FieldGrid, VitalsGrid, OpenBlock, RxPad,
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
 *   /print/opd/blank?doctor={id}             a pad headed with that consultant
 *
 * PAPER. The hospital prints on its own PRE-PRINTED stationery - the sheet that
 * already carries the logo, the wordmark and the address/QR footer in ink - so
 * that is the default for every staff portal (`?paper=stationery`). On that
 * paper the app prints nothing but the consulting doctor (set into the gap the
 * hospital hand-writes today) and the clinical body, landing between the two
 * reserved bands. Pass `?paper=plain` to draw the letterhead as well - that is
 * the default for the patient portal, whose copy is read on a screen or printed
 * at home on blank paper and would otherwise arrive with no hospital on it.
 *
 * There is NO generated PDF anywhere: the sheet is the live view of the visit's
 * ℞ items + clinical fields, so it's identical across reception, doctor, labs,
 * pharmacy and admin - and always current.
 */

interface Data {
  hospital: HospitalInfo | null;
  appointment: { id: string; opNumber: string; type: string; status: string; visitDate: string; time: string; referredByName: string | null; visitNumber: number };
  /** `named: false` = a casualty case with no consultant on record yet. */
  doctor: { name: string; specialization: string; department: string; qualification: string | null; named: boolean };
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null; bloodGroup: string | null; phone: string; address: string | null; city: string | null };
  rxItems: { medicineName: string; qty: number; dosage: string | null }[];
  vitals: {
    bpSystolic: number | null; bpDiastolic: number | null; pulse: number | null;
    tempF: number | null; spo2: number | null; heightCm: number | null; weightKg: number | null;
  } | null;
  clinical: { diagnosis: string | null; advice: string | null; labs: string[]; nextVisit: string | null; caseHistory: string | null } | null;
  /** What the lab wrote against this visit's completed tests. */
  labImpressions?: { testName: string; impression: string }[];
}

/** A consultant a blank pad can be headed with, from the doctors list. */
interface DoctorOption { id: string; name: string; specialization: string; qualification: string | null }

const to12h = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return hhmm;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m ?? 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const pretty = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/**
 * The six vitals the hospital's own paper lists, in its own order - three
 * across, two down. Reception types the handwritten triage numbers back in;
 * anything not typed prints as blank paper for the pen.
 *
 * BMI / BSA are deliberately NOT here: the pre-printed sheet has room for six
 * boxes, and a derived number is worth less on it than the writing space.
 */
function vitalsBoxes(v: Data["vitals"]): { label: string; value: string | null }[] {
  return [
    { label: "BP (mmHg)", value: v?.bpSystolic != null && v?.bpDiastolic != null ? `${v.bpSystolic}/${v.bpDiastolic}` : null },
    { label: "Pulse (bpm)", value: v?.pulse != null ? String(v.pulse) : null },
    { label: "SpO₂ (%)", value: v?.spo2 != null ? String(v.spo2) : null },
    { label: "Temp (°F)", value: v?.tempF != null ? v.tempF.toFixed(1) : null },
    { label: "Height (cm)", value: v?.heightCm != null ? v.heightCm.toFixed(1) : null },
    { label: "Weight (kg)", value: v?.weightKg != null ? v.weightKg.toFixed(1) : null },
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
  /** Headed-blank mode: a Jeeva ID to print the patient block from. */
  const headedFor = isBlank && source === "staff" ? params.get("patient")?.trim() : null;
  const headedType = params.get("type")?.trim() || "OP";

  // Which paper is in the tray. Staff print on the hospital's pre-printed
  // stationery; the patient's own copy needs the letterhead drawn. Held in
  // state so the desk can flip it from the toolbar without re-navigating -
  // the one day the pre-printed stock runs out shouldn't need a dev.
  const paperParam = params.get("paper");
  const [onStationery, setOnStationery] = useState(
    paperParam === "plain" ? false
      : paperParam === "stationery" || paperParam === "letterhead" ? true
        : source === "staff",
  );

  const [data, setData] = useState<Data | null>(null);
  const [headed, setHeaded] = useState<Data["patient"] | null>(null);
  const [headedFailed, setHeadedFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overflowMm, setOverflowMm] = useState(0);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [pickedDoctorId, setPickedDoctorId] = useState(isBlank ? params.get("doctor")?.trim() ?? "" : "");

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

  // The sheet is ONE page: print pins it to the paper, so anything past the
  // bottom is simply not printed. Long case history or advice can do that, and
  // a clinical line lost silently between the screen and the tray is the worst
  // failure this page has - so measure it and say so before anyone prints.
  //
  // The test is the sheet's own height against the paper, NOT scrollHeight vs
  // clientHeight: the sheet is min-height + flex, so it GROWS past A4 rather
  // than scrolling, and an overflow check would read zero every time.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const probe = document.createElement("div");
    probe.style.cssText = "width:100mm;position:absolute;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const mmPerPx = 100 / probe.offsetWidth;
    probe.remove();
    const over = el.offsetHeight * mmPerPx - (onStationery ? 297 : 296);
    setOverflowMm(over > 1 ? Math.round(over) : 0);
  }, [data, headed, onStationery, pickedDoctorId]);

  // Consultants for the blank pad's picker. Reception-scoped, so a doctor- or
  // labs-portal user simply gets no picker rather than an error - the pad still
  // prints, just without a name in the header gap.
  useEffect(() => {
    if (!isBlank || source !== "staff") return;
    let live = true;
    api.get<{ doctors: DoctorOption[] }>("/reception/doctors")
      .then((r) => { if (live) setDoctors(r.doctors ?? []); })
      .catch(() => { /* no picker; not worth a banner */ });
    return () => { live = false; };
  }, [isBlank, source]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!isBlank && !data) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the OPD sheet…</div>;
  if (headedFor && !headed && !headedFailed) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the OPD sheet…</div>;

  const hospital = data?.hospital ?? null;
  const a = data?.appointment ?? null;
  const p = data?.patient ?? null;
  const rxItems = data?.rxItems ?? [];
  const v = data?.vitals ?? null;
  const clin = data?.clinical ?? null;
  const labImpressions = isBlank ? [] : data?.labImpressions ?? [];
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  // Who the sheet is headed with. A real visit uses its own consultant (unless
  // nobody was named - a casualty sheet leaves the gap for the pen); a blank pad
  // uses whoever was picked.
  const picked = doctors.find((d) => d.id === pickedDoctorId) ?? null;
  const headDoctor = isBlank
    ? picked
    : data!.doctor.named ? data!.doctor : null;

  const ageSex = (age: number | null, gender: string | null) =>
    [age != null ? `${age} y` : null, gender ?? null].filter(Boolean).join(" / ");

  // The visit classification, set at the right end of the masthead rule rather
  // than on a band of its own. A casualty case still gets solid red - that is
  // the first thing a medico-legal reader looks for and it must survive a mono
  // laser - but a routine OP no longer spends a whole line saying "routine".
  const visitType = (isBlank ? (headed ? headedType : "OP") : a!.type).toUpperCase();
  const isEmergency = visitType === "EMERGENCY" || visitType === "CASUALTY";
  const classification = isEmergency ? (
    <span className="shrink-0 rounded-sm px-2 py-[2px] text-[8.5px] font-medium text-white"
      style={{ background: "#c8211b", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
      {visitType === "CASUALTY" ? "Casualty OP" : "Emergency OP"}
    </span>
  ) : (
    <span className="shrink-0 text-[8.5px] font-bold uppercase tracking-[0.16em] text-[#7c8a85]">Out-patient</span>
  );

  /** Name / Age / Date · Phone / UHID / OP No · Address - the client's own grid. */
  const patientFields = headed
    ? [
      { k: "Name", v: headed.fullName },
      { k: "Age", v: ageSex(headed.age, headed.gender) },
      { k: "Date", v: today, mono: true as const },
      { k: "Phone", v: headed.phone, mono: true as const },
      { k: "UHID", v: headed.displayId, mono: true as const },
      { k: "OP No", v: "" },
      { k: "Address", v: [headed.address, headed.city].filter(Boolean).join(", "), span: 3 as const },
    ]
    : isBlank
      ? [
        { k: "Name", v: "" }, { k: "Age", v: "" }, { k: "Date", v: "" },
        { k: "Phone", v: "" }, { k: "UHID", v: "" }, { k: "OP No", v: "" },
        { k: "Address", v: "", span: 3 as const },
      ]
      : [
        { k: "Name", v: p!.fullName },
        { k: "Age", v: ageSex(p!.age, p!.gender) },
        { k: "Date", v: `${pretty(a!.visitDate)} · ${to12h(a!.time)}`, mono: true as const },
        { k: "Phone", v: p!.phone, mono: true as const },
        { k: "UHID", v: p!.displayId, mono: true as const },
        { k: "OP No", v: a!.opNumber, mono: true as const },
        { k: "Address", v: [p!.address, p!.city].filter(Boolean).join(", "), span: 3 as const },
      ];

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: onStationery ? STATIONERY_PRINT_CSS : PRINT_CSS }} />
      <PrintToolbar title={
        headed ? `OPD case sheet · ${headed.fullName} · ${headed.displayId}`
          : isBlank ? "OPD case sheet · blank pad"
            : `OPD sheet · ${a!.opNumber} · ${p!.fullName}`
      } />

      {/* Screen-only desk controls: which paper, and (for a pad) whose name. */}
      <div className="mx-auto mb-3 flex w-full max-w-[210mm] flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
        <label className="flex items-center gap-2 text-[12.5px] text-[#3a4744]">
          <input type="checkbox" checked={onStationery} onChange={(e) => setOnStationery(e.target.checked)} />
          Printing on the hospital&apos;s pre-printed paper
        </label>
        {isBlank && doctors.length > 0 && (
          <label className="flex items-center gap-2 text-[12.5px] text-[#3a4744]">
            Doctor
            <select value={pickedDoctorId} onChange={(e) => setPickedDoctorId(e.target.value)}
              className="rounded-lg border border-[#c8ccc9] bg-white px-2.5 py-1.5 text-[12.5px]">
              <option value="">— leave blank —</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.name} · {d.specialization}</option>)}
            </select>
          </label>
        )}
      </div>

      {overflowMm > 0 && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] rounded-lg border border-[#e0c9a6] bg-[#fdf6e9] px-4 py-2.5 text-[13px] text-[#8a6414] print:hidden">
          This visit&apos;s notes run about {overflowMm}mm past the printable area - that much will be cut off at the
          bottom of the sheet. Shorten the case history or advice, or hand the rest on a second sheet.
        </p>
      )}

      {/* Screen only - the pad below still prints, just without the name block. */}
      {headedFailed && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] rounded-lg border border-[#e0c9a6] bg-[#fdf6e9] px-4 py-2.5 text-[13px] text-[#8a6414] print:hidden">
          Couldn&apos;t load that patient&apos;s details - printing an unheaded blank pad instead.
        </p>
      )}

      <div id="print-sheet" ref={sheetRef}>
        {onStationery ? (
          <>
            <PreprintedGuide />
            <DoctorHead doctor={headDoctor} inset />
          </>
        ) : (
          <>
            <LetterHead hospital={hospital} doctor={null} />
            <DoctorHead doctor={headDoctor} />
          </>
        )}

        <div className={onStationery ? "mt-0" : "mt-4"}>
          <SheetTitle right={classification} />
        </div>

        <div className="mt-2.5">
          <FieldGrid fields={patientFields} />
        </div>

        <div className="mt-1.5">
          <VitalsGrid items={vitalsBoxes(isBlank ? null : v)} />
        </div>

        <div className="mt-[0.5vw]" >
          <OpenBlock label="Case history" value={isBlank ? null : clin?.caseHistory} minHeight="10mm" />
        </div>
        {/* Diagnosis is not one of the client's printed headings, but reception
            can type one - so it prints as a line under the history when it
            exists and costs the sheet nothing when it doesn't. */}
        {clin?.diagnosis?.trim() && (
          <p className="mt-1 text-[12px]">
            <span className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--pr-primary)" }}>Diagnosis </span>
            <span className="font-semibold" style={{ color: "var(--pr-ink)" }}>{clin.diagnosis}</span>
          </p>
        )}

        {/* The lab's own words on the tests it finished for this visit. Printed
            as "Test - impression" under the lab's name, never merged into the
            Diagnosis line: that line is the consultant's. */}
        <OpenBlock
          label="Investigation"
          value={labImpressions.length
            ? labImpressions.map((l) => `${l.testName} — ${l.impression}`).join("\n")
            : null}
          minHeight="10mm"
          footnote={labImpressions.length ? "Laboratory impression on the specimen - not a clinical diagnosis." : undefined}
        />

        <RxPad items={isBlank ? [] : rxItems} slots={8} />

        <div className="mt-[0.5vw]">
          <OpenBlock label="Tests prescribed" value={clin?.labs?.length ? clin.labs.join("\n") : null} minHeight="12mm" />
        </div>
        <OpenBlock label="Advice" value={clin?.advice} minHeight="12mm" />

        <div className="  ">
          <SectionHead label="Next visit" trailing={
            <span className="shrink-0 pl-2 text-[12px] font-semibold" style={{ color: "var(--pr-ink)" }}>
              {clin?.nextVisit?.trim() || ""}
            </span>
          } />
        </div>
      </div>
    </div>
  );
}
