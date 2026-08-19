import { describe, it, expect } from "vitest";

/**
 * MULTIPLE ADVANCES, AND THE DRAWER THAT HAS TO RECONCILE.
 *
 * A family deposits more than once - cash at admission, UPI two days later when
 * the bill grows. At discharge those deposits are applied to the stay's
 * invoice, and how they are applied decides whether the day close balances.
 *
 * The bug this locks shut: every deposit was collapsed into ONE payment row
 * carrying the FIRST deposit's mode. Rs 3,000 cash + Rs 5,000 UPI became a
 * single Rs 8,000 CASH payment, and the day close then showed Rs 8,000 of cash
 * in a drawer that had only ever taken Rs 3,000. billing.service states the
 * rule directly - tender modes are preserved exactly, because a mode invented
 * anywhere breaks the reconciliation.
 *
 * The grouping is pure arithmetic, so it is tested as such: the service call
 * around it needs a database, but this is the part that was wrong.
 */

type Mode = "CASH" | "UPI" | "CARD";

/** The apportionment inside discharge(): group by mode, apply oldest first. */
function applyAdvances(
  advances: { amount: number; mode: Mode }[],
  outstanding: number,
): { mode: Mode; amount: number }[] {
  const byMode = new Map<Mode, number>();
  for (const a of advances) byMode.set(a.mode, (byMode.get(a.mode) ?? 0) + a.amount);

  const out: { mode: Mode; amount: number }[] = [];
  let left = outstanding;
  for (const [mode, amount] of byMode) {
    if (left <= 0) break;
    const toApply = Math.min(amount, left);
    if (toApply <= 0) continue;
    out.push({ mode, amount: toApply });
    left -= toApply;
  }
  return out;
}

const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);

describe("applying several advances to the discharge bill", () => {
  it("keeps cash as cash and UPI as UPI", () => {
    const rows = applyAdvances(
      [{ amount: 3000, mode: "CASH" }, { amount: 5000, mode: "UPI" }],
      20000,
    );
    expect(rows).toEqual([{ mode: "CASH", amount: 3000 }, { mode: "UPI", amount: 5000 }]);
  });

  it("adds up deposits made in the SAME mode into one row", () => {
    // Three cash deposits are three receipts to the family and one number to
    // the drawer - splitting them into three payment rows would be noise.
    const rows = applyAdvances(
      [{ amount: 1000, mode: "CASH" }, { amount: 2000, mode: "CASH" }, { amount: 500, mode: "UPI" }],
      20000,
    );
    expect(rows).toEqual([{ mode: "CASH", amount: 3000 }, { mode: "UPI", amount: 500 }]);
  });

  it("applies the whole advance when the bill is larger", () => {
    const advances = [{ amount: 3000, mode: "CASH" as Mode }, { amount: 5000, mode: "UPI" as Mode }];
    expect(sum(applyAdvances(advances, 20000))).toBe(8000);
  });

  it("never applies more than is owed - the rest stays refundable", () => {
    // Rs 8,000 held against a Rs 6,000 bill. Applying the lot would be rejected
    // as a tender beyond the balance and would throw the whole discharge.
    const rows = applyAdvances(
      [{ amount: 3000, mode: "CASH" }, { amount: 5000, mode: "UPI" }],
      6000,
    );
    expect(sum(rows)).toBe(6000);
    // Oldest first: the cash went in first, so the UPI is what is left over -
    // the deposit the family made most recently and will ask about.
    expect(rows).toEqual([{ mode: "CASH", amount: 3000 }, { mode: "UPI", amount: 3000 }]);
  });

  it("applies nothing to a bill already settled", () => {
    expect(applyAdvances([{ amount: 3000, mode: "CASH" }], 0)).toEqual([]);
  });

  it("stops cleanly when the balance runs out mid-list", () => {
    const rows = applyAdvances(
      [{ amount: 3000, mode: "CASH" }, { amount: 5000, mode: "UPI" }, { amount: 2000, mode: "CARD" }],
      3000,
    );
    expect(rows).toEqual([{ mode: "CASH", amount: 3000 }]);
    expect(sum(rows)).toBe(3000);
  });

  it("what the drawer sees always equals what was applied", () => {
    for (const bill of [0, 500, 3000, 7999, 8000, 12000]) {
      const rows = applyAdvances(
        [{ amount: 3000, mode: "CASH" }, { amount: 5000, mode: "UPI" }],
        bill,
      );
      expect(sum(rows), `bill ${bill}`).toBe(Math.min(8000, bill));
    }
  });
});
