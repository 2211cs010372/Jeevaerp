/**
 * WHEN A DISCHARGED INSURANCE STAY STILL OWES A FINAL CLAIM.
 *
 * This desk works the way the insurer does. A pre-authorisation is raised on an
 * ESTIMATE while the patient is still in the bed - "this hip replacement will
 * come to about ₹1,40,000" - and the insurer authorises against that. If the
 * stay lands inside the estimate, that authorisation is what settles it: there
 * is no second claim to send and nothing left for anybody to do.
 *
 * A FINAL CLAIM IS FOR THE STAY THAT WENT OVER. The theatre took longer, the
 * patient spent two more nights in ICU, the bill came to ₹1,60,000 - and the
 * difference has to be asked for, or the hospital simply does not get it.
 *
 * And for the stay NOBODY EVER GOT AUTHORISED, which is the expensive version of
 * the same mistake: a full bill that no insurer has been shown.
 *
 * ── WHY THIS IS A FILE AND NOT AN `if` ──
 *
 * The rule is asked in two places - the desk's worklist (`pendingWork`) and the
 * stay's own screen, which draws the "raise it" button. Written twice they drift,
 * and the way they drift is that one screen says a stay is finished while the
 * other keeps asking for a claim on it. Both call this.
 */

/**
 * A rupee, not zero.
 *
 * A bill is rounded per line and an authorisation is a figure typed by a human
 * off a TPA's letter; the two land a few paise apart often enough. A worklist
 * that demands a claim for being ₹0.40 over is a worklist people learn to
 * scroll past, and then it stops catching the ₹20,000 one.
 */
export const CLAIM_TOLERANCE = 1;

/**
 * ── WHICH OF THE TWO CLAIMS A STAY IS STILL MISSING ──
 *
 * A stay has exactly two claims in its life and the desk raises them at
 * different moments: the PRE-AUTH against an estimate while the patient is in
 * the bed, the FINAL against the bill once the stay is over. Two screens draw a
 * button for each - the stays list and the stay's own sheet - and the button has
 * to vanish the moment its claim exists, or the desk raises a second one and
 * nobody can afterwards say which of the two is live.
 *
 * A CLOSED CLAIM DOES NOT COUNT AS RAISED. That is the unused ₹0 draft somebody
 * tidied away, not a claim anybody sent - the same reading `needsFinalClaim`
 * takes of it.
 *
 * NEITHER DOES A REJECTED PRE-AUTH. A refusal authorises nothing (see
 * `authorisedAmount`, which returns null for exactly this reason) and the way
 * back from one is a fresh pre-auth, not a stay with no button on it.
 *
 * A REJECTED FINAL CLAIM IS DIFFERENT and stays counted: the stay's own screen
 * has a whole panel for that decision - re-submit it, or move the bills back to
 * the family - and a second "raise" button competing with that panel is how a
 * refused stay ends up with two claims and one argument.
 */
export interface StageClaim {
  stage: string;
  status: string;
}

/** The pre-auth standing on this stay, or null when the desk may raise one. */
export function openPreAuth<T extends StageClaim>(claims: readonly T[]): T | null {
  return claims.find((c) => c.stage === "PRE_AUTH" && c.status !== "CLOSED" && c.status !== "REJECTED") ?? null;
}

/** The final claim standing on this stay, or null when the desk may raise one. */
export function openFinalClaim<T extends StageClaim>(claims: readonly T[]): T | null {
  return claims.find((c) => c.stage === "FINAL" && c.status !== "CLOSED") ?? null;
}

/** The shape of a pre-auth claim, as much of it as this rule reads. */
export interface AuthorisingClaim {
  status: string;
  approvedAmount: string | number | null;
  settledAmount: string | number | null;
}

/**
 * What the insurer actually authorised on a stay, or null if it never answered
 * with a figure.
 *
 * A SETTLED claim with no approved amount counts: money in the bank is an
 * authorisation arrived at from the other end, and treating it as "never
 * authorised" would put a finished stay back on the worklist.
 *
 * REJECTED comes back null on purpose - a refusal authorises nothing, and that
 * stay belongs either on a fresh claim or on the family's bill.
 */
export function authorisedAmount(preAuth: AuthorisingClaim | null | undefined): number | null {
  if (!preAuth) return null;
  if (preAuth.approvedAmount != null) return Number(preAuth.approvedAmount);
  if (preAuth.status === "SETTLED" && preAuth.settledAmount != null) return Number(preAuth.settledAmount);
  return null;
}

export interface FinalClaimCheck {
  /** Every bill on the stay still pointed at the insurer, added up. */
  billedToInsurer: number;
  /** From `authorisedAmount` above. Null when the insurer never gave a figure. */
  authorised: number | null;
  /** The FINAL-stage claim's status, or null when none has been raised. */
  finalClaimStatus: string | null;
}

/** How far past the authorisation the stay landed. Null when nothing was authorised. */
export function excessOver(billedToInsurer: number, authorised: number | null): number | null {
  return authorised === null ? null : Math.max(0, billedToInsurer - authorised);
}

export function needsFinalClaim({ billedToInsurer, authorised, finalClaimStatus }: FinalClaimCheck): boolean {
  // Already with the insurer, or already decided. A DRAFT is not with anybody -
  // it is a form somebody started and left, which is exactly what the worklist
  // exists to chase.
  if (finalClaimStatus && finalClaimStatus !== "DRAFT") return false;

  // Nothing points at the insurer any more. This is the refused claim that was
  // reverted to the family: the money is now the patient's to pay and asking an
  // insurer for ₹0 is not work.
  if (billedToInsurer <= 0) return false;

  if (authorised === null) return true;
  return billedToInsurer - authorised > CLAIM_TOLERANCE;
}
