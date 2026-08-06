"use client";

/**
 * ONE ORDER, ONE PRINT JOB.
 *
 * A patient who gave one tube for four tests gets four reports - each with its
 * own department band, its own reference ranges and its own signature rule,
 * because each is a separate examination of the specimen and is signed as one.
 * What they should NOT get is four trips to the print dialog. The fourth is the
 * one that doesn't happen, and the patient leaves with three of their four
 * results.
 *
 * So this page stacks the order's reports into a single document with a hard
 * page break between sheets. Every sheet is drawn by the same `LabReportPages`
 * the single-report page uses, so a patient handed three sheets from one sample
 * cannot tell which screen printed which - and a long panel splits across two
 * sheets here exactly as it would on its own.
 *
 * A test is therefore not always one page: the count below is sheets, not tests.
 *
 *   /print/lab-order/{orderId}                 every report on the order
 *   /print/lab-order/{orderId}?paper=plain     drawn letterhead, for blank stock
 *
 * A test with no values entered is NOT printed - it would spend a sheet of the
 * hospital's pre-printed paper on a header and an empty table - but it is named
 * on screen, so the technician can see what is still owed before they print.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { LabReportPages, type Report, type ReportLayout } from "@/components/print/lab-report-sheet";
import { PrintToolbar, multiSheetPrintCss } from "@/components/print/stationery";

interface OrderReports {
  orderId: string;
  reports: Report[];
}

export function LabOrderReportSheets() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the reports…</div>}>
      <LabOrderReportSheetsInner />
    </Suspense>
  );
}

function LabOrderReportSheetsInner() {
  const { orderId } = useParams<{ orderId: string }>();
  const params = useSearchParams();

  const [onStationery, setOnStationery] = useState(params.get("paper") !== "plain");

  const [data, setData] = useState<OrderReports | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  /**
   * What each test's pagination settled on, by test id. Reported by the reports
   * themselves - see LabReportPages' onLayout - because only they know when
   * their packing has finished, and a count read mid-pack names a page total
   * that is about to change.
   */
  const [layouts, setLayouts] = useState<Record<string, ReportLayout>>({});

  useEffect(() => {
    api.get<OrderReports>(`/labs/orders/${orderId}/print`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the reports."));
  }, [orderId]);

  // "Report Printed Date" is the moment these sheets were rendered, so it can
  // only be read on the client - taken during hydration to keep the server and
  // the browser from disagreeing about what time it is.
  useEffect(() => setPrintedAt(new Date().toISOString()), [data]);

  /** What actually reaches paper: a test with no values is a wasted sheet. */
  const printable = useMemo(() => (data?.reports ?? []).filter((r) => r.results.length > 0), [data]);
  const awaiting = useMemo(
    () => (data?.reports ?? []).filter((r) => r.results.length === 0).map((r) => r.test.testName),
    [data],
  );

  // Sheets, not tests: a long panel takes two. Un-measured reports count as one
  // so the number never reads lower than the paper it is about to use.
  const sheets = printable.reduce((n, r) => n + (layouts[r.test.id]?.pages ?? 1), 0);

  // Pagination moves a row that doesn't fit onto the next sheet, so overflow is
  // now only possible for a single row taller than a whole page. Named
  // individually: in a four-page document "a report is too long" is not an
  // answer anybody can act on.
  const overflowing = printable
    .filter((r) => (layouts[r.test.id]?.overflowMm ?? 0) > 0)
    .map((r) => r.test.testName);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!data) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the reports…</div>;

  const patientName = data.reports[0]?.patient?.fullName ?? "";
  const tests = printable.length;

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: multiSheetPrintCss(onStationery) }} />
      <PrintToolbar
        title={`Lab reports · ${tests} test${tests === 1 ? "" : "s"}${patientName ? ` · ${patientName}` : ""}`}
      />

      {/* Screen-only desk control: which paper is in the tray. */}
      <div className="mx-auto mb-3 flex w-full max-w-[210mm] flex-wrap items-center gap-x-5 gap-y-2 print:hidden">
        <label className="flex items-center gap-2 text-[12.5px] text-[#3a4744]">
          <input type="checkbox" checked={onStationery} onChange={(e) => setOnStationery(e.target.checked)} />
          Printing on the hospital&apos;s pre-printed paper
        </label>
      </div>

      {/* How much paper this is about to use, before it is used. */}
      {tests > 0 && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] text-[12.5px] leading-snug text-[#5a6a66] print:hidden">
          One job, <span className="font-semibold">{sheets} sheet{sheets === 1 ? "" : "s"}</span> for{" "}
          {tests} test{tests === 1 ? "" : "s"}, in the order they were raised
          {sheets > tests ? " - a panel too long for one page continues on the next" : ""}.
        </p>
      )}

      {awaiting.length > 0 && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] border-l-2 border-[#d8b878] pl-3 text-[12.5px] leading-snug text-[#8a6414] print:hidden">
          Not printed - no values entered yet: <span className="font-semibold">{awaiting.join(", ")}</span>. Enter
          them from the lab queue, then print again to hand over the whole order at once.
        </p>
      )}

      {overflowing.length > 0 && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] border-l-2 border-[#d8b878] pl-3 text-[12.5px] leading-snug text-[#8a6414] print:hidden">
          {overflowing.join(", ")} {overflowing.length === 1 ? "has a result" : "have results"} too long to fit a
          page even on {overflowing.length === 1 ? "its" : "their"} own sheet - the bottom would be cut off.
          Shorten {overflowing.length === 1 ? "that value" : "those values"} from the lab queue.
        </p>
      )}

      {tests === 0 ? (
        <p className="mx-auto w-full max-w-[210mm] border-l-2 border-[#d8b878] pl-3 text-[12.5px] leading-snug text-[#8a6414] print:hidden">
          Nothing on this order has results yet, so there is nothing to print. Enter them from the lab queue.
        </p>
      ) : (
        printable.map((r) => (
          <LabReportPages
            key={r.test.id}
            data={r} onStationery={onStationery} printedAt={printedAt}
            onLayout={(l) => setLayouts((prev) => {
              const cur = prev[r.test.id];
              if (cur && cur.pages === l.pages && cur.overflowMm === l.overflowMm) return prev;
              return { ...prev, [r.test.id]: l };
            })}
          />
        ))
      )}
    </div>
  );
}
