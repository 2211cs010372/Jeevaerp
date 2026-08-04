import { z } from "zod";
import { isIndianMobile, toE164 } from "@/lib/phone";

/** One measured line. `value` stays a string so "Negative" and "<0.5" survive. */
export const saveLabResultsSchema = z.object({
  items: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    unit: z.string().trim().max(30).nullish(),
    value: z.string().trim().min(1).max(120),
    refLow: z.coerce.number().nullish(),
    refHigh: z.coerce.number().nullish(),
    refText: z.string().trim().max(120).nullish(),
    abnormal: z.boolean().optional(),
  })).min(1, "Enter at least one result").max(80),
  /** Default true - entering results finishes the test. */
  complete: z.boolean().optional(),
  /**
   * The lab's read of its own numbers, written as the results are saved.
   * Optional: plenty of tests are a number and nothing more, and forcing a
   * sentence out of a technician who has none is how "NAD" ends up on reports
   * that were never actually read.
   */
  impression: z.string().trim().max(600).nullish(),
});

export const orderTestsSchema = z.object({
  patientId: z.string().trim().min(1, "Select a patient"),
  catalogIds: z.array(z.string().trim().min(1)).min(1, "Select at least one test"),
  appointmentId: z.string().trim().optional(),
  /**
   * The doctor's advised rows this order fulfils. Sent when the order was
   * raised FROM the advice, so the advised line stops showing as outstanding.
   */
  fromAdvised: z
    .array(z.object({
      advisedLabId: z.string().trim().min(1),
      catalogId: z.string().trim().min(1),
    }))
    .optional(),
});

const paymentSchema = z.object({
  mode: z.enum(["CASH", "UPI", "CARD", "NETBANKING", "OTHER"]),
  amount: z.coerce.number().min(0),
  reference: z.string().trim().max(80).optional(),
});

/** A single leg of a split (part cash, part UPI). Every leg must be > ₹0. */
const paymentLegSchema = z.object({
  mode: z.enum(["CASH", "UPI", "CARD", "NETBANKING", "OTHER"]),
  amount: z.coerce.number().min(0.01),
  reference: z.string().trim().max(80).optional(),
});

/** Up to four tenders on one bill - plenty for cash + UPI (+ card) at a desk. */
export const paymentsSchema = z.array(paymentLegSchema).min(1).max(4);

export const billLabTestsSchema = z.object({
  patientId: z.string().trim().min(1),
  labTestIds: z.array(z.string().trim().min(1)).min(1, "Select at least one test"),
  discountAmount: z.coerce.number().min(0).optional(),
  payment: paymentSchema.optional(),
  payments: paymentsSchema.optional(),
});

/**
 * The least a walk-in has to give the lab counter to become a patient record.
 *
 * Deliberately not `registerPatientSchema` with everything optional: somebody
 * standing at the lab window with a chit is not going to answer twenty
 * questions, and a form that asks them anyway gets filled with junk. Name and
 * mobile are all that is taken, because those are the two the report has to
 * carry to reach the right person. Everything else is reception's job later.
 *
 * The mobile is NOT optional - `Patient.phone` is a required column, and the
 * alternative (inventing a placeholder number) puts a fiction in a record the
 * hospital later dials.
 */
export const quickPatientSchema = z.object({
  firstName: z.string().trim().min(1, "Enter the patient's name").max(80),
  lastName: z.string().trim().max(80).optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .refine(isIndianMobile, "Enter a valid 10-digit mobile number")
    .transform(toE164),
  age: z.coerce.number().int().min(0).max(120).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
});

export type QuickPatientInput = z.infer<typeof quickPatientSchema>;

/**
 * One trip for the whole counter transaction: register the walk-in if they are
 * new, order what was asked for, and bill it.
 *
 * It is one call because it is one queue. Splitting it across three screens is
 * what left tests ordered and never billed, and patients registered who never
 * got a test - each step succeeded on its own and the sequence was what broke.
 *
 * `labTestIds` carries tests ALREADY on file (ordered earlier, still unbilled)
 * onto the same invoice, so a patient who was here this morning doesn't leave
 * with two receipts.
 */
export const walkInSchema = z
  .object({
    /** An existing patient... */
    patientId: z.string().trim().min(1).optional(),
    /** ...or one being created at this counter, right now. Exactly one of the two. */
    newPatient: quickPatientSchema.optional(),
    /** Catalog entries to order now. */
    catalogIds: z.array(z.string().trim().min(1)).default([]),
    /** Tests already ordered and still unbilled, to include on this bill. */
    labTestIds: z.array(z.string().trim().min(1)).default([]),
    /** Omit to order without taking money (the bill is raised later). */
    bill: z
      .object({
        discountAmount: z.coerce.number().min(0).optional(),
        payments: paymentsSchema.optional(),
      })
      .optional(),
  })
  .refine((d) => (d.patientId ? 1 : 0) + (d.newPatient ? 1 : 0) === 1, {
    message: "Choose an existing patient, or enter a new one",
    path: ["patientId"],
  })
  .refine((d) => d.catalogIds.length + d.labTestIds.length > 0, {
    message: "Select at least one test",
    path: ["catalogIds"],
  })
  .refine((d) => d.catalogIds.length > 0 || !!d.bill, {
    // labTestIds alone with no bill asks for nothing to happen.
    message: "Select at least one test to order",
    path: ["catalogIds"],
  });

/** Walk-in OP consultation bill (patient pays for a consultation at the counter). */
export const billConsultationSchema = z.object({
  patientId: z.string().trim().min(1),
  appointmentId: z.string().trim().optional(),
  description: z.string().trim().min(2).max(120).default("Doctor consultation"),
  amount: z.coerce.number().min(0),
  gstRatePct: z.coerce.number().min(0).max(28).optional().default(0),
  discountAmount: z.coerce.number().min(0).optional(),
  payment: paymentSchema.optional(),
  payments: paymentsSchema.optional(),
});

export const recordPaymentSchema = z
  .object({
    invoiceId: z.string().trim().min(1),
    // A single tender (mode + amount) OR a split via `payments`. One is required.
    mode: z.enum(["CASH", "UPI", "CARD", "NETBANKING", "OTHER"]).optional(),
    amount: z.coerce.number().min(0.01).optional(),
    reference: z.string().trim().max(80).optional(),
    payments: paymentsSchema.optional(),
  })
  .refine((d) => (d.payments && d.payments.length > 0) || (d.mode != null && d.amount != null), {
    message: "Enter a payment amount",
  });

export const updateInvoiceSchema = z.object({
  invoiceId: z.string().trim().min(1),
  lines: z.array(z.object({
    description: z.string().trim().min(1).max(120),
    qty: z.coerce.number().int().min(1).optional(),
    unitPrice: z.coerce.number().min(0),
    gstRatePct: z.coerce.number().min(0).max(28).optional(),
    hsnSac: z.string().trim().max(20).optional(),
    labTestId: z.string().trim().optional(),
  })).min(1, "An invoice needs at least one item"),
  discountAmount: z.coerce.number().min(0).optional(),
  notes: z.string().trim().max(300).optional(),
});

export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason for cancelling").max(200),
});
