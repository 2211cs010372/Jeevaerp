import { z } from "zod";
import { DISCHARGE_OUTCOMES } from "@/lib/admission-outcome";

const payment = z.object({
  mode: z.enum(["CASH", "UPI", "CARD", "NETBANKING", "OTHER"]),
  amount: z.coerce.number().min(0),
  reference: z.string().trim().max(80).optional(),
});

/** A split leg (part cash, part UPI). Each must be > ₹0. */
const paymentLeg = z.object({
  mode: z.enum(["CASH", "UPI", "CARD", "NETBANKING", "OTHER"]),
  amount: z.coerce.number().min(0.01),
  reference: z.string().trim().max(80).optional(),
});

export const wardSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2).max(60),
  category: z.string().trim().min(2).max(30),
  floor: z.string().trim().max(20).optional().or(z.literal("")),
  dailyCharge: z.coerce.number().min(0),
  gstRatePct: z.coerce.number().min(0).max(28),
  active: z.boolean().optional(),
});

export const addBedsSchema = z.object({
  wardId: z.string().trim().min(1),
  count: z.coerce.number().int().min(1).max(50),
  prefix: z.string().trim().max(8).optional().or(z.literal("")),
});

export const bedStatusSchema = z.object({
  bedId: z.string().trim().min(1),
  status: z.enum(["AVAILABLE", "MAINTENANCE"]),
});

export const admitSchema = z.object({
  patientDisplayId: z.string().trim().min(6, "Enter the patient's Jeeva ID"),
  bedId: z.string().trim().min(1, "Pick a bed from the board"),
  doctorId: z.string().trim().min(1, "Pick the attending doctor"),
  reason: z.string().trim().max(300).optional().or(z.literal("")),
  attendantName: z.string().trim().max(100).optional().or(z.literal("")),
  attendantPhone: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile").optional().or(z.literal("")),
  attendantRelation: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  /// Who settles the stay. Optional so every existing caller keeps admitting a
  /// self-paying patient without knowing the field exists.
  payerType: z.enum(["SELF_PAY", "INSURANCE"]).optional(),
  insurer: z.string().trim().max(80).optional().or(z.literal("")),
  /// Still ACCEPTED, no longer asked for at the bedside. The admit screen stopped
  /// collecting these - the insurance desk takes both from the family when it
  /// works the claim - but the fields stay optional here so any caller that does
  /// have them on hand can still pass them straight through to the stay.
  policyNo: z.string().trim().max(60).optional().or(z.literal("")),
  memberId: z.string().trim().max(60).optional().or(z.literal("")),
}).refine(
  // Checked here as well as in the service, so the desk gets the message on the
  // field rather than as a 400 after the bed has already been picked.
  (v) => v.payerType !== "INSURANCE" || !!v.insurer?.trim(),
  { message: "An insurance admission needs the insurer", path: ["insurer"] }
);

export const dischargeSchema = z.object({
  admissionId: z.string().trim().min(1),
  discountAmount: z.coerce.number().min(0).optional(),
  payment: payment.optional(),
  payments: z.array(paymentLeg).min(1).max(4).optional(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  /// Discharge with pharmacy/lab bills still unpaid. A deliberate act by the
  /// desk, recorded against their name - not a default.
  allowOutstanding: z.boolean().optional(),
  /// How the stay ended. Optional so every existing caller keeps working and
  /// still records an ordinary discharge; the desk has to choose to say otherwise.
  outcome: z.enum(DISCHARGE_OUTCOMES).optional(),
});

export const CHARGE_CATEGORIES = [
  "PROCEDURE", "DOCTOR_VISIT", "NURSING", "OXYGEN", "INVESTIGATION", "CONSUMABLE", "PHARMACY", "OTHER",
] as const;

export const addChargeSchema = z.object({
  category: z.enum(CHARGE_CATEGORIES),
  description: z.string().trim().min(2).max(160),
  qty: z.coerce.number().int().min(1).max(999),
  unitPrice: z.coerce.number().min(0),
  gstRatePct: z.coerce.number().min(0).max(28).optional(),
  /** Set after the "this charge was just added" warning - see addAdmissionCharge. */
  confirmRepeat: z.boolean().optional(),
});

/**
 * Repricing an existing line to a payer's tariff. Every field optional - the
 * insurance desk usually changes only the rate, and requiring the whole line
 * back would make a partial edit silently blank the rest.
 */
export const updateChargeSchema = z.object({
  category: z.enum(CHARGE_CATEGORIES).optional(),
  description: z.string().trim().min(2).max(160).optional(),
  qty: z.coerce.number().int().min(1).max(999).optional(),
  unitPrice: z.coerce.number().min(0).optional(),
  gstRatePct: z.coerce.number().min(0).max(28).optional(),
  /// WHEN THE SERVICE WAS GIVEN - the "Date & time" the printed tab shows
  /// against this line, not when somebody found a minute to key it in. A full
  /// INSTANT with an offset, like the stay's own dates: the tab prints the time
  /// and sorts by it, so two rounds on one day have to be tellable apart.
  /// Bounded by the stay itself in `resolveChargeDate`.
  chargedAt: z.string().trim().datetime({ offset: true }).optional(),
});

/**
 * ONE nursing / observation entry. Non-empty is enforced here rather than
 * silently storing a blank row: an empty note is not a record of anything, and
 * the append-only table has no way to tidy one away afterwards.
 */
export const admissionNoteSchema = z.object({
  body: z.string().trim().min(1, "Write something before saving the note").max(4000),
});

/** Moving a patient to another bed mid-stay. */
export const transferBedSchema = z.object({
  toBedId: z.string().trim().min(1, "Pick a bed"),
  reason: z.string().trim().max(200).optional(),
});

/**
 * CORRECTING WHAT A STAY IS PRICED ON - its dates, its bed rate, its nursing rate.
 *
 * Every field optional, like the reprice schema above and for the same reason: a
 * desk usually fixes one of these, and requiring the whole set back would make a
 * partial edit silently rewrite the rest.
 *
 * The dates are full INSTANTS, not calendar days. `stayDays` charges per started
 * day, so an admission at 23:40 and one at 00:10 the next morning are a day
 * apart on the bill - sending a date alone would quietly move money.
 *
 * The ceilings are deliberately generous rather than tight: a suite at ₹50,000 a
 * night is a real room in a real hospital, and a validator that refuses it sends
 * the desk back to typing an adjustment line. They exist to catch a rate typed
 * into the wrong box, not to price the ward.
 */
export const correctStaySchema = z.object({
  admittedAt: z.string().trim().datetime({ offset: true }).optional(),
  dischargedAt: z.string().trim().datetime({ offset: true }).optional(),
  nursePerDay: z.coerce.number().min(0).max(100_000).optional(),
  bedRate: z.coerce.number().min(0).max(1_000_000).optional(),
  legs: z.array(z.object({
    id: z.string().trim().min(1),
    dailyCharge: z.coerce.number().min(0).max(1_000_000),
    /// How many days this bed BILLS for, where that is not the nights the dates
    /// give it. Omit to leave the cap alone; null clears it back to the dates;
    /// a whole number caps it there. NULLABLE and OPTIONAL are different
    /// answers here, which is why this is not just `.optional()`.
    ///
    /// The 3,650 ceiling is ten years - long past any real stay, and there to
    /// catch a date typed into a day box rather than to price a ward. The real
    /// limit is the stay's own length, which only the service knows.
    billedDays: z.coerce.number().int().min(0).max(3_650).nullable().optional(),
  })).max(20).optional(),
  /// Why. Free text, kept on the stay's chronology with the figures - "the bill
  /// was changed after the treatment" is the first thing an insurer asks.
  reason: z.string().trim().max(200).optional().or(z.literal("")),
});

/** The deposit taken at admission. */
export const advanceSchema = z.object({
  amount: z.coerce.number().positive("An advance must be more than ₹0"),
  mode: z.enum(["CASH", "UPI", "CARD", "NETBANKING", "OTHER"]),
  reference: z.string().trim().max(80).optional(),
});
