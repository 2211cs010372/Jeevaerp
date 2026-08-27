import { describe, it, expect } from "vitest";
import { foldDrawer, cashInHandOf } from "@/server/billing/drawer";
import { advancePaymentRef } from "@/server/billing/advances";

/**
 * THE DEPOSIT THAT WAS MISSING FROM THE DRAWER, AND THE ONE THAT WAS COUNTED TWICE.
 *
 * An IPD advance is money a family hands across the counter. It has no bill
 * behind it yet, so it is stored in AdmissionAdvance rather than in Payment -
 * and the day close read only Payment. Two failures came out of that, days
 * apart, and nobody could connect them:
 *
 *   Day 1  Reception takes Rs 3,000 cash as a deposit. Day close shows Rs 0.
 *          The receptionist counts Rs 3,000 more than the sheet says, every
 *          single time, and learns to stop trusting the sheet.
 *
 *   Day 5  The patient is discharged. The deposit is written as a payment
 *          against the final bill, raised that day. The discharge clerk's day
 *          close now shows Rs 3,000 of cash collected that their drawer never
 *          saw on that shift.
 *
 * So a deposit must be counted on the day it was TAKEN, and exactly ONCE. Both
 * halves are below, because fixing either alone makes the reconciliation worse
 * rather than better - count the deposit without skipping the discharge write
 * and the hospital double-counts every advance it has ever taken.
 */

const MODES = ["CASH", "UPI", "CARD", "NETBANKING", "OTHER"] as const;
const of = (totals: ReturnType<typeof foldDrawer>, mode: string) =>
  totals.find((m) => m.mode === mode)!;

/** A discharge-day payment that is really an old deposit being adjusted. */
const adjustment = (mode: string, amount: number, slip = "JMH2026ADV0012") => ({
  mode, amount, reference: advancePaymentRef("JMH2026IP0007", slip),
});

const fold = (input: Partial<Parameters<typeof foldDrawer>[1]>) =>
  foldDrawer(MODES, { payments: [], advances: [], refunds: [], ...input });

describe("the shift that takes the deposit", () => {
  it("counts an IPD deposit in the drawer on the day it was taken", () => {
    // The whole complaint, in one assertion: Rs 3,000 of cash in the box has to
    // appear on the sheet the receptionist reconciles against.
    const totals = fold({ advances: [{ mode: "CASH", amount: 3000 }] });
    expect(cashInHandOf(totals)).toBe(3000);
    expect(of(totals, "CASH").collected).toBe(3000);
    expect(of(totals, "CASH").count).toBe(1);
  });

  it("counts a deposit in the mode it was actually paid in", () => {
    // A UPI deposit must not swell the cash box. This is the same class of bug
    // as the one advance-tender-modes.test.ts locks shut on the billing side.
    const totals = fold({ advances: [{ mode: "UPI", amount: 5000 }] });
    expect(cashInHandOf(totals)).toBe(0);
    expect(of(totals, "UPI").collected).toBe(5000);
  });

  it("counts TWO deposits on one stay as two, not one", () => {
    const totals = fold({
      advances: [{ mode: "CASH", amount: 3000 }, { mode: "CASH", amount: 5000 }],
    });
    expect(of(totals, "CASH").collected).toBe(8000);
    expect(of(totals, "CASH").count).toBe(2);
  });

  it("adds deposits to counter takings rather than replacing them", () => {
    const totals = fold({
      payments: [{ mode: "CASH", amount: 1200, reference: null }],
      advances: [{ mode: "CASH", amount: 3000 }],
    });
    expect(cashInHandOf(totals)).toBe(4200);
    expect(of(totals, "CASH").count).toBe(2);
  });
});

describe("the shift that closes the file", () => {
  it("does NOT count the deposit again when discharge adjusts it", () => {
    // The discharge clerk took no money. Their drawer must not be told it did.
    const totals = fold({ payments: [adjustment("CASH", 3000)] });
    expect(cashInHandOf(totals)).toBe(0);
    expect(of(totals, "CASH").count).toBe(0);
  });

  it("still counts the balance the family pays at discharge", () => {
    // Rs 8,000 held, Rs 12,000 bill, Rs 4,000 handed over now. Only the 4,000
    // is this shift's money - and it must not be lost along with the adjustment.
    const totals = fold({
      payments: [
        adjustment("CASH", 3000, "JMH2026ADV0012"),
        adjustment("UPI", 5000, "JMH2026ADV0019"),
        { mode: "CASH", amount: 4000, reference: null },
      ],
    });
    expect(cashInHandOf(totals)).toBe(4000);
    expect(of(totals, "UPI").collected).toBe(0);
  });

  it("never treats a real UPI reference as a deposit adjustment", () => {
    // A transaction id typed at the desk is takings. Reading it as an adjustment
    // would hide real money from the count, which is the failure that matters
    // most here: a shortfall the receptionist gets asked to explain.
    const totals = fold({
      payments: [{ mode: "UPI", amount: 900, reference: "402919283746" }],
    });
    expect(of(totals, "UPI").collected).toBe(900);
  });
});

describe("the whole cycle balances", () => {
  it("counts a deposit exactly once across the two days it touches", () => {
    const dayTaken = fold({ advances: [{ mode: "CASH", amount: 3000 }] });
    const dayDischarged = fold({ payments: [adjustment("CASH", 3000)] });
    expect(cashInHandOf(dayTaken) + cashInHandOf(dayDischarged)).toBe(3000);
  });

  it("a deposit refunded in full leaves the drawer where it started", () => {
    const totals = fold({
      advances: [{ mode: "CASH", amount: 3000 }],
      refunds: [{ mode: "CASH", amount: 3000 }],
    });
    expect(cashInHandOf(totals)).toBe(0);
    expect(of(totals, "CASH").collected).toBe(3000);
    expect(of(totals, "CASH").refunded).toBe(3000);
  });

  it("a UPI refund does not empty the cash box", () => {
    const totals = fold({
      advances: [{ mode: "CASH", amount: 3000 }],
      refunds: [{ mode: "UPI", amount: 5000 }],
    });
    expect(cashInHandOf(totals)).toBe(3000);
    expect(of(totals, "UPI").net).toBe(-5000);
  });
});

describe("the shape of the statement", () => {
  it("reports every mode, even the ones the day never saw", () => {
    // A missing row reads as a bug; a zero row reads as a quiet day.
    const totals = fold({ advances: [{ mode: "CASH", amount: 100 }] });
    expect(totals.map((m) => m.mode)).toEqual([...MODES]);
    expect(of(totals, "CARD")).toEqual({ mode: "CARD", collected: 0, refunded: 0, net: 0, count: 0 });
  });

  it("adds paise without float drift", () => {
    // 0.1 + 0.2 is the reason this assertion exists.
    const totals = fold({
      advances: [{ mode: "CASH", amount: 1000.1 }, { mode: "CASH", amount: 2000.2 }],
      payments: [{ mode: "CASH", amount: 0.7, reference: null }],
    });
    expect(of(totals, "CASH").collected).toBe(3001);
  });

  it("gives an empty day zeroes, not an empty statement", () => {
    const totals = fold({});
    expect(totals).toHaveLength(MODES.length);
    expect(cashInHandOf(totals)).toBe(0);
  });
});
