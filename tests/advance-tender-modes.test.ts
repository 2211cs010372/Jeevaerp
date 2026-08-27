import { describe, it, expect } from "vitest";
import {
  applyAdvances,
  advancePaymentRef,
  isAdvanceAdjustment,
  advanceReceiptNoFromRef,
  ADVANCE_REF_PREFIX,
} from "@/server/billing/advances";

/**
 * MULTIPLE ADVANCES, AND THE DRAWER THAT HAS TO RECONCILE.
 *
 * A family deposits more than once - cash at admission, UPI two days later when
 * the bill grows. At discharge those deposits are applied to the stay's invoice,
 * and how they are applied decides whether the day close balances.
 *
 * Two bugs are locked shut here, found in that order:
 *
 * 1. TENDER MODE. Every deposit was collapsed into ONE payment row carrying the
 *    FIRST deposit's mode. Rs 3,000 cash + Rs 5,000 UPI became a single Rs 8,000
 *    CASH payment, and the day close then showed Rs 8,000 of cash in a drawer
 *    that had only ever taken Rs 3,000.
 *
 * 2. THE SLIP NUMBER. Grouping by mode fixed the mode and left the family's side
 *    wrong: they hold two numbered receipts, and the bill printed one merged
 *    "Less: Advance" line matching neither. Nobody at the counter could show
 *    which slip was which. So each deposit is now applied on its own - which
 *    preserves the mode by construction, since a deposit only ever had one.
 *
 * This file imports the REAL apportionment. It used to re-implement it, and a
 * test that re-implements the logic it is testing proves nothing: the copy here
 * kept passing while the service was changed underneath it.
 */

const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
const dep = (amount: number, mode: string, receiptNo?: string) => ({ amount, mode, receiptNo });

describe("applying several advances to the discharge bill", () => {
  it("keeps cash as cash and UPI as UPI", () => {
    expect(applyAdvances([dep(3000, "CASH"), dep(5000, "UPI")], 20000)).toEqual([
      { mode: "CASH", amount: 3000, receiptNo: null },
      { mode: "UPI", amount: 5000, receiptNo: null },
    ]);
  });

  it("keeps deposits made in the SAME mode as SEPARATE rows", () => {
    // The regression this file exists for. Three cash deposits are three
    // receipts in the family's bag; merging them into one row leaves the bill
    // unable to name any of them, and the argument at the counter unsettleable.
    const rows = applyAdvances(
      [dep(1000, "CASH", "ADV0011"), dep(2000, "CASH", "ADV0014"), dep(500, "UPI", "ADV0021")],
      20000,
    );
    expect(rows).toEqual([
      { mode: "CASH", amount: 1000, receiptNo: "ADV0011" },
      { mode: "CASH", amount: 2000, receiptNo: "ADV0014" },
      { mode: "UPI", amount: 500, receiptNo: "ADV0021" },
    ]);
  });

  it("carries each slip number through to the payment that adjusts it", () => {
    const rows = applyAdvances([dep(3000, "CASH", "JMH2026ADV0012")], 20000);
    expect(rows[0].receiptNo).toBe("JMH2026ADV0012");
  });

  it("applies the whole advance when the bill is larger", () => {
    expect(sum(applyAdvances([dep(3000, "CASH"), dep(5000, "UPI")], 20000))).toBe(8000);
  });

  it("never applies more than is owed - the rest stays refundable", () => {
    // Rs 8,000 held against a Rs 6,000 bill. Applying the lot would be rejected
    // as a tender beyond the balance and would throw the whole discharge.
    const rows = applyAdvances([dep(3000, "CASH"), dep(5000, "UPI")], 6000);
    expect(sum(rows)).toBe(6000);
    // Oldest first: the cash went in first, so the UPI is what is left over -
    // the deposit the family made most recently and will ask about.
    expect(rows).toEqual([
      { mode: "CASH", amount: 3000, receiptNo: null },
      { mode: "UPI", amount: 3000, receiptNo: null },
    ]);
  });

  it("applies nothing to a bill already settled", () => {
    expect(applyAdvances([dep(3000, "CASH")], 0)).toEqual([]);
  });

  it("applies nothing against a NEGATIVE balance", () => {
    // An over-collected bill must not have a deposit pushed onto it as well.
    expect(applyAdvances([dep(3000, "CASH")], -500)).toEqual([]);
  });

  it("stops cleanly when the balance runs out mid-list", () => {
    const rows = applyAdvances(
      [dep(3000, "CASH"), dep(5000, "UPI"), dep(2000, "CARD")],
      3000,
    );
    expect(rows).toEqual([{ mode: "CASH", amount: 3000, receiptNo: null }]);
    expect(sum(rows)).toBe(3000);
  });

  it("skips a zero-value deposit rather than writing an empty tender", () => {
    const rows = applyAdvances([dep(0, "CASH"), dep(2000, "UPI")], 20000);
    expect(rows).toEqual([{ mode: "UPI", amount: 2000, receiptNo: null }]);
  });

  it("what the drawer sees always equals what was applied", () => {
    for (const bill of [0, 500, 3000, 7999, 8000, 12000]) {
      const rows = applyAdvances([dep(3000, "CASH"), dep(5000, "UPI")], bill);
      expect(sum(rows), `bill ${bill}`).toBe(Math.min(8000, bill));
    }
  });

  it("splits to the paisa without float drift", () => {
    const rows = applyAdvances([dep(1000.55, "CASH"), dep(2000.45, "UPI")], 3001);
    expect(sum(rows)).toBe(3001);
    expect(rows[1].amount).toBe(2000.45);
  });
});

/**
 * THE STAMP THE DAY CLOSE READS.
 *
 * A deposit is counted in the day close on the shift that TOOK it. At discharge
 * the same money is written again, as a payment against the final bill - so the
 * day close has to recognise that second write and skip it, or every deposit the
 * hospital ever took is counted twice and no drawer can be reconciled.
 */
describe("telling a deposit adjustment apart from money taken now", () => {
  it("recognises the reference the discharge stamps", () => {
    const ref = advancePaymentRef("JMH2026IP0007", "JMH2026ADV0012");
    expect(isAdvanceAdjustment(ref)).toBe(true);
  });

  it("recognises a pre-numbering advance, which carries no slip", () => {
    expect(isAdvanceAdjustment(advancePaymentRef("JMH2026IP0007"))).toBe(true);
  });

  it("leaves ordinary counter money alone", () => {
    // A UPI transaction id typed at the desk is NOT a deposit adjustment, and
    // treating one as such would hide real takings from the drawer count.
    expect(isAdvanceAdjustment("UPI 402919283746")).toBe(false);
    expect(isAdvanceAdjustment("Card auth 004512")).toBe(false);
    expect(isAdvanceAdjustment(null)).toBe(false);
    expect(isAdvanceAdjustment(undefined)).toBe(false);
    expect(isAdvanceAdjustment("")).toBe(false);
  });

  it("reads the slip number back out, so the bill can name it", () => {
    const ref = advancePaymentRef("JMH2026IP0007", "JMH2026ADV0012");
    expect(advanceReceiptNoFromRef(ref)).toBe("JMH2026ADV0012");
  });

  it("returns null rather than guessing when there is no slip", () => {
    expect(advanceReceiptNoFromRef(advancePaymentRef("JMH2026IP0007"))).toBeNull();
    expect(advanceReceiptNoFromRef("UPI 402919283746")).toBeNull();
    expect(advanceReceiptNoFromRef(null)).toBeNull();
  });

  it("still reads as English on the printed bill", () => {
    // This string is shown to a family, not only matched by code.
    expect(advancePaymentRef("JMH2026IP0007", "JMH2026ADV0012"))
      .toBe(`${ADVANCE_REF_PREFIX} (JMH2026IP0007 · JMH2026ADV0012)`);
  });

  it("ignores blank whitespace in a slip number rather than stamping it", () => {
    expect(advancePaymentRef("JMH2026IP0007", "   ")).toBe(`${ADVANCE_REF_PREFIX} (JMH2026IP0007)`);
  });
});
