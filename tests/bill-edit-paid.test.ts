import { describe, it, expect } from "vitest";
import {
  assertTotalCoversCollected, invoiceStatusFrom, InvoiceMathError, computeInvoiceTotals,
} from "@/server/billing/calc";

/**
 * EDITING A BILL SOMEBODY HAS ALREADY PAID.
 *
 * This used to be refused outright, and the refusal was doing more work than it
 * looked like: it was the only thing stopping a corrected total from falling
 * below the money in the drawer, and the only thing keeping a bill's status
 * honest after an edit. Allowing paid edits means both of those now have to be
 * held deliberately.
 *
 * The failure to fear is silent. Nothing throws when a ₹1200 bill that collected
 * ₹1200 is corrected to ₹400 - the row simply says ₹400, the payment still says
 * ₹1200, and the ₹800 difference exists only as a discrepancy between two
 * screens nobody reads together.
 */

const p = (...amts: number[]) => amts.map((amount) => ({ amount }));

describe("the floor - a bill may not be corrected below what was collected", () => {
  it("refuses a correction that would leave money unaccounted for", () => {
    // ₹1200 paid in full, corrected down to ₹400. The missing ₹800 is the bug.
    expect(() => assertTotalCoversCollected(400, 1200)).toThrow(InvoiceMathError);
    expect(() => assertTotalCoversCollected(400, 1200)).toThrow(/already been collected/i);
  });

  it("says the figure and points at the refund, so the desk knows what to do", () => {
    expect(() => assertTotalCoversCollected(400, 1200)).toThrow(/₹1200\.00/);
    expect(() => assertTotalCoversCollected(400, 1200)).toThrow(/refund/i);
  });

  it("allows a correction UP - the balance simply reappears", () => {
    expect(() => assertTotalCoversCollected(1500, 1200)).not.toThrow();
  });

  it("allows a correction to exactly what was collected", () => {
    expect(() => assertTotalCoversCollected(1200, 1200)).not.toThrow();
  });

  it("does not trip on a rounding crumb", () => {
    // A bill collected to the rupee must not be refused over a stray paisa.
    expect(() => assertTotalCoversCollected(1199.995, 1200)).not.toThrow();
  });

  it("leaves an unpaid bill completely free", () => {
    // Nothing collected, so there is no floor - including down to zero.
    expect(() => assertTotalCoversCollected(0, 0)).not.toThrow();
    expect(() => assertTotalCoversCollected(50, 0)).not.toThrow();
  });

  it("counts refunded money as no longer collected", () => {
    // ₹1200 taken, ₹1000 already given back. Only ₹200 still has to be covered,
    // so a correction to ₹500 is fine. (The caller passes the NET figure.)
    const stillHeld = 1200 - 1000;
    expect(() => assertTotalCoversCollected(500, stillHeld)).not.toThrow();
  });
});

describe("the status after a paid bill is corrected", () => {
  it("re-opens a PAID bill whose total went up", () => {
    // The one that would otherwise go unnoticed: leave the status at PAID and
    // the bill drops off the desk's due list with ₹300 still owed on it.
    expect(invoiceStatusFrom(1500, p(1200))).toBe("PARTIALLY_PAID");
  });

  it("keeps it PAID when the correction lands on what was collected", () => {
    expect(invoiceStatusFrom(1200, p(1200))).toBe("PAID");
  });

  it("marks it PAID when a part-paid bill is corrected down to what was paid", () => {
    // ₹2000 billed, ₹800 collected, corrected to ₹800 - now settled in full.
    expect(invoiceStatusFrom(800, p(800))).toBe("PAID");
  });

  it("still reads REFUNDED when everything went back", () => {
    // An edit must not resurrect a bill that was refunded to zero.
    expect(invoiceStatusFrom(1200, p(1200), p(1200))).toBe("REFUNDED");
  });
});

describe("the two together - a realistic correction round", () => {
  it("lets a wrongly-billed test be swapped on a bill already paid in full", () => {
    // ₹1200 collected for a CBP + LFT. The LFT was the wrong test; the right one
    // costs more. Total goes to ₹1400 - allowed, and ₹200 is now due.
    expect(() => assertTotalCoversCollected(1400, 1200)).not.toThrow();
    expect(invoiceStatusFrom(1400, p(1200))).toBe("PARTIALLY_PAID");
  });

  it("blocks the same swap when the right test is CHEAPER", () => {
    // ₹1200 collected, correct total ₹900. Refusing is the point: ₹300 is owed
    // BACK to the patient, and that has to be a refund with a row of its own.
    expect(() => assertTotalCoversCollected(900, 1200)).toThrow(/refund/i);
  });
});

describe("a settled bill stays editable - the desk must be able to reach its date", () => {
  /**
   * THE BUG THIS REPLACED. The edit dialog predicted the new total as a PRE-GST
   * subtotal and compared it against money collected, which includes GST. On any
   * bill carrying tax the comparison was always "below collected", and both Save
   * buttons are disabled on that flag - so all 275 settled pharmacy bills were
   * frozen. Not just their amounts: their DATE too, which is what the counter
   * was actually trying to change.
   *
   * The dialog now predicts with computeInvoiceTotals, the same function
   * updateInvoice stores with, so the two cannot disagree.
   */
  const predict = (lines: { unitPrice: number; qty?: number; gstRatePct?: number }[], discount = 0) =>
    computeInvoiceTotals(lines.map((l, i) => ({ description: `line ${i}`, ...l })), discount).total;

  it("does not refuse a bill whose lines are unchanged", () => {
    // 1000 + 12% GST = 1120 collected. Re-dating changes no line.
    const total = predict([{ unitPrice: 1000, gstRatePct: 12 }]);
    expect(total).toBe(1120);
    // The pre-GST comparison that used to gate Save: 1000 < 1120, so it blocked.
    expect(1000 < 1120).toBe(true);
    // Against the real total there is nothing to refuse.
    expect(() => assertTotalCoversCollected(total, 1120)).not.toThrow();
  });

  it("still refuses a genuine drop below the money collected", () => {
    // The floor has to keep holding - this is the case the flag exists for.
    const total = predict([{ unitPrice: 300, gstRatePct: 12 }]);
    expect(() => assertTotalCoversCollected(total, 1120)).toThrow(InvoiceMathError);
  });

  it("tolerates a rounding crumb on a bill settled to the exact rupee", () => {
    const total = predict([{ unitPrice: 333.33, gstRatePct: 5 }]);
    expect(() => assertTotalCoversCollected(total, total + 0.01)).not.toThrow();
  });
});
