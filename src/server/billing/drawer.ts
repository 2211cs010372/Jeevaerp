import { isAdvanceAdjustment } from "./advances";

/**
 * WHAT SHOULD BE IN THE DRAWER, PER TENDER TYPE.
 *
 * The arithmetic behind a day close, lifted out of the query that feeds it so
 * it can be checked without a database. Three streams meet here and each one
 * has been wrong at least once:
 *
 *   + payments   money taken against a bill on this shift
 *   + advances   IPD deposits taken on this shift, which have no bill yet
 *   − refunds    money physically handed back on this shift
 *
 * The two rules that are easy to get wrong, and are the whole point of this
 * function:
 *
 * A DEPOSIT COUNTS ON THE DAY IT WAS TAKEN. It is money across a counter like
 * any other. Leaving it out - which is what reading only the payment table
 * does - leaves the shift that took ₹3,000 in cash closing its day showing
 * nothing, and over by exactly that much.
 *
 * AND IT COUNTS EXACTLY ONCE. At discharge the same deposit is written again as
 * a payment against the final bill, days later and usually by someone else. That
 * second write is skipped here, or every deposit the hospital ever took is
 * counted twice: once on the shift that held out its hand, once on the shift
 * that closed the file.
 *
 * Refunds are netted per mode, never pooled. A ₹5,000 UPI refund does not empty
 * the cash box, and treating it as though it did is how a receptionist ends up
 * being asked to explain a shortfall that never happened.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface TenderRow { mode: string; amount: number; reference?: string | null }
export interface DepositRow { mode: string; amount: number }

export interface DrawerTotal {
  mode: string;
  collected: number;
  refunded: number;
  /** collected − refunded. For CASH, this is what should be in the drawer. */
  net: number;
  /** Tenders, not bills - a split payment is two, and so is a second deposit. */
  count: number;
}

/**
 * @param modes  every tender type to report, in order. Reported even when the
 *               day saw none of it: a missing row reads as a bug, a zero row
 *               reads as a quiet day, and those are different facts.
 */
export function foldDrawer(
  modes: readonly string[],
  input: {
    payments: TenderRow[];
    /** IPD deposits taken during the window, by whoever's till this is. */
    advances: DepositRow[];
    refunds: DepositRow[];
  },
): DrawerTotal[] {
  // Dropped before anything is added up, so no branch below has to remember.
  const taken = input.payments.filter((p) => !isAdvanceAdjustment(p.reference));

  return modes.map((mode) => {
    const paidIn = taken.filter((p) => p.mode === mode);
    const deposits = input.advances.filter((a) => a.mode === mode);
    const back = input.refunds.filter((x) => x.mode === mode);

    const collected = r2(
      paidIn.reduce((s, p) => r2(s + p.amount), 0) +
      deposits.reduce((s, a) => r2(s + a.amount), 0)
    );
    const refunded = r2(back.reduce((s, x) => r2(s + x.amount), 0));

    return {
      mode,
      collected,
      refunded,
      net: r2(collected - refunded),
      count: paidIn.length + deposits.length,
    };
  });
}

/**
 * The single number a receptionist counts the drawer against.
 *
 * Cash only - a day that banked ₹1.6L by transfer did not put a rupee in the
 * box, and a reconciliation that says otherwise gets ignored within a week.
 */
export function cashInHandOf(totals: DrawerTotal[]): number {
  return totals.find((m) => m.mode === "CASH")?.net ?? 0;
}
