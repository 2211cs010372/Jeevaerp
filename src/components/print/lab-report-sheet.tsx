"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import {
  analyteDescription, analyteFlagNote, specimenFor, departmentFor, methodFor,
} from "@/lib/lab-reference";
import {
  PRINT_CSS, STATIONERY_PRINT_CSS, PrintToolbar, LetterHead, PreprintedGuide,
  type HospitalInfo,
} from "@/components/print/stationery";

/**
 * The ONE laboratory report, drawn to the hospital's own Jeeva Diagnostics
 * stationery - the layout every doctor around Hanamkonda already reads:
 *
 *   /print/lab/{labTestId}                   the finished report
 *   /print/lab/{labTestId}?paper=plain       drawn letterhead, for blank stock
 *   /print/lab/{labTestId}?notes=off         without the reference notes
 *
 * THE FORMAT. Two identity columns over a four-column table headed TEST
 * DESCRIPTION / RESULT / UNITS / BIOLOGICAL REFERENCE INTERVAL, a centred
 * department band, the panel name underlined beneath it, and a "Method :" line
 * under each investigation. Out-of-range values are set BOLD, which is the
 * marking on the hospital's existing report and the one thing on this sheet
 * that has to survive a mono laser.
 *
 * PAPER. Same contract as the OPD sheet: the hospital prints on PRE-PRINTED
 * stationery carrying the logo, the wordmark and the address/QR band in ink, so
 * the app prints into the gap between them (`?paper=stationery`, the staff
 * default). `?paper=plain` draws the letterhead for a report emailed or printed
 * at home.
 *
 * WHAT IS NOT PRINTED. Collected On, Received On and Sample Id are on the
 * hospital's paper form but are not recorded anywhere in this system, so they
 * print as "-" rather than as a plausible-looking number. A chain-of-custody
 * field invented by the software is worse than a blank one. The same rule
 * governs the pathologist's block: the sheet prints whatever name and
 * registration number the hospital has configured, and a blank signature rule
 * when it has none - it will not print a doctor's credentials it was never
 * given.
 *
 * There is NO generated PDF. The sheet is the live view of the LabResultItem
 * rows the bench saved, so reprinting it in a year prints what was measured
 * against the range it was measured on - both were snapshot onto the row at
 * save time, and nothing here can re-grade them.
 */

type Flag = "NORMAL" | "HIGH" | "LOW" | "ABNORMAL";

interface ResultRow {
  name: string; unit: string | null; value: string;
  refLow: string | null; refHigh: string | null; refText: string | null;
  flag: Flag; sortOrder: number;
}

interface Report {
  hospital: HospitalInfo | null;
  test: {
    id: string; testName: string; code: string | null; status: string;
    orderedAt: string; completedAt: string | null; impression: string | null;
    technicianName: string | null; reportFileUrl: string | null;
  };
  patient: {
    displayId: string; fullName: string; age: number | null; gender: string | null;
    bloodGroup: string | null; phone: string; address: string | null; city: string | null;
  } | null;
  referral: { opNumber: string; doctorName: string; visitDate: string } | null;
  admission: { ipNumber: string } | null;
  results: ResultRow[];
  abnormal: number;
}

/**
 * "Jul 30, 2026, 10:29 a.m." - the stamp format on the hospital's report.
 *
 * Built from two calls rather than one toLocaleString because en-IN renders the
 * meridiem as "am" and orders the date day-first; this stamp has to read exactly
 * like the ones already printed on five years of filed reports.
 */
const stamp = (iso: string | null): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  const time = d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\bAM\b/, "a.m.")
    .replace(/\bPM\b/, "p.m.");
  return `${date}, ${time}`;
};

/**
 * A stored decimal back to how a lab writes it: "150000.0000" -> "150000",
 * "0.5000" -> "0.5". The column is Decimal(12,4) because a range has to hold
 * 1.005 for urine specific gravity; printing those trailing zeros on every
 * platelet count is the cost of that, and it isn't one worth paying.
 */
const num = (s: string) => String(Number(s));

/** "13.0 - 17.0", "< 200", "> 40", or the text range for non-numeric results. */
function rangeLabel(r: ResultRow): string {
  if (r.refLow != null && r.refHigh != null) return `${num(r.refLow)} - ${num(r.refHigh)}`;
  if (r.refHigh != null) return `< ${num(r.refHigh)}`;
  if (r.refLow != null) return `> ${num(r.refLow)}`;
  return r.refText ?? "-";
}

/**
 * Out-of-range ink. The BOLD weight is the real marker (see the file note); the
 * colour is a bonus for whoever reads this on a screen or off a colour laser,
 * and carries no information the weight does not already carry.
 */
const FLAG_INK: Record<Flag, string> = {
  NORMAL: "var(--pr-ink)", HIGH: "#c8211b", LOW: "#1d4ed8", ABNORMAL: "#c8211b",
};

/** "MR." / "MS." from the recorded gender, or nothing when it isn't recorded. */
function title(gender: string | null | undefined): string {
  const g = (gender ?? "").toUpperCase();
  if (g.startsWith("M")) return "MR. ";
  if (g.startsWith("F")) return "MS. ";
  return "";
}

/** "Male", "Female" - the sentence case the hospital's form uses. */
function sentenceCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * "Dr. M Sushma" from either "M Sushma" or "Dr. M Sushma".
 *
 * Doctors are entered under whatever the front desk typed, and roughly half the
 * rows already carry the title. Prefixing unconditionally printed "Dr. Dr. M
 * Sushma" on the referral line of every report from a doctor whose name was
 * saved the common way.
 */
function withTitle(name: string): string {
  return /^\s*(dr|prof)\b\.?/i.test(name) ? name.trim() : `Dr. ${name.trim()}`;
}

/** One "Label : value" line of the identity block, colon-aligned down a column. */
function IdRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <span className="text-[10.5px] leading-[4.1mm]" style={{ color: "var(--pr-ink)" }}>{k}</span>
      <span className="text-[10.5px] leading-[4.1mm]" style={{ color: "var(--pr-ink)" }}>:</span>
      <span
        className={`text-[10.5px] font-semibold leading-[4.1mm] ${mono ? "font-mono tracking-tight" : ""}`}
        style={{ color: "var(--pr-ink)" }}
      >
        {v || "-"}
      </span>
    </>
  );
}

export function LabReportSheet() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the report…</div>}>
      <LabReportSheetInner />
    </Suspense>
  );
}

function LabReportSheetInner() {
  const { labTestId } = useParams<{ labTestId: string }>();
  const params = useSearchParams();

  const paperParam = params.get("paper");
  const [onStationery, setOnStationery] = useState(paperParam !== "plain");
  const [withNotes, setWithNotes] = useState(params.get("notes") !== "off");

  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overflowMm, setOverflowMm] = useState(0);
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api.get<Report>(`/labs/tests/${labTestId}/print`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the report."));
  }, [labTestId]);

  // "Report Printed Date" is the moment this sheet was rendered, so it can only
  // be read on the client - taken during hydration to keep the server and the
  // browser from disagreeing about what time it is.
  useEffect(() => setPrintedAt(new Date().toISOString()), [data]);

  // The sheet is ONE page: print pins it to the paper, so anything past the
  // bottom is simply not printed. A long panel with notes can do that, and a
  // result line lost silently between the screen and the tray is the worst
  // failure this page has - so measure it and say so before anyone prints.
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
  }, [data, onStationery, withNotes]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!data) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the report…</div>;

  const { hospital, test, patient, referral, admission, results, abnormal } = data;
  const entered = results.length > 0;
  const department = departmentFor(test.code);
  const specimen = specimenFor(test.code);

  /** Left column: who the sample came from and what it is. */
  const leftFields: { k: string; v: string; mono?: boolean }[] = [
    { k: "Patient Name", v: patient ? `${title(patient.gender)}${patient.fullName.toUpperCase()}` : "" },
    {
      k: "Age / Gender",
      v: [patient?.age != null ? `${patient.age} years` : null, sentenceCase(patient?.gender)]
        .filter(Boolean).join(" / "),
    },
    { k: "Ref. Doctor", v: referral?.doctorName ? withTitle(referral.doctorName) : "Self / walk-in" },
    { k: "Patient ID", v: patient?.displayId ?? "", mono: true },
    { k: "Sample Type", v: specimen ?? "-" },
    // Not recorded by this system - see the file note. Printed as a blank field
    // so the form still reads as the hospital's, without inventing an
    // accession number that no tube in the fridge carries.
    { k: "Sample Id", v: "-", mono: true },
  ];

  /** Right column: the sample's chain of custody, such as we hold it. */
  const rightFields: { k: string; v: string; mono?: boolean }[] = [
    { k: "Ref. Customer", v: (hospital?.legalName ?? "").toUpperCase() },
    { k: admission ? "IP No" : "OP No", v: admission?.ipNumber ?? referral?.opNumber ?? "-", mono: true },
    { k: "Registered On", v: stamp(test.orderedAt) },
    { k: "Collected On", v: "-" },
    { k: "Received On", v: "-" },
    { k: "Reported On", v: test.completedAt ? stamp(test.completedAt) : "Not yet reported" },
  ];

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: onStationery ? STATIONERY_PRINT_CSS : PRINT_CSS }} />
      <PrintToolbar title={`Lab report · ${test.testName}${patient ? ` · ${patient.fullName}` : ""}`} />

      {/* Screen-only desk controls: which paper, and whether the notes print. */}
      <div className="mx-auto mb-3 flex w-full max-w-[210mm] flex-wrap items-center gap-x-5 gap-y-2 print:hidden">
        <label className="flex items-center gap-2 text-[12.5px] text-[#3a4744]">
          <input type="checkbox" checked={onStationery} onChange={(e) => setOnStationery(e.target.checked)} />
          Printing on the hospital&apos;s pre-printed paper
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-[#3a4744]">
          <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />
          Print the reference notes under each investigation
        </label>
      </div>

      {overflowMm > 0 && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] border-l-2 border-[#d8b878] pl-3 text-[12.5px] leading-snug text-[#8a6414] print:hidden">
          This report runs about {overflowMm}mm past the printable area - that much will be cut off at the bottom
          of the sheet. Turn off the reference notes above, or hand the remaining lines on a second sheet.
        </p>
      )}

      {!entered && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] border-l-2 border-[#d8b878] pl-3 text-[12.5px] leading-snug text-[#8a6414] print:hidden">
          No values have been entered for this test yet. Enter them from the lab queue - printing now gives a
          header with an empty table.
        </p>
      )}

      <div id="print-sheet" ref={sheetRef}>
        {onStationery ? <PreprintedGuide /> : <LetterHead hospital={hospital} doctor={null} />}

        {/* ── IDENTITY: two colon-aligned columns, exactly as on the paper form ── */}
        <div className={`grid grid-cols-2 gap-x-10 ${onStationery ? "mt-2" : "mt-4"}`}>
          <div className="grid grid-cols-[76px_7px_1fr] items-baseline">
            {leftFields.map((f) => <IdRow key={f.k} {...f} />)}
          </div>
          <div className="grid grid-cols-[82px_7px_1fr] items-baseline">
            {rightFields.map((f) => <IdRow key={f.k} {...f} />)}
          </div>
        </div>

        {/* ── THE TABLE ──
            Rules above and below the header, no vertical rules and no row
            rules: four columns of different kinds of thing held apart by
            alignment alone, which is what the hospital's own report does and
            what keeps a fourteen-analyte panel readable at speed. */}
        <table className="mt-[10px] w-full border-collapse">
          <thead>
            <tr
              className="text-left align-bottom text-[10px] bg-[var(--pr-bg)] font-bold uppercase tracking-[0.02em]"
              style={{ color: "var(--pr-ink)" }}
            >
              <th className="border-y w-[230px] py-[3px] pr-2" style={{ borderColor: "var(--pr-ink)" }}>Test Description</th>
              <th className="w-[70px] border-y py-[3px] pl-2" style={{ borderColor: "var(--pr-ink)" }}>Result</th>
              <th className="w-[76px] border-y py-[3px] pr-2" style={{ borderColor: "var(--pr-ink)" }}>Units</th>
              <th className="w-[140px] border-y py-[3px]" style={{ borderColor: "var(--pr-ink)" }}>
                Biological Reference Interval
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Department band - centred across the measure, the way a report is
                actually navigated when it runs to several pages. The
                out-of-range count rides at the right of the same line: it is
                the first thing a doctor looks for, and it costs no extra rule. */}
            <tr>
              <td colSpan={4} className="pb-[2px] pt-[7px]">
                <div className="relative text-center">
                  <span className="text-[11px] font-bold uppercase tracking-[0.04em]" style={{ color: "var(--pr-ink)" }}>
                    {department ?? "LABORATORY"}
                  </span>
                  <span
                    className={`absolute right-0 top-[1px] uppercase ${abnormal > 0 ? "text-[9px] font-bold tracking-[0.18em]" : "text-[8.5px] font-semibold tracking-[0.14em]"}`}
                    style={{ color: abnormal > 0 ? "#c8211b" : "var(--pr-muted)" }}
                  >
                    {abnormal > 0 ? `${abnormal} out of range` : entered ? "All within range" : "Awaiting results"}
                  </span>
                </div>
              </td>
            </tr>

            {/* The panel, named and underlined - the sub-head inside a department. */}
            <tr>
              <td colSpan={4} className="pb-[3px] pt-[5px]">
                <span
                  className="text-[11px] font-bold underline decoration-1 underline-offset-[3px]"
                  style={{ color: "var(--pr-ink)" }}
                >
                  {test.testName}
                </span>
              </td>
            </tr>

            {results.map((r, i) => {
              const off = r.flag !== "NORMAL";
              const method = methodFor(r.name);
              // The second sentence is earned, not automatic: only a line that
              // is actually out of range gets told what that direction means.
              const flagNote = off ? analyteFlagNote(r.name, r.flag) : null;
              const desc = withNotes ? analyteDescription(r.name) : null;
              return (
                <tr key={`${r.name}-${i}`} className="align-baseline">
                  <td className="pb-[2px] pr-2 pt-[4px]">
                    <span className="text-[11px] font-semibold " style={{ color: "var(--pr-ink)" }}>{r.name}</span>
                    {method && (
                      <span className="block pl-[10px] text-[8.5px] italic leading-[1.3]" style={{ color: "var(--pr-muted)" }}>
                        Method : {method}
                      </span>
                    )}
                    {withNotes && (desc || flagNote) && (
                      /* 9px is about as small as this can be set and still be
                         read off a laser print by someone holding it at a
                         counter - the whole point of the line. */
                      <span className="block pl-[10px] text-[9px] italic leading-[1.35]" style={{ color: "var(--pr-muted)" }}>
                        {desc}
                        {flagNote && (
                          <span className="font-semibold not-italic" style={{ color: FLAG_INK[r.flag] }}>
                            {desc ? "  " : ""}{flagNote}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  {/* BOLD is the out-of-range marker - it is what the hospital's
                      report has always used, and unlike a colour it survives the
                      mono laser most of this printing goes through. */}
                  <td
                    className="pb-[2px] pr-2 pt-[4px] text-[11px]"
                    style={{ color: FLAG_INK[r.flag], fontWeight: off ? 700 : 400 }}
                  >
                    {r.value}
                  </td>
                  <td className="pb-[2px] pr-2 pt-[4px] text-[11px]" style={{ color: "var(--pr-ink)" }}>
                    {r.unit ?? ""}
                  </td>
                  <td className="pb-[2px] pt-[4px] text-[11px]" style={{ color: "var(--pr-ink)" }}>
                    {rangeLabel(r)}
                  </td>
                </tr>
              );
            })}

            {!entered && (
              <tr style={{ height: "24mm" }}>
                <td colSpan={4} className="pt-3 text-[11px] italic" style={{ color: "var(--pr-muted)" }}>
                  Results not entered.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* ── COMMENTS ──
            The bench's read of its OWN numbers, in the technician's words, under
            the heading the hospital's report uses. Set apart from the table and
            never merged into it: a lab reports on a specimen, a doctor diagnoses
            the person. */}
        {test.impression?.trim() && (
          <div className="mt-[10px]">
            <div className="text-[10.5px] font-bold" style={{ color: "var(--pr-ink)" }}>Comments</div>
            <p className="mt-[2px] whitespace-pre-line text-[10.5px] leading-[1.45]" style={{ color: "var(--pr-ink)" }}>
              {test.impression}
            </p>
            <p className="mt-[3px] text-[8.5px] italic" style={{ color: "var(--pr-muted)" }}>
              Impression on the specimen examined - not a clinical diagnosis. Please correlate clinically.
            </p>
          </div>
        )}

        {/* grow: whatever height the sheet doesn't use lands here rather than as
            one dead gap above the signature, so a two-analyte report doesn't
            print its footer halfway up the page. */}
        <div className="flex-1" />

        <ReportFoot
          withNotes={withNotes && entered}
          technicianName={test.technicianName}
          printedAt={printedAt}
          inset={onStationery}
        />
      </div>
    </div>
  );
}

/**
 * The report's foot - what makes it a document rather than a printout: who ran
 * it, who signs it, when it was printed, and the correlation note.
 *
 * The pathologist's name and registration number are NOT hardcoded. This
 * software has no business printing a doctor's credentials under a result they
 * have not seen, so what prints is a signature rule they sign by hand. When the
 * hospital wants the name set in type, it belongs in HospitalConfig beside the
 * logo, edited from Admin.
 *
 * `inset` lifts the block into the bottom band of the pre-printed paper, in the
 * strip beside the printed QR (left 13mm, clear of the QR at 27mm, above the
 * printed address band at 22mm), so this sheet's foot lands on the same line as
 * the OPD sheet's.
 */
function ReportFoot({ withNotes, technicianName, printedAt, inset }: {
  withNotes: boolean; technicianName: string | null; printedAt: string | null; inset: boolean;
}) {
  const body = (
    <>
      <div className="flex items-end justify-between gap-6">
        <div className="text-[8.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--pr-muted)" }}>
          — End of report —
        </div>
        <div className="flex items-end gap-8">
          {technicianName && (
            <div className="text-right leading-tight">
              <div className="text-[10px] font-semibold" style={{ color: "var(--pr-ink)" }}>{technicianName}</div>
              <div className="text-[8px] uppercase tracking-[0.12em]" style={{ color: "var(--pr-muted)" }}>
                Analysed by
              </div>
            </div>
          )}
          <div className="w-[48mm] text-center">
            <div className="h-[8mm] border-b" style={{ borderColor: "var(--pr-line)" }} />
            <div className="mt-[2px] text-[8.5px] font-semibold" style={{ color: "var(--pr-ink)" }}>
              Consultant Pathologist
            </div>
          </div>
        </div>
      </div>

      {withNotes && (
        <p className="mt-[6px] text-[8px] italic leading-[1.4]" style={{ color: "var(--pr-muted)" }}>
          The italic lines under each investigation are general reference notes about the test itself, not an
          interpretation of this result. Reference intervals vary with age, sex, pregnancy and method, and were
          recorded with the result at the time of reporting. Please discuss this report with your doctor.
        </p>
      )}

      <p className="mt-[4px] text-[8px] italic leading-[1.4]" style={{ color: "var(--pr-muted)" }}>
        This is an electronically authenticated report.
        {printedAt ? ` Report Printed Date: ${stamp(printedAt)}` : ""}
      </p>
      <p className="text-[8px] leading-[1.4]" style={{ color: "var(--pr-muted)" }}>
        NOTE: Assay results should be correlated clinically with other clinical findings and the total clinical
        status of the patient.
      </p>
    </>
  );
  if (!inset) return <div className="mt-[10px]">{body}</div>;
  return <div className="absolute" style={{ left: "13mm", right: "27mm", bottom: "20mm" }}>{body}</div>;
}
