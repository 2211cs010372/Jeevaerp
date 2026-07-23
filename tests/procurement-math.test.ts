import { describe, it, expect } from "vitest";
import {
  effectiveUnitCost, lineValue, lineTax, orderTotals,
  suggestedOrderQty, daysOfCover, invoiceVariance,
} from "@/lib/pharmacy/procurement-math";

describe("free goods - the number that makes margin honest", () => {
  it("spreads a 10+1 scheme across the whole batch", () => {
    // 10 strips at ₹100 with 1 free = 11 strips for ₹1000.
    expect(effectiveUnitCost(10, 1, 100)).toBe(90.91);
  });

  it("is just the rate when nothing is free", () => {
    expect(effectiveUnitCost(10, 0, 100)).toBe(100);
  });

  it("costs NOTHING when the whole line is free", () => {
    // A sample box. Recording it at rate would invent a cost that was never paid.
    expect(effectiveUnitCost(0, 5, 100)).toBe(0);
  });

  it("never divides by zero", () => {
    expect(effectiveUnitCost(0, 0, 100)).toBe(0);
  });

  it("the landed cost is ALWAYS at or below the invoice rate", () => {
    // The whole point: free goods can only ever make a unit cheaper. If this
    // ever inverts, every profit figure in the pharmacy overstates itself.
    for (const [q, f, c] of [[10, 1, 100], [20, 3, 45.5], [7, 2, 12.25], [1, 0, 9]]) {
      expect(effectiveUnitCost(q, f, c)).toBeLessThanOrEqual(c);
    }
  });
});

describe("line and order arithmetic", () => {
  it("free units are not billed", () => {
    // 10 paid + 2 free is still a ₹1000 line.
    expect(lineValue(10, 100)).toBe(1000);
  });

  it("taxes the goods, not the freebies", () => {
    expect(lineTax(10, 100, 12)).toBe(120);
    expect(lineTax(10, 100, 0)).toBe(0);
  });

  it("totals an order at quoted rates", () => {
    const t = orderTotals([
      { qtyOrdered: 10, unitCost: 100, gstRatePct: 12 },
      { qtyOrdered: 5, unitCost: 40, gstRatePct: 5 },
    ]);
    expect(t.subtotal).toBe(1200);
    expect(t.taxAmount).toBe(130);      // 120 + 10
    expect(t.totalAmount).toBe(1330);
  });

  it("an empty order is zero, not NaN", () => {
    expect(orderTotals([])).toEqual({ subtotal: 0, taxAmount: 0, totalAmount: 0 });
  });
});

describe("how much to reorder", () => {
  it("tops up to 3x the threshold by default", () => {
    // Not "up to the threshold" - that puts you back on this list next week.
    expect(suggestedOrderQty({ inStock: 4, reorderThreshold: 10 })).toBe(26);
  });

  it("respects an explicit top-up target", () => {
    expect(suggestedOrderQty({ inStock: 4, reorderThreshold: 10, reorderQty: 100 })).toBe(96);
  });

  it("SUBTRACTS what is already on its way", () => {
    // The double-order bug: open the screen twice before the van arrives and
    // you order it twice. 30 target - 4 on shelf - 20 coming = 6.
    expect(suggestedOrderQty({ inStock: 4, reorderThreshold: 10, onOrder: 20 })).toBe(6);
  });

  it("suggests nothing when the delivery already covers it", () => {
    expect(suggestedOrderQty({ inStock: 4, reorderThreshold: 10, onOrder: 40 })).toBe(0);
  });

  it("never returns a negative order", () => {
    expect(suggestedOrderQty({ inStock: 500, reorderThreshold: 10 })).toBe(0);
  });

  it("handles a zero threshold without asking for zero units", () => {
    expect(suggestedOrderQty({ inStock: 0, reorderThreshold: 0 })).toBe(1);
  });
});

describe("days of cover", () => {
  it("divides stock by the burn rate", () => {
    expect(daysOfCover(100, 10)).toBe(10);
    expect(daysOfCover(95, 10)).toBe(9);   // floor - don't promise a day you don't have
  });

  it("returns null rather than INVENTING a run-out date", () => {
    // A medicine nobody has dispensed has no meaningful cover. Showing
    // "0 days left" on a screen a pharmacist trusts would be fiction.
    expect(daysOfCover(100, 0)).toBeNull();
  });
});

describe("does the supplier's invoice match the carton?", () => {
  it("says nothing when no invoice amount was captured", () => {
    expect(invoiceVariance(null, 1000)).toBeNull();
    expect(invoiceVariance(undefined, 1000)).toBeNull();
  });

  it("tolerates rounding drift on a long invoice", () => {
    expect(invoiceVariance(1000.5, 1000)).toEqual({ variance: 0.5, mismatch: false });
  });

  it("flags an overbill", () => {
    // They billed ₹200 more than what came out of the carton.
    expect(invoiceVariance(1200, 1000)).toEqual({ variance: 200, mismatch: true });
  });

  it("flags an UNDERbill too", () => {
    // Just as important: it usually means a line was short-supplied.
    expect(invoiceVariance(800, 1000)).toEqual({ variance: -200, mismatch: true });
  });

  it("an exact match is not a mismatch", () => {
    expect(invoiceVariance(1000, 1000)).toEqual({ variance: 0, mismatch: false });
  });
});

describe("the receipt totals hang together", () => {
  it("goods value + free units = what lands on the shelf, at the right cost", () => {
    // One realistic delivery line, end to end.
    const qty = 20, free = 3, rate = 48.5;
    const value = lineValue(qty, rate);
    const landed = effectiveUnitCost(qty, free, rate);

    expect(value).toBe(970);                       // billed for 20
    expect(landed).toBe(42.17);                    // spread across 23
    // The shelf gains 23 units whose total cost is what we actually paid.
    expect(Math.round(landed * (qty + free))).toBe(Math.round(value));
  });
});
