"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import {
  PrintToolbar, LetterHead, PreprintedGuide, type HospitalInfo,
} from "@/components/print/stationery";
import { isClosed, OUTCOME_LABEL, type AdmissionStatusValue } from "@/lib/admission-outcome";
import { bedLabel } from "@/lib/beds";

/**
 * THE DISCHARGE SUMMARY, SET LIKE THE LAB REPORT.
 *
 * It used to carry a layout of its own - its own header, its own type scale,
 * its own idea of what a section heading looks like. Two documents from one
 * hospital that did not look related, handed to the same family on the same day.
 *
 * So this now uses the lab report's typography: the same pre-printed / blank
 * paper toggle, the same colon-aligned identity block in two columns, the same
 * signature foot. What differs is only what has to - a discharge summary is
 * prose where a report is analytes.
 *
 * STRUCTURE WITHOUT RULES. The identity block, table headers, totals, and
 * exam readings used to be marked off with 1px border rules. Those are gone.
 * Structure now comes from tinted fills, weight, and letter-spacing instead -
 * a shaded band reads as clearly as a stroke and never leaves a stray hairline
 * if a browser or print driver rounds a sub-pixel border away. Section
 * headings carry a small solid accent mark instead of an underline, for the
 * same reason. One trade-off worth knowing: a light fill can flatten out
 * after several photocopy generations the way a solid black rule would not -
 * fine for a first-generation print or a PDF, worth another look if this
 * is handed out as a photocopied handout past that.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE LAB REPORT: this document FLOWS across
 * pages instead of being paginated into fixed-height sheets. A lab report
 * knows how many analytes it has and can measure them; a course-in-hospital
 * entry is whatever the doctor wrote, and pinning it to a fixed sheet would
 * clip the end of a sentence off a medico-legal document.
 */

interface Data {
  hospital: (HospitalInfo & { email: string | null }) | null;
  generatedAt: string;
  admission: {
    ipNumber: string; status: string; admittedAt: string; dischargedAt: string | null; days: number;
    wardName: string; bedNo: string; reason: string | null;
    observations: { id: string; body: string; kind: "NURSING" | "DISCHARGE"; authorName: string | null; createdAt: string }[];
    payerType?: string; insurer?: string | null; policyNo?: string | null;
  };
  patient: {
    displayId: string; fullName: string; age: number | null; gender: string | null;
    phone: string; address: string | null; city: string | null; bloodGroup: string | null; dob: string | null;
  };
  doctor: { name: string; specialization: string; department: string };
  clinical: {
    diagnosis: string | null; advice: string | null; nextVisit: string | null;
    labsAdvised: { name: string; ordered: boolean; declined: boolean }[];
  };
  medicines: { name: string; qty: number; dosage: string | null }[];
  investigations: { testName: string; status: string; reportReady: boolean; date: string }[];
  /** What a person typed on the shared record. Null until somebody opens one. */
  summary: {
    status: "DRAFT" | "COMPLETED";
    fields: Record<string, string | null>;
    followUpDate: string | null;
    completedBy: string | null;
  } | null;
  bill: {
    legs: { wardName: string; bedNo: string; dailyCharge: string; days: number; total: string; current: boolean }[];
    bedTotal: string; nurseTotal: string; nursePerDay: string;
    charges: { description: string; category: string; qty: number; unitPrice: string; amount: string }[];
    chargesTotal: string; grandTotal: string; advanceTotal: string; balance: string;
    /** The raised IPD invoice. Null while the patient is still in a bed. This is
     *  where the DISCOUNT lives - the running lines above never had one. */
    invoice: {
      receiptNo: string; subtotal: string; discount: string; taxable: string;
      gst: string; total: string; paid: string; balance: string;
    } | null;
  };
}

const money = (v: string | number) => "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
const GENDER: Record<string, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };

/** The examination readings, in the order the hospital's own paper lists them. */
const EXAM: [string, string][] = [
  ["vitalTemp", "Temp"], ["vitalPulse", "PR"], ["vitalBp", "BP"], ["vitalSpo2", "SpO₂"],
  ["examCvs", "CVS"], ["examRs", "RS"], ["examPa", "P/A"], ["examCns", "CNS"],
];

/**
 * Flowing A4, borrowed from the lab report's ink but not its pagination.
 *
 * `position: absolute` is what confines a single-sheet profile to one page. It
 * is absent here on purpose: this document is as long as the doctor made it,
 * and a second page is normal rather than a fault.
 */
const DS_CSS = (onStationery: boolean) => `
  /* ── INK, NOT THE HOUSE TEAL ──
     The teal reads well on a screen and washes out on a mono laser, which is
     what this document is actually printed on. Every label here is near-black
     so a photocopy of a photocopy is still legible - a discharge summary gets
     copied for the insurer, the employer and the family. The two band tints
     below are deliberately close to white for the same reason: enough to
     separate a header row on screen, faint enough not to muddy a scan. */
  .print-stage { --pr-primary: #101a18; --pr-accent: #8a5a14; --pr-ink: #0d1513;
    --pr-line: #6f7c78; --pr-muted: #4a5754; --pr-bg: #f2f5f4; --pr-band: #edf1ef; }
  .print-stage { background: #e8e6e1; min-height: 100vh; padding: 24px 12px 64px; }
  #print-sheet { width: 210mm; margin: 0 auto; background: #fff; color: var(--pr-ink);
    box-shadow: 0 8px 40px rgba(0,0,0,.18); padding: ${onStationery ? "40mm 13mm 46mm" : "10mm 11mm 12mm"};
    font-family: var(--font-sans, "Instrument Sans"), "Noto Sans Telugu", "Nirmala UI", Arial, sans-serif;
    font-size: 11.5px; line-height: 1.45; }

  /* ── THE WHOLE DOCUMENT IS ONE TABLE ──
     Not for layout - for pagination. A <thead> marked table-header-group is the
     one thing every print engine repeats at the top of each printed page, so
     sheet two of a long summary carries the patient's name instead of arriving
     as a loose page of prose nobody can identify. */
  /* table-layout: fixed pins the single column to the full 100% width
     deterministically. Left on "auto" (the default), some print/PDF engines
     size that one column to its widest line of content instead of stretching
     it to fill the table - which is exactly what makes a paragraph render at
     roughly half the page even though nothing in it says to. */
  .ds-doc { width: 100%; table-layout: fixed; border-collapse: collapse; }
  .ds-doc > thead { display: table-header-group; }
  .ds-doc > tbody { display: table-row-group; }
  .ds-doc > thead > tr > th { width: 100%; box-sizing: border-box; text-align: left; font-weight: 400; padding: 0; }
  .ds-doc > tbody > tr > td { width: 100%; box-sizing: border-box; padding: 0; vertical-align: top; }
  .ds-sec, .ds-body, .ds-tbl, .ds-id, .ds-exam { width: 100%; box-sizing: border-box; }

  .ds-title { text-align: center; font-size: 15px; font-weight: 800; letter-spacing: .08em;
    text-transform: uppercase; color: var(--pr-ink); }

  /* Identity strip: a tinted panel instead of a ruled box - the fill itself
     marks the boundary, so nothing needs a stroke to draw it. */
  .ds-id { margin-top: 6px; padding: 7px 10px; border-radius: 3px; background: var(--pr-band);
    display: grid; grid-template-columns: 1fr 1fr; column-gap: 26px; }
  .ds-id-col { display: grid; grid-template-columns: max-content 7px 1fr; align-items: baseline; }
  .ds-k { font-size: 10.5px; line-height: 4mm; color: var(--pr-muted); }
  .ds-c { font-size: 10.5px; line-height: 4mm; color: var(--pr-muted); }
  .ds-v { font-size: 11px; font-weight: 700; line-height: 4mm; color: var(--pr-ink); }
  /* Breathing room under the repeated header on every page. */
  .ds-gap { height: 6px; }

  /* A heading must never be the last thing on a page. */
  .ds-sec { break-inside: avoid; margin-top: 11px; }
  /* Weight, uppercase and letter-spacing carry the heading instead of an
     underline - no rule, no side mark. */
  .ds-sec-t { font-size: 12px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .08em; color: var(--pr-ink); }
  .ds-body { margin-top: 4px; font-size: 11.5px; line-height: 1.5; color: var(--pr-ink); }
  .ds-pre { white-space: pre-wrap; }
  .ds-muted { color: var(--pr-muted); }

  /* A shaded header band carries the column labels, a shaded row carries each
     total - the fill marks the row the way a rule used to. */
  .ds-tbl { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 11.5px; }
  .ds-tbl thead th { background: var(--pr-band); padding: 4px 6px; text-align: left; font-size: 10px;
    font-weight: 800; text-transform: uppercase; letter-spacing: .03em; color: var(--pr-ink); }
  .ds-tbl td { padding: 3px 6px; vertical-align: baseline; color: var(--pr-ink); }
  .ds-r { text-align: right; }
  .ds-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
  .ds-tot td { background: var(--pr-band); font-weight: 800; padding-top: 5px; padding-bottom: 5px; }

  /* Eight short readings as a grid: one per line is most of a sheet spent on
     eight words. Each reading sits in its own tinted chip instead of a boxed
     grid of rules. */
  .ds-exam { margin-top: 5px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 10px; }
  .ds-exam-c { display: flex; align-items: baseline; gap: 5px; min-width: 0; background: var(--pr-band);
    border-radius: 2px; padding: 2.5px 7px; }
  .ds-exam-k { flex: none; font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .08em; color: var(--pr-muted); }
  .ds-exam-v { min-width: 0; font-size: 11.5px; font-weight: 700; color: var(--pr-ink); }

  .ds-note { margin-top: 5px; padding: 4px 8px; background: var(--pr-bg); border-radius: 2px; }
  .ds-note-m { font-size: 9px; color: var(--pr-muted); }
  /* A solid filled banner reads as clearly as a dashed box, and survives a
     photocopy generation better than a hairline dash pattern does. */
  .ds-draft { margin: 6px 0 0; padding: 4px 8px; border-radius: 3px; background: var(--pr-accent);
    text-align: center; font-size: 9px; font-weight: 800; letter-spacing: .16em; color: #fff; }
  .ds-sign { break-inside: avoid; }
  /* The one line a signature genuinely needs - a mark to sign above - drawn
     as a thin filled bar rather than a border so it prints the same weight
     every time regardless of renderer. */
  .ds-sign-line { height: 1.1px; background: var(--pr-line); }

  @media print {
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    body > *:not(.print-stage) { display: none !important; }
    .print-stage { background: #fff !important; padding: 0 !important; min-height: 0 !important; }
    .screen-only { display: none !important; }
    #print-sheet { width: auto; margin: 0; box-shadow: none; padding: 0; }
    /* The reserved bands ARE the page margin on pre-printed paper, so the
       repeated header lands under the printed logo on every sheet, not just
       the first. */
    @page { size: A4 portrait; margin: ${onStationery ? "40mm 13mm 46mm" : "13mm 12mm 14mm"}; }
    /* Print the fills and the ink, not a lightened approximation - browsers
       drop background color and darken-to-toner unless told otherwise. */
    #print-sheet, #print-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export function DischargeSummary() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the summary…</div>}>
      <DischargeSummaryInner />
    </Suspense>
  );
}

function DischargeSummaryInner() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const params = useSearchParams();
  // Same default as the lab report: the tray usually has the hospital's own
  // paper in it, and the desk unticks when it does not.
  const [onStationery, setOnStationery] = useState(params.get("paper") !== "plain");
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Data>(`/ipd/admissions/${admissionId}/discharge-summary`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the summary."));
  }, [admissionId]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!d) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the discharge summary…</div>;

  const p = d.patient;
  const a = d.admission;
  const closed = isClosed(a.status);
  const outcomeNote = closed && a.status !== "DISCHARGED" ? OUTCOME_LABEL[a.status as AdmissionStatusValue] : null;

  /** The typed value wins; the derived one is a fallback for stays written
   *  before the shared record existed. */
  const f = d.summary?.fields ?? {};
  const say = (key: string, fallback?: string | null): string | null => {
    const stored = (f[key] ?? "").trim();
    if (stored) return stored;
    return (fallback ?? "").trim() || null;
  };
  const drafting = d.summary?.status === "DRAFT";
  /** The raised bill, when there is one. Carries the discount. */
  const inv = d.bill.invoice;

  const ageSex = [p.age != null ? `${p.age} Y` : null, p.gender ? GENDER[p.gender] ?? p.gender : null]
    .filter(Boolean).join(" / ") || "-";

  // Two colon-aligned columns, exactly as the lab report and the hospital's own
  // discharge paper set the identity block.
  const leftFields: { k: string; v: string; mono?: boolean }[] = [
    { k: "IP No", v: a.ipNumber, mono: true },
    { k: "UHID", v: p.displayId, mono: true },
    { k: "Name", v: p.fullName },
    { k: "Age / Sex", v: ageSex },
    { k: "Ward / Bed", v: bedLabel(a.wardName, a.bedNo) },
    { k: "Doctor", v: d.doctor.name },
    { k: "H. Panel", v: a.payerType === "INSURANCE" ? (a.insurer || "Insurance") : "Self pay / Cash" },
  ];
  const rightFields: { k: string; v: string; mono?: boolean }[] = [
    { k: "Admission Date", v: dateTime(a.admittedAt), mono: true },
    { k: "Discharge Date", v: closed ? dateTime(a.dischargedAt) : "Still admitted", mono: true },
    { k: "Type of Discharge", v: outcomeNote ?? (closed ? "Normal Discharge" : "Interim summary") },
    { k: "Length of Stay", v: `${a.days} day${a.days === 1 ? "" : "s"}` },
    { k: "Blood Group", v: p.bloodGroup ?? "-" },
    { k: "Follow-up Date", v: d.summary?.followUpDate ? date(d.summary.followUpDate) : "-" },
    { k: "Address", v: [p.address, p.city].filter(Boolean).join(", ") || "-" },
  ];

  const examShown = EXAM.filter(([k]) => say(k));

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: DS_CSS(onStationery) }} />
      <PrintToolbar title={`Discharge summary · ${a.ipNumber} · ${p.fullName}`} />

      {/* Screen-only desk control: which paper is in the tray. Same control,
          same place and same wording as the lab report. */}
      <div className="mx-auto mb-3 flex w-full max-w-[210mm] flex-wrap items-center gap-x-5 gap-y-2 print:hidden">
        <label className="flex items-center gap-2 text-[12.5px] text-[#3a4744]">
          <input type="checkbox" checked={onStationery} onChange={(e) => setOnStationery(e.target.checked)} />
          Printing on the hospital&apos;s pre-printed paper
        </label>
      </div>

      <div id="print-sheet">
        {/* Screen-only guide showing where the pre-printed ink already sits. */}
        {onStationery && <PreprintedGuide />}

        {/* ── ONE TABLE FOR THE WHOLE DOCUMENT ──
            The <thead> below is the only construct print engines reliably
            repeat at the top of every page. So sheet two of a long summary
            arrives carrying the patient's name and IP number instead of being
            a loose page of prose nobody can match to a file. */}
        <table className="ds-doc">
          <thead>
            <tr>
              <th>
                {/* On pre-printed paper the hospital header is already on the
                    sheet - printing our own would double it on every page. */}
                {!onStationery && <LetterHead hospital={d.hospital} doctor={null} />}

                <div className={onStationery ? "ds-title" : "ds-title mt-2"}>Discharge Summary</div>

                <div className="ds-id">
                  <div className="ds-id-col">
                    {leftFields.map((x) => <IdRow key={x.k} {...x} />)}
                  </div>
                  <div className="ds-id-col">
                    {rightFields.map((x) => <IdRow key={x.k} {...x} />)}
                  </div>
                </div>
                <div className="ds-gap" />
              </th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>
        {drafting && <div className="ds-draft">DRAFT &mdash; NOT YET COMPLETED</div>}

        {a.reason && <Sec t="Reason for Admission"><p className="ds-body">{a.reason}</p></Sec>}

        <Sec t="Diagnosis">
          <p className="ds-body ds-pre">{say("diagnosis", d.clinical.diagnosis) ?? "Not recorded."}</p>
        </Sec>

        {say("historyPresenting") && (
          <Sec t="History of Presenting Illness"><p className="ds-body ds-pre">{say("historyPresenting")}</p></Sec>
        )}
        {say("pastPersonalHistory") && (
          <Sec t="Past & Personal History"><p className="ds-body ds-pre">{say("pastPersonalHistory")}</p></Sec>
        )}
        {say("clinicalFindings") && (
          <Sec t="Clinical Finding"><p className="ds-body ds-pre">{say("clinicalFindings")}</p></Sec>
        )}

        {(examShown.length > 0 || say("physicalExamination") || say("systemicExamination")) && (
          <Sec t="Examination at Admission">
            {say("physicalExamination") && <p className="ds-body ds-pre">{say("physicalExamination")}</p>}
            {examShown.length > 0 && (
              <div className="ds-exam">
                {examShown.map(([k, label]) => (
                  <div key={k} className="ds-exam-c">
                    <span className="ds-exam-k">{label}</span>
                    <span className="ds-exam-v">{say(k)}</span>
                  </div>
                ))}
              </div>
            )}
            {say("systemicExamination") && (
              <>
                <p className="mt-[5px] text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--pr-muted)" }}>
                  Systemic Examination
                </p>
                <p className="ds-body ds-pre">{say("systemicExamination")}</p>
              </>
            )}
          </Sec>
        )}

        <Sec t="Course in Hospital">
          {say("courseInHospital")
            ? <p className="ds-body ds-pre">{say("courseInHospital")}</p>
            : <p className="ds-body ds-muted">Not recorded.</p>}
          {a.observations.map((n) => (
            <div key={n.id} className="ds-note">
              <p className="ds-note-m ds-mono">
                {dateTime(n.createdAt)} · {n.authorName ?? "author not recorded"}
                {n.kind === "DISCHARGE" ? " · on discharge" : ""}
              </p>
              <p className="ds-body ds-pre">{n.body}</p>
            </div>
          ))}
        </Sec>

        {say("procedureNotes") && (
          <Sec t="Operation / Procedure Notes"><p className="ds-body ds-pre">{say("procedureNotes")}</p></Sec>
        )}

        <Sec t="Condition at Discharge">
          <p className="ds-body ds-pre">{say("conditionAtDischarge") ?? "Not recorded."}</p>
        </Sec>

        {(d.investigations.length > 0 || d.clinical.labsAdvised.length > 0) && (
          <Sec t="Investigations / Lab Summary">
            {d.investigations.length > 0 && (
              <table className="ds-tbl">
                <thead><tr><th>Investigation</th><th>Date</th></tr></thead>
                <tbody>
                  {d.investigations.map((t, i) => (
                    <tr key={i}>
                      <td>{t.testName}</td>
                      <td className="ds-mono">{date(t.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {d.clinical.labsAdvised.length > 0 && (
              <p className="ds-body">
                <b>Advised:</b>{" "}
                {d.clinical.labsAdvised.map((l, i) => (
                  <span key={i}>
                    {i > 0 && ", "}{l.name}
                    {/* An advised test that was never ordered is exactly what a
                        reader of this summary needs to see. */}
                    {!l.ordered && !l.declined && <b> (not ordered)</b>}
                    {l.declined && " (declined)"}
                  </span>
                ))}
              </p>
            )}
          </Sec>
        )}

        <Sec t="Medications Advised">
          {d.medicines.length > 0 ? (
            <table className="ds-tbl">
              <thead>
                <tr>
                  <th className="w-[22px]">#</th><th>Medicine</th>
                  <th className="w-[54px]">Qty</th>
                </tr>
              </thead>
              <tbody>
                {d.medicines.map((m, i) => (
                  <tr key={i}>
                    <td className="ds-mono">{i + 1}.</td>
                    <td className="font-semibold">{m.name}</td>
                    <td className="ds-mono">{m.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="ds-body ds-muted">No discharge medications recorded.</p>}
        </Sec>

        <Sec t="Follow Up Instruction">
          <p className="ds-body ds-pre">{say("followUpInstruction", d.clinical.advice) ?? "As advised."}</p>
          {(d.summary?.followUpDate || d.clinical.nextVisit) && (
            <p className="ds-body">
              <b>Review on:</b>{" "}
              {d.summary?.followUpDate ? date(d.summary.followUpDate) : d.clinical.nextVisit}
            </p>
          )}
        </Sec>

        {say("preventiveAdvice") && (
          <Sec t="Preventive Advised"><p className="ds-body ds-pre">{say("preventiveAdvice")}</p></Sec>
        )}

        <Sec t="Billing Summary">
          <table className="ds-tbl">
            <tbody>
              {d.bill.legs.length > 0 ? d.bill.legs.map((l, i) => (
                <tr key={i}>
                  <td>Bed · {bedLabel(l.wardName, l.bedNo)} <span className="ds-muted">({l.days}d × {money(l.dailyCharge)})</span></td>
                  <td className="ds-r ds-mono">{money(l.total)}</td>
                </tr>
              )) : <tr><td>Bed charges</td><td className="ds-r ds-mono">{money(d.bill.bedTotal)}</td></tr>}
              <tr>
                <td>Nursing care <span className="ds-muted">({a.days}d × {money(d.bill.nursePerDay)})</span></td>
                <td className="ds-r ds-mono">{money(d.bill.nurseTotal)}</td>
              </tr>
              {d.bill.charges.map((c, i) => (
                <tr key={`c${i}`}>
                  <td>{c.description} <span className="ds-muted">({c.qty} × {money(c.unitPrice)})</span></td>
                  <td className="ds-r ds-mono">{money(c.amount)}</td>
                </tr>
              ))}
              {/* ── WHAT WAS ACTUALLY CHARGED ──
                  The lines above are what the stay was made of. Once discharge
                  raises the bill, THESE are the figures the family was asked
                  for - and the discount is the difference between the two. A
                  summary showing only the gross total sends a family back to the
                  desk asking why their bill was lower than their summary. */}
              {inv ? (
                <>
                  <tr className="ds-tot"><td>Gross total</td><td className="ds-r ds-mono">{money(inv.subtotal)}</td></tr>
                  {Number(inv.discount) > 0 && (
                    <tr><td>Discount</td><td className="ds-r ds-mono">− {money(inv.discount)}</td></tr>
                  )}
                  {Number(inv.gst) > 0 && (
                    <tr><td>GST</td><td className="ds-r ds-mono">{money(inv.gst)}</td></tr>
                  )}
                  <tr className="ds-tot">
                    <td>Net bill <span className="ds-muted">({inv.receiptNo})</span></td>
                    <td className="ds-r ds-mono">{money(inv.total)}</td>
                  </tr>
                  {Number(d.bill.advanceTotal) > 0 && (
                    <tr><td>Advance received</td><td className="ds-r ds-mono">− {money(d.bill.advanceTotal)}</td></tr>
                  )}
                  {Number(inv.paid) > 0 && (
                    <tr><td>Paid</td><td className="ds-r ds-mono"> {money(inv.paid)}</td></tr>
                  )}
                  
                </>
              ) : (
                <>
                  <tr className="ds-tot"><td>Running total</td><td className="ds-r ds-mono">{money(d.bill.grandTotal)}</td></tr>
                  {Number(d.bill.advanceTotal) > 0 && (
                    <>
                      <tr><td>Advance received</td><td className="ds-r ds-mono">− {money(d.bill.advanceTotal)}</td></tr>
                      <tr className="ds-tot">
                        <td>{Number(d.bill.balance) > 0 ? "Balance so far" : "Settled"}</td>
                        <td className="ds-r ds-mono">{money(d.bill.balance)}</td>
                      </tr>
                    </>
                  )}
                </>
              )}
            </tbody>
          </table>
        </Sec>

        {/* SIGN-OFF - the lab report's foot, with the two signatures the
            hospital's discharge paper carries. The RMO line is left blank on
            purpose: printing a name under a signature nobody signed would be
            inventing one on a medico-legal document. The mark to sign above is
            a filled bar, not a border, so it holds the same weight everywhere
            it prints. */}
        <div className="ds-sign mt-6 flex items-end justify-between gap-10">
          <div className="w-[52mm] text-center">
            <div className="ds-sign-line h-[9mm]" />
            <div className="mt-[2px] text-[10px] font-semibold" style={{ color: "var(--pr-ink)" }}>{d.doctor.name}</div>
            <div className="text-[8px] uppercase tracking-[0.12em]" style={{ color: "var(--pr-muted)" }}>
              Consultant Doctor
            </div>
          </div>
          <div className="w-[52mm] text-center">
            <div className="ds-sign-line h-[9mm]" />
            <div className="mt-[2px] text-[10px] font-semibold">&nbsp;</div>
            <div className="text-[8px] uppercase tracking-[0.12em]" style={{ color: "var(--pr-muted)" }}>
              Resident Medical Officer
            </div>
          </div>
        </div>

        <p className="mt-[6px] text-[8px] italic leading-[1.4]" style={{ color: "var(--pr-muted)" }}>
          Computer-generated discharge summary, printed {dateTime(d.generatedAt)}. Keep this for your records and
          carry it to every follow-up visit.
        </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Label, its own colon column, value - the lab report's identity row. The
 *  colon has a column to itself so it cannot drift as values wrap. */
function IdRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <span className="ds-k">{k}</span>
      <span className="ds-c">:</span>
      <span className={`ds-v ${mono ? "font-mono tracking-tight" : ""}`}>{v || "-"}</span>
    </>
  );
}

/** A section: a small filled accent mark and weight in the lab report's
 *  idiom, then its body - no underline. */
function Sec({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <section className="ds-sec">
      <h2 className="ds-sec-t">{t}</h2>
      {children}
    </section>
  );
}