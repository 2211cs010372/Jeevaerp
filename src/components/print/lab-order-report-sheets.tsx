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
 * page break after each: two tests print two pages, four print four. Every
 * sheet is the same `LabReportBody` the single-report page draws, so a patient
 * handed three sheets from one sample cannot tell which screen printed which.
 *
 *   /print/lab-order/{orderId}                 every report on the order
 *   /print/lab-order/{orderId}?paper=plain     drawn letterhead, for blank stock
 *   /print/lab-order/{orderId}?notes=off       without the reference notes
 *
 * A test with no values entered is NOT printed - it would spend a sheet of the
 * hospital's pre-printed paper on a header and an empty table - but it is named
 * on screen, so the technician can see what is still owed before they print.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { LabReportBody, type Report } from "@/components/print/lab-report-sheet";
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
  const [withNotes, setWithNotes] = useState(params.get("notes") !== "off");

  const [data, setData] = useState<OrderReports | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  /**
   * Millimetres each sheet still runs past the paper once it has shrunk as far
   * as it will go, by test id. Reported by the sheets themselves - see
   * LabReportBody's onFit - because only they know when their fitting has
   * finished, and a warning raised mid-shrink names reports that end up fine.
   */
  const [overflowMm, setOverflowMm] = useState<Record<string, number>>({});

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

  // Each sheet is pinned to its own page, so anything past the bottom is not
  // printed - and with the foot lifted into the paper's bottom band, the
  // overspill prints ON TOP of the signature block rather than falling off the
  // end. The sheets shrink themselves to avoid that; these are the ones that
  // could not shrink far enough, named individually, because in a four-page
  // document "this report is too long" is not an answer anybody can act on.
  const overflowing = printable
    .filter((r) => (overflowMm[r.test.id] ?? 0) > 0)
    .map((r) => r.test.testName);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!data) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the reports…</div>;

  const patientName = data.reports[0]?.patient?.fullName ?? "";
  const pages = printable.length;

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: multiSheetPrintCss(onStationery) }} />
      <PrintToolbar
        title={`Lab reports · ${pages} test${pages === 1 ? "" : "s"}${patientName ? ` · ${patientName}` : ""}`}
      />

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

      {/* How much paper this is about to use, before it is used. */}
      {pages > 0 && (
        <p className="mx-auto mb-3 w-full max-w-[210mm] text-[12.5px] leading-snug text-[#5a6a66] print:hidden">
          One job, <span className="font-semibold">{pages} page{pages === 1 ? "" : "s"}</span> - each test on its
          own sheet, in the order it was raised.
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
          Set as small as {overflowing.length === 1 ? "it goes" : "they go"}, {overflowing.join(", ")}{" "}
          {overflowing.length === 1 ? "still runs" : "still run"} past the printable area - the bottom would be
          cut off. Turn off the reference notes above, or print
          {overflowing.length === 1 ? " that test" : " those tests"} on {overflowing.length === 1 ? "its" : "their"} own.
        </p>
      )}

      {pages === 0 ? (
        <p className="mx-auto w-full max-w-[210mm] border-l-2 border-[#d8b878] pl-3 text-[12.5px] leading-snug text-[#8a6414] print:hidden">
          Nothing on this order has results yet, so there is nothing to print. Enter them from the lab queue.
        </p>
      ) : (
        printable.map((r) => (
          <div key={r.test.id} className="print-sheet">
            <LabReportBody
              data={r} onStationery={onStationery} withNotes={withNotes} printedAt={printedAt}
              onFit={(mm) => setOverflowMm((prev) => (prev[r.test.id] === mm ? prev : { ...prev, [r.test.id]: mm }))}
            />
          </div>
        ))
      )}
    </div>
  );
}
