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
  /** The date and time the test was completed/reported. */
  completedAt: z.string().trim().nullish(),
});

export const orderTestsSchema = z.object({
  patientId: z.string().trim().min(1, "Select a patient"),
  catalogIds: z.array(z.string().trim().min(1)).min(1, "Select at least one test"),
  appointmentId: z.string().trim().optional(),
  /**
   * Who referred them, when no consultation here did - the doctor whose chit
   * the patient is holding at the window. Dropped server-side when the order is
   * linked to a visit, which already carries its own doctor.
   */
  referringDoctorId: z.string().trim().min(1).optional(),
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

/**
 * Correcting an order already on the bench: the referring doctor, the date it
 * was registered under, or both.
 *
 * Both fields are nullish rather than optional, and the difference carries
 * meaning: an ABSENT key leaves the value alone, an explicit `null` clears it.
 * Collapsing the two would mean a screen that only edits the date wipes the
 * doctor every time it saves.
 */
export const updateLabOrderSchema = z
  .object({
    referringDoctorId: z.string().trim().min(1).nullish(),
    /** `YYYY-MM-DD` from a date field, or a full ISO stamp. */
    orderedAt: z.string().trim().min(1).nullish(),
  })
  .refine((d) => d.referringDoctorId !== undefined || d.orderedAt !== undefined, {
    message: "Nothing to change",
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
  /**
   * Only ever sent for a baby, and derived on the form from the months or days
   * that were typed - `age` rounds both of those to 0, and 0 is the answer that
   * gets a newborn's bilirubin read against an adult's range. See lib/age.
   */
  dob: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").optional().or(z.literal("")),
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
    /** The doctor on the chit they walked in with, if they walked in with one. */
    referringDoctorId: z.string().trim().min(1).optional(),
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
  /**
   * THE DATE THE BILL PRINTS, when that is not the day it was typed.
   *
   * A plain "YYYY-MM-DD" - a bill is dated to a day, not to a moment, and
   * accepting a timestamp would invite a timezone to decide which day that is.
   * Stored in Invoice.billDate, which is deliberately NOT createdAt: see the
   * schema note. Sending null clears the correction and puts the sheet back on
   * the real date.
   *
   * NO FUTURE DATES. A bill dated next Tuesday is either a typo or an attempt to
   * push revenue into the next return period, and neither should be one
   * keystroke away at a counter. The past is left open: back-dating to the day
   * treatment was actually given is the entire reason this field exists.
   */
  billDate: z.string().trim().nullish(),
});

export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason for cancelling").max(200),
});

/**
 * A test the bench adds or corrects in the catalogue.
 *
 * The same shape admin's catalogItemSchema takes, MINUS gstRatePct - deliberately
 * and not as an oversight. A tax rate is a CA's call; the bench's business is the
 * name, the code and what the test costs. Leaving the field off the schema means
 * a labs client cannot set one even by posting it by hand, which is what makes
 * "the labs screen doesn't touch GST" a rule rather than a convention.
 */
export const labCatalogItemSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2, "Give the test a name").max(120),
  code: z.string().trim().max(20).optional().or(z.literal("")),
  price: z.coerce.number().min(0, "A price cannot be negative"),
  /**
   * The section band this test's report prints under - "HAEMATOLOGY", and the
   * bench's call, which is why it is on this door and not on admin's.
   *
   * OPTIONAL, AND "" IS NOT THE SAME AS ABSENT. Absent leaves the column alone.
   * Empty means print no band at all, which this lab wanted for the gravindex -
   * it is read off urine and does not belong under the heading the blood-borne
   * markers print under. The screen sends this on every save because it shows
   * the value it is about to write, resolved fallback and all, so a save can
   * never quietly mean something the technician could not see.
   */
  group: z.string().trim().max(40, "That section name is too long").optional(),
  active: z.boolean().optional().default(true),
});

/**
 * A round of price corrections from the price grid.
 *
 * Only ids and prices - no name, no code, no active flag. The grid edits one
 * column, so it sends one column; see bulkUpdateCatalogPrices for why widening
 * this would let a price fix quietly revert someone else's rename.
 *
 * The ceiling is not defensive padding. `price` is Decimal(10,2), so anything
 * from 100000000 up fails at the database with a message about numeric field
 * overflow - a sentence nobody at a bench can act on. Rejected here instead,
 * where the screen can say which test and why.
 */
export const labCatalogPricesSchema = z.object({
  prices: z.array(z.object({
    id: z.string().trim().min(1),
    price: z.coerce.number()
      .min(0, "A price cannot be negative")
      .max(9_999_999, "That price is too large"),
  })).min(1, "Nothing to save").max(500),
});

/**
 * A test's normal-value template, replacing whatever it had.
 *
 * The rules below are the SAME invariants tests/lab-catalog.test.ts asserts over
 * the seeded catalogue, enforced here so a row typed at a bench cannot break one
 * the seed would never have produced:
 *
 *  · a half-range (a low with no high) silently flags everything above it;
 *  · a numeric range AND a text range on one row means the flagging and the
 *    printed reference disagree about what normal is;
 *  · a low above its high flags every possible result;
 *  · a repeated name violates @@unique([catalogId, name]) and fails mid-write.
 */
export const catalogAnalytesSchema = z.object({
  analytes: z.array(z.object({
    name: z.string().trim().min(1, "Every row needs a name").max(120),
    unit: z.string().trim().max(30).nullish(),
    refLow: z.coerce.number().nullish(),
    refHigh: z.coerce.number().nullish(),
    refText: z.string().trim().max(120).nullish(),
  })).max(80, "A test cannot hold more than 80 rows"),
}).superRefine((v, ctx) => {
  const seen = new Set<string>();
  v.analytes.forEach((a, i) => {
    const key = a.name.trim().toLowerCase();
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["analytes", i, "name"], message: `"${a.name}" appears twice` });
    }
    seen.add(key);

    const hasLow = a.refLow != null;
    const hasHigh = a.refHigh != null;
    if (hasLow !== hasHigh) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["analytes", i, hasLow ? "refHigh" : "refLow"],
        message: `"${a.name}" has only one end of its range - give both, or neither`,
      });
    }
    if (hasLow && hasHigh && (a.refLow as number) > (a.refHigh as number)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["analytes", i, "refLow"],
        message: `"${a.name}" has a low above its high`,
      });
    }
    if ((hasLow || hasHigh) && a.refText?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["analytes", i, "refText"],
        message: `"${a.name}" has both a numeric range and a text one - keep one`,
      });
    }
  });
});
