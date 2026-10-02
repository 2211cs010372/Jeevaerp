import { describe, it, expect } from "vitest";
import { planAdvanceApplication } from "@/server/billing/advances";
import { effectiveBillDate } from "@/server/billing/calc";

/**
 * CORRECTING A DEPOSIT THAT IS ALREADY ON A BILL.
 *
 * The slip is paper in a family's bag; the deposit is also a Payment row holding
 * a discharged stay's invoice down. Correct the slip and the two disagree, and
 * the direction of the disagreement decides what breaks: too high and the bill
 * reads as settled on money nobody has, too low and the family is asked for
 * money they already handed over.
 */
describe("re-applying a corrected deposit to a stay bill", () => {
  it("applies the whole deposit when the bill has room for it", () => {
    expect(planAdvanceApplication({ amount: 10000, billTotal: 30000, otherPaid: 0 }))
      .toEqual({ apply: 10000, unapplied: 0 });
  });

  it("caps at the bill and leaves the rest refundable", () => {
    // A ₹50,000 deposit on a ₹30,000 bill. The discharge has always capped it
    // here; the ₹20,000 goes back at the refund counter, it does not vanish.
    expect(planAdvanceApplication({ amount: 50000, billTotal: 30000, otherPaid: 0 }))
      .toEqual({ apply: 30000, unapplied: 20000 });
  });

  it("only takes the room the counter's own money left", () => {
    // The family paid ₹25,000 in cash at discharge as well. The deposit may only
    // claim the ₹5,000 still open, whatever the slip says.
    expect(planAdvanceApplication({ amount: 10000, billTotal: 30000, otherPaid: 25000 }))
      .toEqual({ apply: 5000, unapplied: 5000 });
  });

  it("applies nothing to a bill the counter has already settled", () => {
    // THE CASE THAT MOTIVATED THE CAP. Without it a corrected deposit would be
    // recorded on top of a paid bill, and the stay would read as over-collected
    // with no refund row anywhere saying so.
    expect(planAdvanceApplication({ amount: 8000, billTotal: 30000, otherPaid: 30000 }))
      .toEqual({ apply: 0, unapplied: 8000 });
  });

  it("treats a stay with no bill as no room at all", () => {
    // Still in a bed: nothing to adjust against, and the whole deposit is held.
    expect(planAdvanceApplication({ amount: 8000, billTotal: 0, otherPaid: 0 }))
      .toEqual({ apply: 0, unapplied: 8000 });
  });

  it("never returns a negative application from an over-refunded bill", () => {
    expect(planAdvanceApplication({ amount: 8000, billTotal: 30000, otherPaid: 40000 }))
      .toEqual({ apply: 0, unapplied: 8000 });
  });

  it("keeps the paisa, so a corrected deposit settles a bill exactly", () => {
    expect(planAdvanceApplication({ amount: 1234.56, billTotal: 1234.56, otherPaid: 0 }))
      .toEqual({ apply: 1234.56, unapplied: 0 });
  });
});

/**
 * ONE QUESTION, ONE FUNCTION: what date does this bill have?
 *
 * Asked separately in each document before, which is how the IP bill came to
 * print a folded-in bill's raised date while the bill's own copy printed the
 * corrected one.
 */
describe("the date a bill actually has", () => {
  it("is the corrected date where a desk set one", () => {
    const billDate = new Date("2026-09-15T12:00:00+05:30");
    const createdAt = new Date("2026-09-30T18:42:11+05:30");
    expect(effectiveBillDate({ billDate, createdAt })).toBe(billDate);
  });

  it("falls back to the raised date where nobody corrected it", () => {
    const createdAt = new Date("2026-09-30T18:42:11+05:30");
    expect(effectiveBillDate({ billDate: null, createdAt })).toBe(createdAt);
  });
});
