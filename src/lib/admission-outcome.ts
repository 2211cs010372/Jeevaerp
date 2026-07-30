/**
 * How a stay ended, in one place.
 *
 * Before this, "the stay is over" was spelled `status === "DISCHARGED"` in some
 * files and `status !== "ADMITTED"` in others. Both read as correct and only one
 * survived adding LAMA, ABSCONDED, TRANSFERRED_OUT and EXPIRED: the DISCHARGED
 * spelling silently dropped four kinds of closed stay out of every list and count
 * that used it.
 *
 * So the vocabulary lives here and the checks are named. A future outcome is then
 * one line in CLOSED_STATUSES rather than a hunt through the codebase for
 * whichever spelling each author happened to pick.
 */

/**
 * The ways a stay can END, and the single source of truth for this module.
 *
 * Declared as the tuple rather than derived by filtering the full list, because
 * `z.enum` needs a non-empty tuple type and `.filter()` returns a plain array.
 * Deriving in this direction means the validator, the Prisma `in` clause and the
 * UI picker all read the same one list, and adding an outcome is one line here.
 */
export const CLOSED_STATUSES = [
  "DISCHARGED",
  "LAMA",
  "ABSCONDED",
  "TRANSFERRED_OUT",
  "EXPIRED",
] as const;

/** Every status a stay can hold: the one open state, then the closed ones. */
export const ADMISSION_STATUSES = ["ADMITTED", ...CLOSED_STATUSES] as const;

export type AdmissionStatusValue = (typeof ADMISSION_STATUSES)[number];

/** The outcomes the desk may choose when closing a stay. */
export const DISCHARGE_OUTCOMES = CLOSED_STATUSES;
export type DischargeOutcome = (typeof DISCHARGE_OUTCOMES)[number];

/** Mutable copy for query builders whose types reject a readonly array. */
export const CLOSED_STATUS_LIST: DischargeOutcome[] = [...CLOSED_STATUSES];

/** Is this stay still live: occupying a bed, accruing charges, editable? */
export function isOpen(status: string): boolean {
  return status === "ADMITTED";
}

/** Is this stay finished, however it finished? */
export function isClosed(status: string): boolean {
  return !isOpen(status);
}

/**
 * What a person should see. Deliberately the words the ward uses, not the enum:
 * a relative reading a printed summary should not meet the token TRANSFERRED_OUT.
 */
export const OUTCOME_LABEL: Record<AdmissionStatusValue, string> = {
  ADMITTED: "Admitted",
  DISCHARGED: "Discharged",
  LAMA: "Left against medical advice",
  ABSCONDED: "Absconded",
  TRANSFERRED_OUT: "Transferred out",
  EXPIRED: "Expired",
};

/** The short form, for a list column or a chip where the full phrase will not fit. */
export const OUTCOME_SHORT: Record<AdmissionStatusValue, string> = {
  ADMITTED: "Admitted",
  DISCHARGED: "Discharged",
  LAMA: "LAMA",
  ABSCONDED: "Absconded",
  TRANSFERRED_OUT: "Transferred",
  EXPIRED: "Expired",
};

/**
 * The line the desk reads before committing an outcome, and the reason each one
 * exists as a separate value rather than being folded into DISCHARGED.
 */
export const OUTCOME_HELP: Record<DischargeOutcome, string> = {
  DISCHARGED: "Discharged on medical advice. The ordinary ending.",
  LAMA: "Left against medical advice, having signed the form.",
  ABSCONDED: "Left without signing and without telling the ward. Not the same as LAMA - no consent was obtained.",
  TRANSFERRED_OUT: "Referred on to another hospital mid-stay.",
  EXPIRED: "Died during the stay.",
};

/**
 * Should closing the stay this way still produce a final bill?
 *
 * Yes for every outcome, and that is a deliberate answer rather than an oversight.
 * The bed was occupied and the medicines were given whatever the ending was, so
 * the charges are real; a death or an abscond that produced no invoice would leave
 * the stay unaccounted for in the day close and unreconcilable later. Whether the
 * hospital chooses to COLLECT on it is a separate decision the desk makes with the
 * discount and the outstanding-dues override.
 */
export function producesFinalBill(_outcome: DischargeOutcome): boolean {
  return true;
}
