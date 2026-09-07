import { describe, it, expect } from "vitest";
import { wantsFullSheet, FULL_SHEET_FROM } from "@/components/print/invoice-sheet";

/**
 * WHICH BILLS LEAVE THE HALF-SHEET.
 *
 * The half-sheet is the hospital's stationery: two copies of a lab bill on one
 * A4, patient above the cut and hospital below it. A bill that outgrows it does
 * not wrap or shrink - before this rule existed, its extra lines printed
 * UNDERNEATH the totals and off the bottom edge, and the sheet still footed to
 * a Net Payable it had no lines to justify.
 *
 * So the boundary is worth pinning: one item either side of it changes what
 * paper the counter hands over.
 */
const bill = (source: string, items: number) => ({
  source,
  items: Array.from({ length: items }, (_, i) => ({ description: `Item ${i + 1}` })),
});

describe("wantsFullSheet - the boundary", () => {
  it("keeps seven items on the half-sheet and sends eight to a full one", () => {
    // The hospital named eight. Seven is comfortably inside what a half-sheet
    // holds; this pair is the whole rule.
    expect(wantsFullSheet(bill("PHARMACY", 7))).toBe(false);
    expect(wantsFullSheet(bill("PHARMACY", 8))).toBe(true);
    expect(wantsFullSheet(bill("LAB", 7))).toBe(false);
    expect(wantsFullSheet(bill("LAB", 8))).toBe(true);
  });

  it("uses the same threshold for both counters", () => {
    expect(FULL_SHEET_FROM).toBe(8);
  });
});

describe("wantsFullSheet - which counters", () => {
  it("covers pharmacy and lab, the two that run long", () => {
    expect(wantsFullSheet(bill("PHARMACY", 30))).toBe(true);
    expect(wantsFullSheet(bill("LAB", 13))).toBe(true);
  });

  it("leaves consultations on the half-sheet at any length", () => {
    // Three lines, always. A consultation cannot reach the threshold, and
    // giving it a full page would be a blank sheet with a fee on it.
    expect(wantsFullSheet(bill("CONSULTATION", 20))).toBe(false);
  });

  it("leaves IPD alone - it has its own A4 document", () => {
    // detailed-bill-sheet.tsx. Sending an inpatient bill through this one would
    // print a second, shorter version of a document that already exists.
    expect(wantsFullSheet(bill("IPD", 40))).toBe(false);
  });

  it("leaves OTHER on the half-sheet", () => {
    expect(wantsFullSheet(bill("OTHER", 12))).toBe(false);
  });
});

describe("wantsFullSheet - degenerate bills", () => {
  it("an empty bill stays on the half-sheet", () => {
    // A bill with no lines is a bill somebody is about to void, not one that
    // needs a bigger sheet.
    expect(wantsFullSheet(bill("LAB", 0))).toBe(false);
    expect(wantsFullSheet(bill("PHARMACY", 0))).toBe(false);
  });

  it("an unknown source stays on the half-sheet", () => {
    // Fails to the stationery the counter already uses: a source added later
    // and not considered here prints the way every other bill does, rather than
    // silently claiming a full page.
    expect(wantsFullSheet(bill("SOMETHING_NEW", 50))).toBe(false);
  });
});
