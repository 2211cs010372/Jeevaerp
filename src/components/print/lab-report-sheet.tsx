"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { specimenFor, bandFor, methodFor } from "@/lib/lab-reference";
import { rowsThatFit, repack, pageSlices } from "@/lib/lab-pagination";
import {
  multiSheetPrintCss, PrintToolbar, LetterHead, PreprintedGuide,
  type HospitalInfo,
} from "@/components/print/stationery";

/**
 * The ONE laboratory report, drawn to the hospital's own Jeeva Diagnostics
 * stationery - the layout every doctor around Hanamkonda already reads:
 *
 *   /print/lab/{labTestId}                   the finished report
 *   /print/lab/{labTestId}?paper=plain       drawn letterhead, for blank stock
 *
 * THE FORMAT. Two identity columns over a table headed TEST NAME / RESULT /
 * UNITS / BIOLOGICAL REFERENCE INTERVAL, a centred department band, the panel
 * name underlined beneath it, a colon between the analyte and its result, and a
 * "Method:" line under each investigation. Out-of-range values are set BOLD,
 * which is the marking on the hospital's existing report and the one thing on
 * this sheet that has to survive a mono laser.
 *
 * ONLY THE METHOD. The line under an analyte carries the method name and
 * nothing else - "Method: Coulter Principle" - because that is what the
 * reference report the hospital works from carries. The general reference prose
 * that used to print there made every row three lines deep and pushed long
 * panels off the page to say things no bench result depends on.
 *
 * IT PAGINATES. A panel that does not fit is not shrunk and is not cut off: it
 * runs on to a second sheet, which repeats the identity block, the department
 * band and the panel name and continues the analyte list - the way a HAEMOGRAM
 * runs across two pages on the reference report. Only the last sheet of a test
 * carries the comments, the signature block and "End of report"; every sheet is
 * numbered "Page n of m" so a patient handed three sheets knows they have three.
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

/** One test's report bundle. Exported: the whole-order print renders N of these. */
export interface Report {
  hospital: HospitalInfo | null;
  test: {
    id: string; testName: string; code: string | null; status: string;
    /**
     * The section band the catalogue says to print. Null means it says nothing
     * and the transcribed map decides; "" means the lab set "no band". See
     * bandFor - the two are not interchangeable.
     */
    group: string | null;
    orderedAt: string; completedAt: string | null; impression: string | null;
    technicianName: string | null; reportFileUrl: string | null;
  };
  patient: {
    displayId: string; fullName: string; age: number | null; gender: string | null;
    bloodGroup: string | null; phone: string; address: string | null; city: string | null;
  } | null;
  referral: { opNumber: string; doctorName: string; visitDate: string } | null;
  /**
   * The name for the "Ref. Doctor" line. The visit's doctor where there was a
   * visit; otherwise whoever the desk named on the order, which is how a sample
   * given at the window against an outside chit still reports back to the
   * doctor who asked for it. Null is a genuinely self-referred sample.
   */
  refDoctorName: string | null;
  refDoctorRegNo: string | null;
  admission: { ipNumber: string } | null;
  results: ResultRow[];
  abnormal: number;
}

/** What the pagination settled on, reported back to the page for its notices. */
export interface ReportLayout {
  /** Sheets this one test will use. */
  pages: number;
  /**
   * Millimetres the last sheet STILL runs past the paper - only ever non-zero
   * when a single analyte row is taller than a whole page, which pagination
   * cannot fix by moving it. 0 is the normal answer.
   */
  overflowMm: number;
}

/**
 * "Jul 30, 2026, 10:29 a.m." - the stamp format on the hospital's report.
 *
 * Built from two calls rather than one toLocaleString because en-IN renders the
 * meridiem as "am" and orders the date day-first; this stamp has to read exactly
 * like the ones already printed on five years of filed reports.
 */
export const stamp = (iso: string | null): string => {
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

/**
 * The air between one analyte line and the next.
 *
 * It lives on the CELLS, on all of them, because that is the only place a table
 * will take it: a `<tr>` in a border-collapse table is display:table-row, which
 * has no margin and no gap - `gap-y` on the row is dropped silently, and padding
 * on one cell alone leaves the other columns riding at the old pitch with the
 * names drifting out of line.
 */
const ROW_PAD = { paddingTop: "5px", paddingBottom: "3px" } as const;

/**
 * Millimetres to a CSS pixel, asked of the browser rather than assumed.
 *
 * Only called when a sheet actually overflows past what pagination can fix,
 * which is close to never - the probe is a layout read, and doing one on every
 * render of every report to answer a question that is almost always "it fits"
 * would be a poor trade.
 */
function mmPerPx(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "width:100mm;position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const mm = 100 / probe.offsetWidth;
  probe.remove();
  return mm;
}

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
      <span className="text-[12px] leading-[4.1mm]" style={{ color: "var(--pr-ink)" }}>{k}</span>
      <span className="text-[12px] leading-[4.1mm]" style={{ color: "var(--pr-ink)" }}>:</span>
      <span
        className={`text-[12px] font-semibold leading-[4.1mm] ${mono ? "font-mono tracking-tight" : ""}`}
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

  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<ReportLayout>({ pages: 1, overflowMm: 0 });
  const [printedAt, setPrintedAt] = useState<string | null>(null);

  useEffect(() => {
    api.get<Report>(`/labs/tests/${labTestId}/print`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the report."));
  }, [labTestId]);

  // "Report Printed Date" is the moment this sheet was rendered, so it can only
  // be read on the client - taken during hydration to keep the server and the
  // browser from disagreeing about what time it is.
  useEffect(() => setPrintedAt(new Date().toISOString()), [data]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!data) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the report…</div>;

  const { test, patient, results } = data;
  const entered = results.length > 0;

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: multiSheetPrintCss(onStationery) }} />
      <PrintToolbar title={`Lab report · ${test.testName}${patient ? ` · ${patient.fullName}` : ""}`} />

      {/* Screen-only desk control: which paper is in the tray. */}
      <div className="mx-auto mb-3 flex w-full max-w-[210mm] flex-wrap items-center gap-x-5 gap-y-2 print:hidden">
        <label className="flex items-center gap-2 text-[12.5px] text-[#3a4744]">
          <input type="checkbox" checked={onStationery} onChange={(e) => setOnStationery(e.target.checked)} />
          Printing on the hospital&apos;s pre-printed paper
        </label>
      </div>

      {/* How much paper this is about to use, before it is used. */}
      {layout.pages > 1 && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] text-[12.5px] leading-snug text-[#5a6a66] print:hidden">
          This panel runs to <span className="font-semibold">{layout.pages} sheets</span> - the analytes that
          don&apos;t fit continue on the next page, under the same heading.
        </p>
      )}

      {/* Pagination cannot move a row that is taller than a whole page. Nothing
          in the catalogue is, but a result typed as a paragraph could be, and a
          line lost silently between the screen and the tray is the worst failure
          this page has. */}
      {layout.overflowMm > 0 && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] border-l-2 border-[#d8b878] pl-3 text-[12.5px] leading-snug text-[#8a6414] print:hidden">
          One result on the last sheet is too long to fit a page on its own - about {layout.overflowMm}mm of it
          would be cut off at the bottom. Shorten that value from the lab queue.
        </p>
      )}

      {!entered && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] border-l-2 border-[#d8b878] pl-3 text-[12.5px] leading-snug text-[#8a6414] print:hidden">
          No values have been entered for this test yet. Enter them from the lab queue - printing now gives a
          header with an empty table.
        </p>
      )}

      <LabReportPages
        data={data} onStationery={onStationery} printedAt={printedAt} onLayout={setLayout}
      />
    </div>
  );
}

/**
 * ONE test's report - as many sheets as its analytes need.
 *
 * Split out of the page above so the whole-order print can lay several tests end
 * to end without the two ever drifting apart. There is exactly one lab report
 * layout in this hospital, and a patient handed three sheets from one sample
 * must not be able to tell which screen printed which.
 *
 * It owns its own page boxes (`.print-sheet`, the class - an id can only name
 * one element and this component renders n). The caller supplies the print CSS
 * profile and nothing else; `multiSheetPrintCss` puts a hard break before every
 * sheet after the first, so the breaks WITHIN a test and the breaks BETWEEN
 * tests are the same rule.
 */
export function LabReportPages({ data, onStationery, printedAt, onLayout }: {
  data: Report;
  /** Printing onto the hospital's pre-printed paper, so the head is left blank. */
  onStationery: boolean;
  /** ISO stamp of when this was rendered; null until hydration. */
  printedAt: string | null;
  /**
   * What the pagination settled on. Reported from here rather than measured by
   * the page, because only this component knows when the packing has finished -
   * a count read mid-pack names a page total that is about to change.
   */
  onLayout?: (layout: ReportLayout) => void;
}) {
  const { hospital, test, patient, referral, refDoctorName, refDoctorRegNo, admission, results, abnormal } = data;
  const entered = results.length > 0;
  const department = bandFor(test.group, test.code);
  const specimen = specimenFor(test.code);

  // ── PACKING THE ANALYTES ONTO SHEETS ──
  //
  // `pageStarts[k]` is the index of the first analyte on sheet k, so [0] is
  // everything on one sheet and [0, 14] is rows 0-13 then 14 onwards.
  //
  // The packing is measured, not estimated, and it is measured on the REAL
  // rendered sheets rather than on a hidden probe: row heights depend on how the
  // name wraps in its column, which depends on the paper, and a probe that gets
  // that wrong pages the report at the wrong analyte. The arithmetic it feeds
  // lives in @/lib/lab-pagination, where it is tested without a DOM.
  //
  // The sheets are collected by ref rather than found under a wrapper element,
  // because they must not HAVE a wrapper: `multiSheetPrintCss` breaks pages with
  // `.print-sheet + .print-sheet`, an adjacent-sibling rule, and a div around
  // each test's sheets would leave the first sheet of test two with no sibling
  // before it - printing it on the same page as the last sheet of test one.
  const sheetsRef = useRef<(HTMLElement | null)[]>([]);
  const [pageStarts, setPageStarts] = useState<number[]>([0]);
  /** The last layout handed to `onLayout` - see the report guard in the effect. */
  const reportedRef = useRef<ReportLayout | null>(null);

  // A different report, or different paper, is a different packing - start from
  // one sheet and let the loop below find the breaks again rather than
  // inheriting the last report's.
  //
  // Reset DURING RENDER, not from an effect. An effect would have run after the
  // packing loop had already asked for its first break, and the two updates
  // cancelled. Keyed on what actually changes the height, NOT on the `data`
  // object: a caller that rebuilds its report object each render would otherwise
  // reset the packing every render, and the two would spend the afternoon
  // undoing each other.
  const layoutKey = `${test.id}|${results.length}|${onStationery}`;
  const [measured, setMeasured] = useState(layoutKey);
  if (measured !== layoutKey) { setMeasured(layoutKey); setPageStarts([0]); reportedRef.current = null; }

  // Run after EVERY render and on layout rather than on paint, so the sheets
  // settle before anything is shown. A sheet's min-height IS the paper, so
  // whatever it stands taller than that is exactly what would be lost off the
  // bottom - and the fix is to move that many rows onto the next sheet.
  //
  // Each pass moves rows strictly downward, so it converges in one pass per new
  // sheet and cannot sit oscillating between two packings.
  useLayoutEffect(() => {
    const sheets = sheetsRef.current.slice(0, pageStarts.length).filter(Boolean) as HTMLElement[];
    if (sheets.length !== pageStarts.length) return;

    let stranded = 0;
    for (let k = 0; k < sheets.length; k++) {
      const sheet = sheets[k];
      const paper = parseFloat(getComputedStyle(sheet).minHeight);
      if (!Number.isFinite(paper) || paper <= 0) continue;
      // 1px of slack: browsers round page geometry in device pixels, and chasing
      // that last rounding error would re-page every report in the building.
      const over = sheet.offsetHeight - paper;
      if (over <= 1) continue;

      const rows = Array.from(sheet.querySelectorAll<HTMLElement>("[data-analyte]"));
      // One row that overflows a page on its own cannot be helped by moving it -
      // it would overflow the next sheet identically. Leave it and say so.
      if (rows.length <= 1) { stranded = Math.max(stranded, over); continue; }

      const keep = rowsThatFit(rows.map((el) => el.offsetHeight), over);
      const next = repack(pageStarts, k, keep, results.length);
      // Identity means the packing has nothing left to give here - fall through
      // and report, rather than scheduling a render that changes nothing.
      if (next !== pageStarts) { setPageStarts(next); return; }
      stranded = Math.max(stranded, over);
    }

    // Settled. Only now is there an honest page count to report; a count read
    // mid-pack names a total that is about to change.
    //
    // Reported ONCE per distinct answer. This effect runs after every render by
    // design - that is what lets it re-measure - so handing the caller a fresh
    // object each time would spin any caller that holds it in state: new object,
    // re-render, new object. The guard belongs here rather than in each caller,
    // because a caller that forgets it doesn't get a stale count, it hangs.
    const pages = sheets.length;
    const overflowMm = stranded > 1 ? Math.round(stranded * mmPerPx()) : 0;
    const last = reportedRef.current;
    if (last && last.pages === pages && last.overflowMm === overflowMm) return;
    reportedRef.current = { pages, overflowMm };
    onLayout?.({ pages, overflowMm });
  });

  /** Left column: who the sample came from and what it is. */
  const leftFields: { k: string; v: string; mono?: boolean }[] = [
    { k: "Patient Name", v: patient ? `${title(patient.gender)}${patient.fullName.toUpperCase()}` : "" },
    {
      k: "Age / Gender",
      v: [patient?.age != null ? `${patient.age} years` : null, sentenceCase(patient?.gender)]
        .filter(Boolean).join(" / "),
    },
    { k: "Ref. Doctor", v: refDoctorName ? withTitle(refDoctorName) : "Self / walk-in" },
    // Only when there is a doctor AND a number for them. The referrer is often
    // the hospital itself, and "Reg. No. -" against that reads as a missing
    // record rather than as a line that does not apply.
    ...(refDoctorRegNo?.trim()
      ? [{ k: "Reg. No.", v: refDoctorRegNo.trim(), mono: true }]
      : []),
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

  const slices = pageSlices(pageStarts, results.length);
  const total = slices.length;
  // Drop refs to sheets that no longer exist, so a report that shrinks from
  // three sheets to two doesn't keep measuring a detached third.
  sheetsRef.current.length = total;

  return (
    <>
      {slices.map(({ start, end }, k) => {
        const slice = results.slice(start, end);
        const isLast = k === total - 1;

        return (
          <div
            key={`${test.id}-${k}`}
            ref={(el) => { sheetsRef.current[k] = el; }}
            className="print-sheet"
          >
            {onStationery ? <PreprintedGuide /> : <LetterHead hospital={hospital} doctor={null} />}

            {/* ── IDENTITY: two colon-aligned columns, exactly as on the paper
                form. Repeated on every sheet of the test - a continuation page
                that reaches a ward without a name on it is a loose sheet. ── */}
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
                rules: columns of different kinds of thing held apart by
                alignment alone, which is what the hospital's own report does and
                what keeps a fourteen-analyte panel readable at speed.

                The colon has a column of its own, unheaded, between the analyte
                and its result - the way the reference report sets it. In the
                name's own cell it would have ridden at the end of the name and
                stepped left and right down the page with the wrapping. */}
            <table className="mt-[10px] w-full border-collapse">
              <thead>
                <tr
                  className="text-left align-bottom bg-[var(--pr-bg)] text-[11px] font-bold uppercase tracking-[0.02em]"
                  style={{ color: "var(--pr-ink)" }}
                >
                  <th className="w-[230px] border-y py-[3px] pr-1" style={{ borderColor: "var(--pr-ink)" }}>Test Name</th>
                  <th className="w-[8px] border-y py-[3px]" style={{ borderColor: "var(--pr-ink)" }} />
                  <th className="w-[70px] border-y py-[3px] pl-2" style={{ borderColor: "var(--pr-ink)" }}>Result</th>
                  <th className="w-[76px] border-y py-[3px] pr-2" style={{ borderColor: "var(--pr-ink)" }}>Units</th>
                  <th className="w-[140px] border-y py-[3px]" style={{ borderColor: "var(--pr-ink)" }}>
                    Biological Reference Interval
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Department band - centred across the measure, the way a report
                    is actually navigated when it runs to several pages. The
                    out-of-range count rides at the right of the same line: it is
                    the first thing a doctor looks for, and it costs no extra
                    rule. It counts the whole TEST, not this sheet, which is why
                    it reads the same on both pages of a split panel. */}
                <tr>
                  <td colSpan={5} className="pb-[2px] pt-[7px]">
                    <div className="relative text-center">
                      {/* "" is a test the catalogue files under no band; null
                          is a code this build has never heard of, which still
                          gets a heading. The blank keeps a non-breaking space
                          rather than emptying the span: the out-of-range chip
                          beside it is absolutely positioned, so a collapsed
                          line box would drop it onto the test name below. */}
                      <span className="text-[16px] font-bold uppercase tracking-[0.04em]" style={{ color: "var(--pr-ink)" }}>
                        {department === "" ? "\u00A0" : (department ?? "LABORATORY")}
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

                {/* The panel, named and underlined - the sub-head inside a
                    department, repeated on a continuation sheet so the second
                    half of a HAEMOGRAM still says what it is. */}
                <tr>
                  <td colSpan={5} className="pb-[3px] pt-[5px]">
                    <span
                      className="text-[15px] font-bold underline decoration-1 underline-offset-[3px]"
                      style={{ color: "var(--pr-ink)" }}
                    >
                      {test.testName}
                    </span>
                    {k > 0 && (
                      <span className="ml-2 text-[9px] italic" style={{ color: "var(--pr-muted)" }}>
                        continued
                      </span>
                    )}
                  </td>
                </tr>

                {slice.map((r, i) => {
                  const off = r.flag !== "NORMAL";
                  // The code goes in: "Albumin" on a urine report is a dipstick
                  // square and on a serum one a BCG assay, and the name alone
                  // cannot tell them apart.
                  const method = methodFor(r.name, test.code);
                  return (
                    <tr key={`${r.name}-${start + i}`} data-analyte className="align-baseline  ">
                      <td className="pr-1" style={ROW_PAD}>
                        <span className="text-[14px] font-semibold" style={{ color: "var(--pr-ink)" }}>{r.name}</span>
                        {/* The method, and nothing else - see the file note. */}
                        {method && (
                          <span className="block pl-[10px] text-[11px] italic leading-[0.98]" style={{ color: "var(--pr-muted)" }}>
                            Method: {method}
                          </span>
                        )}
                      </td>
                      <td className="text-[14px]" style={{ ...ROW_PAD, color: "var(--pr-ink)" }}>:</td>
                      {/* BOLD is the out-of-range marker - it is what the
                          hospital's report has always used, and unlike a colour
                          it survives the mono laser most of this printing goes
                          through. */}
                      <td
                        className="pl-2 pr-2 font-semibold text-[14px]"
                        style={{ ...ROW_PAD, color: FLAG_INK[r.flag], fontWeight: off ? 700 : 700 }}
                      >
                        {r.value}
                      </td>
                      <td className="pr-2 font-semibold text-[14px]" style={{ ...ROW_PAD, color: "var(--pr-ink)" }}>
                        {r.unit ?? ""}
                      </td>
                      <td className="text-[14px] font-semibold" style={{ ...ROW_PAD, color: "var(--pr-ink)" }}>
                        {rangeLabel(r)}
                      </td>
                    </tr>
                  );
                })}

                {!entered && (
                  <tr style={{ height: "24mm" }}>
                    <td colSpan={5} className="pt-3 text-[12px] italic" style={{ color: "var(--pr-muted)" }}>
                      Results not entered.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* grow: whatever height the sheet doesn't use lands BETWEEN the
                table and the foot, so the gap on a two-analyte report opens in
                the middle of the page instead of under the signature. */}
            <div className="flex-1" />

            {/* ── COMMENTS ──
                The bench's read of its OWN numbers, in the technician's words,
                under the heading the hospital's report uses. Set apart from the
                table and never merged into it: a lab reports on a specimen, a
                doctor diagnoses the person.

                Last sheet only, with the signature: a comment is on the test,
                not on the page, and printed twice it reads as two findings. */}
            {isLast && test.impression?.trim() && (
              <div className="mb-[4px] border-t pt-[6px]" style={{ borderColor: "var(--pr-hair)" }}>
                <div className="text-[10.5px] font-bold" style={{ color: "var(--pr-ink)" }}>Comments</div>
                <p className="mt-[2px] whitespace-pre-line text-[10.5px] leading-[1.45]" style={{ color: "var(--pr-ink)" }}>
                  {test.impression}
                </p>
                <p className="mt-[3px] text-[8.5px] italic" style={{ color: "var(--pr-muted)" }}>
                  Impression on the specimen examined - not a clinical diagnosis. Please correlate clinically.
                </p>
              </div>
            )}

            {isLast ? (
              <ReportFoot
                technicianName={test.technicianName}
                printedAt={printedAt}
                page={k + 1}
                total={total}
                inset={onStationery}
              />
            ) : (
              <ContinuationFoot page={k + 1} total={total} inset={onStationery} />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * The foot of a sheet that is NOT the last one of its test.
 *
 * It carries no signature and no "End of report", because neither is true yet -
 * a continuation sheet is the middle of a document. What it must carry is where
 * the reader is: a page marker, and the fact that the panel goes on. A patient
 * who is handed only sheet two of two should be able to tell.
 */
function ContinuationFoot({ page, total, inset }: { page: number; total: number; inset: boolean }) {
  const body = (
    <div className="flex items-end justify-between gap-6 text-[8.5px]" style={{ color: "var(--pr-muted)" }}>
      <span className="italic">Continued on the next sheet</span>
      <span className="font-semibold uppercase tracking-[0.14em]">Page {page} of {total}</span>
    </div>
  );
  if (!inset) return <div className="mt-[10px]">{body}</div>;
  return <div className="absolute" style={{ left: "13mm", right: "27mm", bottom: "20mm" }}>{body}</div>;
}

/**
 * The report's foot - what makes it a document rather than a printout: who ran
 * it, who signs it, when it was printed, and the correlation note. Printed on
 * the LAST sheet of a test only.
 *
 * The pathologist's name and registration number are NOT hardcoded. This
 * software has no business printing a doctor's credentials under a result they
 * have not seen, so what prints is a signature rule they sign by hand. When the
 * hospital wants the name set in type, it belongs in HospitalConfig beside the
 * logo, edited from Admin.
 *
 * `inset` lifts the block into the bottom band of the pre-printed paper, in the
 * strip beside the printed QR (left 13mm, clear of the QR at 27mm, above the
 * printed address band at 20mm), so this sheet's foot lands on the same line as
 * the OPD sheet's.
 */
function ReportFoot({ technicianName, printedAt, page, total, inset }: {
  technicianName: string | null; printedAt: string | null;
  page: number; total: number; inset: boolean;
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

      <p className="mt-[4px] text-[8px] italic leading-[1.4]" style={{ color: "var(--pr-muted)" }}>
        This is an electronically authenticated report.
        {printedAt ? ` Report Printed Date: ${stamp(printedAt)}` : ""}
      </p>
      <div className="flex items-end justify-between gap-6">
        <p className="text-[8px] leading-[1.4]" style={{ color: "var(--pr-muted)" }}>
          NOTE: Assay results should be correlated clinically with other clinical findings and the total clinical
          status of the patient.
        </p>
        {/* A single-sheet report says "Page 1 of 1" too: the marker is what tells
            a reader nothing is missing, and it can only do that if it is always
            there. */}
        <span className="shrink-0 text-[8.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--pr-muted)" }}>
          Page {page} of {total}
        </span>
      </div>
    </>
  );
  if (!inset) return <div className="mt-[10px]">{body}</div>;
  return <div className="absolute" style={{ left: "13mm", right: "27mm", bottom: "20mm" }}>{body}</div>;
}
