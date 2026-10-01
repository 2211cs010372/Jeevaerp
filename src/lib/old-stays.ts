/**
 * OLD STAYS - the offline-record period (owner, 1 Oct 2026).
 *
 * Stays discharged before this day were run on paper and are being keyed in
 * after the fact; their money was settled at the time, offline. So a forgotten
 * bill added to one of them must never leave a due behind: it is always
 * recorded as paid in full (see settleOldStayBill in ipd.service).
 *
 * Stays discharged on or after this day behave normally - a forgotten bill
 * may be left due and collected at Billing.
 *
 * A day in the hospital's calendar (IST), compared as "YYYY-MM-DD".
 */
export const OLD_STAY_DISCHARGED_BEFORE = "2026-10-01";

/** True for a stay discharged before the cutoff. A stay still in the bed is never old. */
export function isOldStay(dischargedAt: Date | string | null | undefined): boolean {
  if (!dischargedAt) return false;
  const d = typeof dischargedAt === "string" ? new Date(dischargedAt) : dischargedAt;
  if (Number.isNaN(d.getTime())) return false;
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) < OLD_STAY_DISCHARGED_BEFORE;
}
