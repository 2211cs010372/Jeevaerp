/**
 * THE STAMP THAT TELLS A DEPOSIT APART FROM MONEY TAKEN AT THE COUNTER.
 *
 * An IPD advance is money the hospital already holds when the discharge bill is
 * raised. At discharge it is recorded against that bill as a payment - which is
 * correct for the bill, and a lie to the day close if nothing marks it, because
 * the drawer never saw that money on discharge day. It saw it days earlier, on
 * whichever shift took the deposit.
 *
 * So every advance-adjusting payment carries this reference, and two readers
 * depend on it:
 *
 *   - the printed bill, to show "less advance -> balance" instead of folding a
 *     deposit invisibly into one "Paid" figure;
 *   - the day close, to LEAVE IT OUT, because `dayClose` counts the advance on
 *     the day the deposit was actually taken.
 *
 * One prefix, written and matched in one place, so those two can never drift.
 *
 * Deliberately free of Prisma so both the billing service and the reports
 * service can import it, and so the rule can be tested without a database.
 *
 * KNOWN LIMIT: `Payment.reference` is also where a receptionist types a UPI
 * transaction id, so this is a convention rather than a constraint. The exact
 * fix is a nullable `Payment.advanceId` foreign key onto AdmissionAdvance; until
 * that migration exists, every reader must go through the predicates below
 * rather than matching the string themselves.
 */

export const ADVANCE_REF_PREFIX = "Advance taken at admission";

/** Separates the stay from the deposit slip inside the reference. */
const PART_SEP = " · ";

/**
 * The reference stamped on the payment that adjusts ONE advance against a bill.
 *
 * `receiptNo` is optional only because advances taken before receipts existed
 * have none (see AdmissionAdvance.receiptNo). Every new advance passes one, and
 * that is what lets the bill print a line per deposit rather than one merged
 * figure the family cannot tie back to the slips in their bag.
 */
export function advancePaymentRef(ipNumber: string, receiptNo?: string | null): string {
  const slip = receiptNo?.trim();
  return slip
    ? `${ADVANCE_REF_PREFIX} (${ipNumber}${PART_SEP}${slip})`
    : `${ADVANCE_REF_PREFIX} (${ipNumber})`;
}

/**
 * Is this payment the adjustment of a deposit, rather than money taken now?
 *
 * The day close asks this of every payment it finds. A `true` means the money
 * was already counted on the day the deposit was taken, so counting it again
 * here would put cash in a drawer that never received it.
 */
export function isAdvanceAdjustment(reference: string | null | undefined): boolean {
  return typeof reference === "string" && reference.startsWith(ADVANCE_REF_PREFIX);
}

/**
 * The deposit slip number behind an adjustment, or null.
 *
 * Null for a pre-receipt advance and for anything that is not an adjustment at
 * all - callers print the generic "Less: Advance" line in that case rather than
 * inventing a number.
 */
export function advanceReceiptNoFromRef(reference: string | null | undefined): string | null {
  if (!isAdvanceAdjustment(reference)) return null;
  const inside = /\(([^)]*)\)\s*$/.exec(reference as string);
  if (!inside) return null;
  const parts = inside[1].split(PART_SEP);
  const slip = parts.length > 1 ? parts[parts.length - 1].trim() : "";
  return slip || null;
}

// ---------------------------------------------------------------------------
// HOW A STAY'S DEPOSITS MEET ITS FINAL BILL
// ---------------------------------------------------------------------------

/** Rounding, duplicated from calc.ts rather than imported: this module stays
 *  dependency-free so both services and a test can take it without Prisma. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface AdvanceDeposit {
  amount: number;
  mode: string;
  /** The slip handed to the family. Null only for pre-numbering rows. */
  receiptNo?: string | null;
}

export interface AdvanceApplication {
  mode: string;
  amount: number;
  receiptNo: string | null;
}

/**
 * Turn the deposits held against a stay into the payments to record on its bill.
 *
 * ONE PAYMENT PER DEPOSIT SLIP. An earlier version summed the lot into a single
 * payment carrying the FIRST deposit's mode: ₹3,000 cash + ₹5,000 UPI became
 * ₹8,000 of CASH, against a drawer that had only ever seen ₹3,000. Grouping by
 * mode fixed the mode and left the family's side wrong - they hold two numbered
 * receipts and the bill showed one merged line matching neither. Applying each
 * deposit on its own fixes both at once, since a deposit only ever had one mode.
 *
 * CAPPED AT WHAT IS STILL OWED. recordPayment rejects a tender beyond the
 * balance, and one rejection throws the whole discharge - which would leave the
 * bill showing full value against money the hospital is already holding.
 *
 * OLDEST FIRST, so that when the deposits exceed the bill the money left over
 * is the most RECENT one. That is the deposit the family remembers making, and
 * the one they will ask about at the refund counter.
 *
 * @param deposits  oldest first
 * @param outstanding  what the bill still wants, in rupees
 */
export interface DepositSnapshot {
  id: string;
  amount: number;
  /** Epoch millis. Ties are broken by id so the order is total and stable. */
  takenAt: number;
}

/**
 * WHAT THE HOSPITAL HELD AT THE MOMENT ONE RECEIPT WAS WRITTEN.
 *
 * A receipt is a record of a transaction at a point in time, so reprinting it a
 * week later must produce the same piece of paper. That failed: the slip summed
 * EVERY deposit on the stay, whenever taken, so a family that paid ₹8,000 and
 * later ₹20,000 held two slips both headlining ₹28,000 - and the ₹8,000 slip
 * described the ₹20,000 as "held earlier", which it was not.
 *
 * Ordered by when the money was taken, and stopped at this receipt. Deposits
 * made afterwards belong to their own slips and to no earlier one.
 *
 * `total` is `prior` plus this receipt. Both are returned rather than derived by
 * the caller, because the subtraction that derived one from the other is exactly
 * where the original bug lived.
 *
 * An unknown id yields zeroes rather than the whole stay: a receipt that cannot
 * be located must not silently print somebody else's running total.
 */
export function heldAsOf(
  deposits: DepositSnapshot[],
  receiptId: string,
): { prior: number; total: number } {
  const ordered = [...deposits].sort(
    (a, b) => a.takenAt - b.takenAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const at = ordered.findIndex((d) => d.id === receiptId);
  if (at < 0) return { prior: 0, total: 0 };

  const prior = ordered.slice(0, at).reduce((s, d) => r2(s + d.amount), 0);
  return { prior: r2(prior), total: r2(prior + ordered[at].amount) };
}

/**
 * MONEY THE COUNTER TOOK AGAINST A STAY'S OWN BILL - its payments net of
 * refunds, with every carried-over deposit left out.
 *
 * The discharge records each deposit as a payment on the stay's invoice, so
 * that invoice's paid figure is the deposits PLUS whatever the family handed
 * over at the desk. A sheet that already subtracts the deposits on their own
 * line must take only the second part from here, or the deposit comes off the
 * bill twice. Floored at zero: a refund of deposit money is not negative cash.
 */
export function takenOnStayBill(
  payments: { amount: number; reference?: string | null }[],
  refunds: { amount: number }[] = [],
): number {
  const taken = payments
    .filter((p) => !isAdvanceAdjustment(p.reference))
    .reduce((s, p) => r2(s + p.amount), 0);
  const back = refunds.reduce((s, x) => r2(s + x.amount), 0);
  return Math.max(0, r2(taken - back));
}

/**
 * WHAT ONE DEPOSIT'S ADJUSTMENT MUST COME TO AFTER THE DEPOSIT IS CORRECTED.
 *
 * A deposit on a DISCHARGED stay is already sitting on the stay's bill as a
 * payment (see applyAdvances). Correct the slip from ₹20,000 to ₹10,000 and
 * that payment is now a claim that ₹20,000 was held - the bill reads as settled
 * on money the hospital does not have. So the adjustment is recomputed from the
 * corrected figure, against what the bill still has room for.
 *
 * `otherPaid` is every rupee on that bill EXCEPT this deposit's own adjustment,
 * net of refunds. Passed in rather than derived here so this stays arithmetic:
 * the caller is the one that knows which Payment row belongs to which slip.
 *
 * CAPPED AT THE BILL, never above it, exactly as the discharge caps it: a
 * ₹50,000 deposit on a ₹30,000 bill applies ₹30,000 and the remaining ₹20,000
 * stays refundable - which is what `unapplied` says, and what the refund
 * counter hands back.
 */
export function planAdvanceApplication(opts: {
  /** The deposit's corrected amount. */
  amount: number;
  /** The stay bill's total. Zero when the stay has no bill yet. */
  billTotal: number;
  /** Net money on that bill that is not this deposit. */
  otherPaid: number;
}): { apply: number; unapplied: number } {
  const amount = r2(Math.max(0, opts.amount));
  const room = r2(Math.max(0, opts.billTotal - Math.max(0, opts.otherPaid)));
  const apply = r2(Math.min(amount, room));
  return { apply, unapplied: r2(amount - apply) };
}

export function applyAdvances(
  deposits: AdvanceDeposit[],
  outstanding: number,
): AdvanceApplication[] {
  const out: AdvanceApplication[] = [];
  let left = r2(Math.max(0, outstanding));

  for (const d of deposits) {
    if (left <= 0) break;
    const toApply = r2(Math.min(d.amount, left));
    // A zero or negative deposit is not a payment. Skipped rather than recorded,
    // so a stray row cannot put an empty tender on a tax invoice.
    if (toApply <= 0) continue;
    out.push({ mode: d.mode, amount: toApply, receiptNo: d.receiptNo ?? null });
    left = r2(left - toApply);
  }
  return out;
}
