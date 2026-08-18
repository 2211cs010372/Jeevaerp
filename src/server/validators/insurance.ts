import { z } from "zod";

/** Raise a new claim against a patient's treatment. */
export const createClaimSchema = z.object({
  patientId: z.string().trim().min(1, "Pick a patient"),
  insurer: z.string().trim().min(1, "Insurer / TPA is required").max(120),
  policyNo: z.string().trim().min(1, "Policy number is required").max(60),
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
  /// claimed amount (AMOUNT), approved amount (APPROVE) or amount received (SETTLE)
  amount: z.coerce.number().min(0).optional(),
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
