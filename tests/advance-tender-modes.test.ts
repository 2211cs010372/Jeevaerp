import { describe, it, expect } from "vitest";
import {
  applyAdvances,
  advancePaymentRef,
  isAdvanceAdjustment,
  advanceReceiptNoFromRef,
  heldAsOf,
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

/**
 * WHAT ONE SLIP SAYS, WHEN THERE ARE SEVERAL.
 *
 * A family paid Rs 8,000, then Rs 20,000 two days later. Both printed receipts
 * headlined Rs 28,000 - the stay's whole deposit - so neither slip's total
 * matched the money handed over for it, and the Rs 8,000 slip described the
 * Rs 20,000 as "held earlier" when it had not been paid yet.
 *
 * The cause was one query with no date filter, summing every deposit on the
 * stay whenever it was taken, which also meant REPRINTING a slip changed it. A
 * receipt is a record of one moment; the paper must not move afterwards.
 */
describe("what was held when a receipt was written", () => {
  const D = (id: string, amount: number, day: number) =>
    ({ id, amount, takenAt: Date.UTC(2026, 7, day) });

  // The real case, from JMH2026IP0007.
  const first = D("a", 8000, 1);
  const second = D("b", 20000, 3);
  const stay = [first, second];

  it("the FIRST slip knows nothing about a deposit made later", () => {
    // The bug, stated: this used to return 28,000 and call 20,000 "earlier".
    expect(heldAsOf(stay, "a")).toEqual({ prior: 0, total: 8000 });
  });

  it("the SECOND slip counts the first one, and only the first", () => {
    expect(heldAsOf(stay, "b")).toEqual({ prior: 8000, total: 28000 });
  });

  it("reprinting a slip gives back the same paper, whatever came after", () => {
    // Print the first slip on day 1, reprint it after the second deposit: the
    // family must be handed the same document, not a bigger number.
    expect(heldAsOf([first], "a")).toEqual(heldAsOf(stay, "a"));
  });

  it("does not care what order the rows arrive in", () => {
    expect(heldAsOf([second, first], "b")).toEqual({ prior: 8000, total: 28000 });
  });

  it("orders two deposits taken in the same instant, stably", () => {
    // Same timestamp is a real case - two slips written in one minute. The tie
    // breaks on id so the pair always agree with each other about who is first.
    const x = { id: "x", amount: 500, takenAt: 1000 };
    const y = { id: "y", amount: 700, takenAt: 1000 };
    expect(heldAsOf([x, y], "x")).toEqual({ prior: 0, total: 500 });
    expect(heldAsOf([y, x], "y")).toEqual({ prior: 500, total: 1200 });
  });

  it("a single deposit totals itself and nothing else", () => {
    expect(heldAsOf([first], "a")).toEqual({ prior: 0, total: 8000 });
  });

  it("returns zeroes for a receipt that is not on this stay", () => {
    // Never someone else's running total on a slip we cannot place.
    expect(heldAsOf(stay, "missing")).toEqual({ prior: 0, total: 0 });
    expect(heldAsOf([], "a")).toEqual({ prior: 0, total: 0 });
  });

  it("adds three deposits to the paisa", () => {
    const rows = [D("a", 1000.55, 1), D("b", 2000.45, 2), D("c", 3000.33, 3)];
    expect(heldAsOf(rows, "c")).toEqual({ prior: 3001, total: 6001.33 });
  });
});
