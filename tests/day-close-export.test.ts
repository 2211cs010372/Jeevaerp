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
};

const cell = (ws: XLSX.WorkSheet, ref: string) => ws[ref] as XLSX.CellObject | undefined;

describe("the day-close workbook", () => {
  it("names the file after the day it covers", () => {
    expect(dayCloseFilename("2026-07-26")).toBe("jeeva-day-close-2026-07-26.xlsx");
  });

  it("carries one sheet per section of the page", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    expect(wb.SheetNames).toEqual(["Summary", "Payment types", "By counter", "Refunds", "Outstanding"]);
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

  it("keeps every sheet name inside Excel's 31-character limit", async () => {
    const wb = await buildDayCloseWorkbook(sample);
    for (const n of wb.SheetNames) expect(n.length).toBeLessThanOrEqual(31);
  });
});
