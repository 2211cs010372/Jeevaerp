/**
 * NO PAISE ON A BILL - the owner's rule, 29 Sep 2026.
 *
 * 1. A bill's total is a whole number of rupees: the nearest rupee, and an
 *    exact 50 paise goes DOWN (102.40 -> 102, 102.50 -> 102, 102.60 -> 103).
 *    The tax lines keep their exact paise - GST is computed on the taxable
 *    value, not on the rounded total - and the difference prints as a
 *    "Round off" line, which is how an Indian tax invoice squares it.
 *
 * 2. A balance under one rupee is not a debt. 254 bills were left "part paid"
 *    over a paisa or two before this rule (Rs 2.55 in all), and one of them kept
 *    a paid stay's IP bill showing "Rs 0.02 payable". Anything under Rs 1 now
 *    reads - and settles - as nothing due. No bill or payment is edited for it.
 *
 * Pure and dependency-free: the server's invoice maths and every counter's
 * on-screen total use the same functions, so the amount a payment box asks for
 * is exactly the amount the server will accept.
 */

/** Balances below this many rupees count as settled. */
export const SETTLED_BELOW = 1;

/** Nearest whole rupee; exactly 50 paise rounds down. */
export function roundBill(amount: number): number {
  // In integer paise, so 0.1 + 0.2 style float noise can't tip a boundary.
  const paise = Math.round(amount * 100);
  const rupees = Math.floor(paise / 100);
  const rest = paise - rupees * 100;
  return rest > 50 ? rupees + 1 : rupees;
}

/** Whether a remaining balance is small enough to be nothing. */
export const isSettled = (due: number) => due < SETTLED_BELOW;

/** What is actually owed: a balance under Rs 1 is Rs 0. */
export const owed = (due: number) => (due < SETTLED_BELOW ? 0 : due);
