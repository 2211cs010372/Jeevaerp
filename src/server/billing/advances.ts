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
