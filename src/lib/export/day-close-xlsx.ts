/**
 * Day close -> .xlsx.
 *
 * The point of this file is that the accountant gets NUMBERS, not text that
 * looks like numbers. Every money cell is a real JS number with a ₹ format
 * applied, so a column can be summed in Excel; the moment an amount is written
 * as "₹1,200.00" it becomes a string and the SUM at the bottom silently reads 0.
 *
 * One workbook, five sheets, mirroring exactly what the page shows - a report
 * that disagrees with the screen it was exported from is worse than no report.
 *
 * `xlsx` is loaded on demand inside the click handler: it is close to a megabyte
 * and nobody visiting the day-close page should pay for it until they ask.
 */

export interface DayCloseExport {
  date: string;
  modes: { mode: string; collected: number; refunded: number; net: number; count: number }[];
  totals: { collected: number; refunded: number; net: number };
  cashInHand: number;
  bills: number;
  refundCount: number;
  byCounter: { name: string; count: number; amount: number }[];
  refunds: { receiptNo: string; patient: string; amount: number; mode: string; reason: string; by: string; at: string }[];
  outstanding: { receiptNo: string; patient: string; total: number; paid: number; due: number }[];
}

/** Indian-format rupees with two decimals; negatives in red, as an accountant expects. */
const RUPEE_FMT = '₹#,##0.00;[Red]-₹#,##0.00';

const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

type Cell = string | number | null;

/** The filename that lands in the user's Downloads folder. */
export const dayCloseFilename = (date: string) => `jeeva-day-close-${date}.xlsx`;

/**
 * Build the workbook. Separated from the download so the sheet structure and
 * the money-cell typing can be asserted in a test - `writeFile` needs a browser
 * (or a filesystem), and neither belongs in a unit test.
 */
export async function buildDayCloseWorkbook(d: DayCloseExport) {
  const XLSX = await import("xlsx");

  const wb = XLSX.utils.book_new();

  /** Turn a sheet's money columns into formatted numbers. */
  const addSheet = (
    name: string,
    rows: Cell[][],
    opts: { widths: number[]; moneyCols: number[]; headerRows?: number }
  ) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = opts.widths.map((w) => ({ wch: w }));
    const skip = opts.headerRows ?? 1;
    for (let r = skip; r < rows.length; r++) {
      for (const c of opts.moneyCols) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const cell = ws[ref];
        if (cell && typeof cell.v === "number") { cell.t = "n"; cell.z = RUPEE_FMT; }
      }
    }
    // Excel caps sheet names at 31 chars and rejects []:*?/\ - keep it safe.
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  // ── Summary ──────────────────────────────────────────────────────────────
  // Deliberately the first sheet: it is the one number a manager opens for.
  addSheet("Summary", [
    ["Jeeva Multispeciality Hospital - Day Close"],
    ["Date", prettyDate(d.date)],
    [],
    ["Cash in hand (count the drawer against this)", d.cashInHand],
    [],
    ["Total collected", d.totals.collected],
    ["Total refunded", d.totals.refunded],
    ["Net collected", d.totals.net],
    [],
    ["Bills raised", d.bills],
    ["Refunds given", d.refundCount],
    [],
    ["Generated", new Date().toLocaleString("en-IN")],
  ], { widths: [44, 22], moneyCols: [1], headerRows: 3 });

  // ── By payment type ──────────────────────────────────────────────────────
  addSheet("Payment types", [
    ["Mode", "Payments", "Collected", "Refunded", "Net"],
    ...d.modes.map((m) => [m.mode, m.count, m.collected, m.refunded, m.net] as Cell[]),
    ["TOTAL", d.modes.reduce((s, m) => s + m.count, 0), d.totals.collected, d.totals.refunded, d.totals.net],
  ], { widths: [16, 12, 16, 16, 16], moneyCols: [2, 3, 4] });

  // ── By counter ───────────────────────────────────────────────────────────
  addSheet("By counter", [
    ["Received by", "Transactions", "Amount"],
    ...d.byCounter.map((c) => [c.name, c.count, c.amount] as Cell[]),
  ], { widths: [30, 14, 16], moneyCols: [2] });

  // ── Refunds ──────────────────────────────────────────────────────────────
  // Always written, even when empty: a missing sheet reads as "not exported",
  // an empty one reads as "none given" - and those are different facts.
  addSheet("Refunds", [
    ["Receipt", "Patient", "Amount", "Mode", "Reason", "Refunded by", "Time"],
    ...d.refunds.map((r) => [r.receiptNo, r.patient, r.amount, r.mode, r.reason, r.by, timeOf(r.at)] as Cell[]),
  ], { widths: [18, 26, 14, 12, 34, 22, 12], moneyCols: [2] });

  // ── Outstanding ──────────────────────────────────────────────────────────
  addSheet("Outstanding", [
    ["Receipt", "Patient", "Bill total", "Paid", "Still due"],
    ...d.outstanding.map((o) => [o.receiptNo, o.patient, o.total, o.paid, o.due] as Cell[]),
  ], { widths: [18, 28, 16, 16, 16], moneyCols: [2, 3, 4] });

  return wb;
}

/**
 * Build and download the workbook. Returns the filename written so the caller
 * can tell the user what landed in their Downloads folder.
 */
export async function downloadDayCloseXlsx(d: DayCloseExport): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = await buildDayCloseWorkbook(d);
  const filename = dayCloseFilename(d.date);
  XLSX.writeFile(wb, filename);
  return filename;
}
