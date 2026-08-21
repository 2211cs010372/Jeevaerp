import { z } from "zod";

/** Raise a new claim against a patient's treatment. */
export const createClaimSchema = z.object({
  patientId: z.string().trim().min(1, "Pick a patient"),
  insurer: z.string().trim().min(1, "Insurer / TPA is required").max(120),
  /**
   * OPTIONAL, AND STORED EMPTY WHEN NOBODY HAS IT YET.
   *
   * Reception stopped asking for a policy number at admission - the family
   * turns up with a card the desk photographs later - so the draft pre-auth
   * every insurance stay opens already carries "" and waits to be filled in.
   * This schema still demanded one, which made the ONE claim a human raises by
   * hand the only claim in the system that could not exist without it. The desk
   * either sat on the claim until the card arrived, or typed something to get
   * past the form - and an invented policy number on a document that goes to a
   * TPA is worse than a blank one.
   *
   * `setStayPolicySchema` below is how it gets recorded afterwards.
   */
  policyNo: z.string().trim().max(60).optional(),
  memberId: z.string().trim().max(60).optional(),
  sumInsured: z.coerce.number().min(0).optional(),
  type: z.enum(["CASHLESS", "REIMBURSEMENT"]).default("CASHLESS"),
  stage: z.enum(["PRE_AUTH", "FINAL"]).default("PRE_AUTH"),
  diagnosis: z.string().trim().max(300).optional(),
  claimedAmount: z.coerce.number().min(1, "Enter the amount claimed"),
  admissionId: z.string().trim().optional(),
  invoiceId: z.string().trim().optional(),
  remarks: z.string().trim().max(500).optional(),
});

/**
 * THE POLICY NUMBER NOBODY TOOK AT ADMISSION.
 *
 * A cashless stay is admitted on a card the family is still looking for, and
 * reception is not going to hold up a bed for it. So the stay runs with a blank
 * policy number and the insurance desk is the one who ends up with the card -
 * but there was nowhere to put the number once they had it. `claimActionSchema`
 * moves a claim's STATUS and its AMOUNTS and nothing else, so the desk's only
 * way to attach a policy number to a stay was to raise a whole new claim.
 *
 * Empty string CLEARS it. That is deliberate: a number typed against the wrong
 * stay has to be removable, and a field that can only ever be filled in is one
 * people work around by putting "-" in it.
 */
export const setStayPolicySchema = z.object({
  policyNo: z.string().trim().max(60),
});

/**
 * THE INSURER LIST THE HOSPITAL KEEPS ITSELF.
 *
 * `kind` groups the manage screen and nothing else - every suggestion box reads
 * one flat array of names - so it defaults rather than being demanded of
 * somebody who only wants to type a TPA in and get back to work.
 */
export const addInsurerSchema = z.object({
  name: z.string().trim().min(2, "Type the insurer or TPA name").max(120),
  kind: z.enum(["COMPANY", "PUBLIC_SECTOR", "TPA", "SCHEME"]).default("COMPANY"),
});

/**
 * Switch one on or off, addressed BY NAME.
 *
 * Not by id, because half this list has no row: the names that ship with the app
 * exist only in source until somebody hides one, and that act is what writes the
 * row. See setInsurerActive.
 */
export const setInsurerActiveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean(),
  kind: z.enum(["COMPANY", "PUBLIC_SECTOR", "TPA", "SCHEME"]).optional(),
});

/** Move a claim along its lifecycle. */
export const claimActionSchema = z.object({
  /**
   * AMOUNT sets what is being CLAIMED, and it exists because nothing could.
   *
   * claimedAmount was written once, by createClaim, and never again - so the
   * ₹0 draft every insurance admission opens automatically could never be
   * given a figure. The desk's only way forward was to raise a SECOND claim,
   * which is how one stay ends up with a real claim and a blank one and nobody
   * can tell which is live. A pre-auth that cannot be filled in is not a
   * pre-auth; it is a reminder that rots.
   */
  action: z.enum(["AMOUNT", "SUBMIT", "QUERY", "APPROVE", "REJECT", "SETTLE", "NOTE"]),
  /// claimed amount (AMOUNT), amount SANCTIONED (APPROVE) or amount received
  /// (SETTLE). On APPROVE this is what the letter sanctions BEFORE the co-pay
  /// below comes off it - the claim stores the insurer's net share.
  amount: z.coerce.number().min(0).optional(),
  /**
   * THE POLICY'S CO-PAY, on APPROVE only.
   *
   * Either form, or neither. Give the percentage the letter quotes and the
   * rupees are worked out; give the rupees and they are taken as stated, which
   * is what a desk holding the letter needs when the TPA has rounded its own
   * way. Absent means no co-pay on this claim, which is what every claim
   * recorded before this field existed means.
   */
  copayPct: z.coerce.number().min(0).max(100).optional(),
  copayAmount: z.coerce.number().min(0).optional(),
  insurerRef: z.string().trim().max(80).optional(),
  detail: z.string().trim().max(500).optional(),
});

/**
 * Moving a stay's bills off the insurer and onto the patient.
 *
 * The reason is mandatory. A family told their treatment was cashless is about
 * to be handed a bill, and "the insurer refused, ref XYZ" is the only thing that
 * makes that conversation possible - months later it is the only record of why.
 *
 * `invoiceIds` narrows it to some of the bills, for a partial approval where the
 * insurer covers the ward but not the pharmacy. Omitted, every insurance bill on
 * the stay moves.
 */
export const revertToSelfPaySchema = z.object({
  invoiceIds: z.array(z.string().trim().min(1)).optional(),
  reason: z.string().trim().min(3, "Say why this is going back to the patient").max(300),
  /**
   * The insurer refused the STAY, not one bill - so the admission itself becomes
   * self-pay. Only ever sent with a whole-stay revert; a partial one moves the
   * bills it names and leaves the stay on the policy.
   */
  convertStay: z.boolean().optional(),
});

/**
 * Correcting the date a bill carries, before the claim goes to the insurer.
 *
 * Date only, no time - the time of day on a corrected bill is noise, and letting
 * it be set invites somebody to make a bill look like it was raised at a
 * particular hour. See redateBill for what it refuses to touch.
 */
export const redateBillSchema = z.object({
  invoiceId: z.string().trim().min(1),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  reason: z.string().trim().max(200).optional(),
});
