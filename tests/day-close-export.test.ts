import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildDayCloseWorkbook, dayCloseFilename, type DayCloseExport } from "@/lib/export/day-close-xlsx";

/**
 * The whole risk in a money export is a figure that LOOKS right and can't be
 * summed. "₹1,200.00" is a string; the SUM at the bottom of an accountant's
 * column then reads 0 and nobody notices until the drawer disagrees. These pin
 * that every money cell leaves as a real number.
 */

const sample: DayCloseExport = {
  date: "2026-07-26",
  modes: [
    { mode: "CASH", collected: 12500.5, refunded: 500, net: 12000.5, count: 9 },
    { mode: "UPI", collected: 8300, refunded: 0, net: 8300, count: 6 },
    { mode: "CARD", collected: 0, refunded: 0, net: 0, count: 0 },
    { mode: "NETBANKING", collected: 0, refunded: 0, net: 0, count: 0 },
    { mode: "OTHER", collected: 0, refunded: 0, net: 0, count: 0 },
  ],
  totals: { collected: 20800.5, refunded: 500, net: 20300.5 },
  cashInHand: 12000.5,
  bills: 15,
  refundCount: 1,
  byCounter: [{ name: "Ravi (Reception)", count: 15, amount: 20800.5 }],
  refunds: [{
    receiptNo: "INV-2026-000312", patient: "Ramesh Kumar", amount: 500,
    mode: "CASH", reason: "Test cancelled", by: "Ravi (Reception)",
    at: "2026-07-26T10:30:00.000Z",
  }],
  outstanding: [{ receiptNo: "INV-2026-000315", patient: "Divya Prasad", total: 2400, paid: 1000, due: 1400 }],
  insurance: [{ receiptNo: "INV-2026-000318", patient: "Sunita Rao", insurer: "Star Health", total: 46000 }],
  insuranceTotal: 46000,
};

const cell = (ws: XLSX.WorkSheet, ref: string) => ws[ref] as XLSX.CellObject | undefined;

describe("the day-close workbook", () => {
  it("names the file after the day it covers", () => {
    expect(dayCloseFilename("2026-07-26")).toBe("jeeva-day-close-2026-07-26.xlsx");
  });

  it("carries one sheet per section of the page", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    expect(wb.SheetNames).toEqual(["Summary", "Payment types", "By counter", "Refunds", "Outstanding", "Insurance"]);
  });

  it("leads with cash in hand - the one figure anyone acts on", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    const ws = wb.Sheets["Summary"];
    expect(cell(ws, "B4")?.v).toBe(12000.5);
    expect(cell(ws, "B4")?.t).toBe("n");
  });

  it("writes money as numbers, not as pre-formatted text", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    const ws = wb.Sheets["Payment types"];
    // Row 2 = first data row: CASH | 9 | 12500.5 | 500 | 12000.5
    for (const ref of ["C2", "D2", "E2"]) {
      expect(cell(ws, ref)?.t, `${ref} must be numeric`).toBe("n");
      expect(typeof cell(ws, ref)?.v).toBe("number");
    }
    expect(cell(ws, "C2")?.v).toBe(12500.5);
    expect(cell(ws, "E2")?.v).toBe(12000.5);
  });

  it("gives money cells a rupee format so they still read as currency", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    expect(cell(wb.Sheets["Payment types"], "C2")?.z).toContain("₹");
  });

  it("leaves the count column alone - 9 payments is not ₹9", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    const c = cell(wb.Sheets["Payment types"], "B2");
    expect(c?.v).toBe(9);
    expect(c?.z).toBeUndefined();
  });

  it("totals the payment-type sheet so the workbook proves its own arithmetic", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Payment types"]);
    const total = rows.find((r) => r.Mode === "TOTAL");
    expect(total?.Collected).toBe(20800.5);
    expect(total?.Net).toBe(20300.5);
  });

  it("still writes Refunds and Outstanding when a day has none", async () => {
    // An absent sheet reads as "not exported"; an empty one reads as "none
    // happened". Those are different facts and the quiet day must say the second.
    const quiet: DayCloseExport = { ...sample, refunds: [], outstanding: [], refundCount: 0 };
    const wb = await buildDayCloseWorkbook(quiet);
    expect(wb.SheetNames).toContain("Refunds");
    expect(wb.SheetNames).toContain("Outstanding");
    expect(XLSX.utils.sheet_to_json(wb.Sheets["Refunds"])).toHaveLength(0);
  });

  // ── INSURANCE ── billed, never collected.
  //
  // The failure this guards against is the quiet one: a cashless bill folded into
  // a collections figure. The accountant sums the column, the drawer disagrees by
  // the size of a stay, and nobody can find where it came from.
  it("keeps insurance billing out of the collected totals", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Payment types"]);
    const total = rows.find((r) => r.Mode === "TOTAL");
    // ₹46,000 went to Star Health today and appears in neither figure.
    expect(total?.Collected).toBe(20800.5);
    expect(total?.Net).toBe(20300.5);
  });

  it("reports insurance on the summary, below the money and never inside it", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    const ws = wb.Sheets["Summary"];
    // Walk the declared range rather than Object.keys: the summary has blank
    // spacer rows, so its A-column cells are not contiguous and an index into a
    // filtered key list is not a row number.
    const range = XLSX.utils.decode_range(ws["!ref"] as string);
    const rowOf = (label: (s: string) => boolean) => {
      for (let r = range.s.r; r <= range.e.r; r++) {
        const c = ws[XLSX.utils.encode_cell({ c: 0, r })] as XLSX.CellObject | undefined;
        if (c && label(String(c.v ?? ""))) return r;
      }
      return -1;
    };
    const netRow = rowOf((l) => l === "Net collected");
    const insRow = rowOf((l) => l.startsWith("Billed to insurers"));
    expect(netRow).toBeGreaterThan(-1);
    expect(insRow).toBeGreaterThan(netRow);
    // and as a real number, so it can be read by the same person summing columns
    const insCell = ws[XLSX.utils.encode_cell({ c: 1, r: insRow })] as XLSX.CellObject | undefined;
    expect(insCell?.t).toBe("n");
    expect(insCell?.v).toBe(46000);
  });

  it("gives insurance its own sheet, written even on a day with none", async () => {
    const quiet: DayCloseExport = { ...sample, insurance: [], insuranceTotal: 0 };
    const wb = await buildDayCloseWorkbook(quiet);
    expect(wb.SheetNames).toContain("Insurance");
    // The TOTAL row is always present, so the sheet is never a blank rectangle.
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Insurance"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Receipt).toBe("TOTAL");
  });

  it("survives a caller that predates the insurance fields", async () => {
    // The field is optional so an older caller still exports; it must not throw
    // and must not invent a number.
    const legacy = { ...sample } as DayCloseExport;
    delete legacy.insurance;
    delete legacy.insuranceTotal;
    const wb = await buildDayCloseWorkbook(legacy);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Insurance"]);
    expect(rows[0]?.["Amount billed"]).toBe(0);
  });

  it("keeps every sheet name inside Excel's 31-character limit", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    for (const n of wb.SheetNames) expect(n.length).toBeLessThanOrEqual(31);
  });
});
