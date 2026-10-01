import { describe, it, expect } from "vitest";
import { planPaymentTrim } from "@/server/billing/calc";

/**
 * LOWERING A STAY BILL'S PAYMENTS TO ITS CORRECTED TOTAL.
 *
 * The case that asked for it: IP00143 was keyed in with an admission date 55
 * days early, discharged with the pre-filled ₹2,12,800 recorded as cash, and
 * then could not have its dates corrected because the bill could not fall below
 * that "collected" figure.
 */

const at = (iso: string) => new Date(iso);

describe("which payments give way when a stay bill is corrected down", () => {
  it("lowers the single discharge payment to the new total", () => {
    const plan = planPaymentTrim(
      [{ id: "cash", amount: 212800, isAdvance: false, createdAt: at("2026-09-30T10:05:01Z") }],
      212800 - 19000,
    );
    expect(plan).toEqual([{ id: "cash", from: 212800, to: 19000 }]);
  });

  it("takes desk payments first, latest first, and advance adjustments last", () => {
    const plan = planPaymentTrim(
      [
        { id: "adv", amount: 20000, isAdvance: true, createdAt: at("2026-09-30T10:05:00Z") },
        { id: "upi", amount: 5000, isAdvance: false, createdAt: at("2026-09-30T10:05:01Z") },
        { id: "cash", amount: 3000, isAdvance: false, createdAt: at("2026-09-30T10:05:02Z") },
      ],
      10000,
    );
    expect(plan).toEqual([
      { id: "cash", from: 3000, to: 0 },
      { id: "upi", from: 5000, to: 0 },
      { id: "adv", from: 20000, to: 18000 },
    ]);
  });

  it("changes nothing when there is no excess, or only a paise crumb", () => {
    const p = [{ id: "cash", amount: 500, isAdvance: false, createdAt: at("2026-09-30T10:00:00Z") }];
    expect(planPaymentTrim(p, 0)).toEqual([]);
    expect(planPaymentTrim(p, 0.01)).toEqual([]);
  });

  it("works in rupees and paise without drift", () => {
    const plan = planPaymentTrim(
      [{ id: "cash", amount: 1000.5, isAdvance: false, createdAt: at("2026-09-30T10:00:00Z") }],
      0.3,
    );
    expect(plan).toEqual([{ id: "cash", from: 1000.5, to: 1000.2 }]);
  });
});
