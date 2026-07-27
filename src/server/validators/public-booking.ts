import { z } from "zod";

/** Indian mobile: 10 digits, first one 6-9. Spaces and +91 are stripped first. */
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, "").slice(-10))
  .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a valid 10-digit mobile number");

const name = z
  .string()
  .trim()
  .min(2, "Enter the patient's name")
  .max(80, "That name is too long")
  // Letters, spaces, apostrophes and dots only - this becomes a medical record.
  .regex(/^[A-Za-z][A-Za-z .'-]*$/, "Use letters only for the name");

export const bookingOtpSchema = z.object({
  slotId: z.string().trim().min(1, "Pick a time first"),
  name,
  phone,
});

export const confirmBookingSchema = z.object({
  slotId: z.string().trim().min(1, "Pick a time first"),
  name,
  phone,
  code: z.string().trim().regex(/^\d{6}$/, "The code is 6 digits"),
});

// ---------------------------------------------------------------------------
// Callback requests - the lighter door beside slot booking. No slot, and the
// doctor is optional, because "any available doctor" is a real answer.
// ---------------------------------------------------------------------------

/** Only the number is needed to send a code - the rest is collected at submit. */
export const callbackOtpSchema = z.object({ phone });

export const callbackRequestSchema = z.object({
  name,
  phone,
  code: z.string().trim().regex(/^\d{6}$/, "The code is 6 digits"),
  doctorId: z.string().trim().max(40).optional().or(z.literal("")),
  preferredDate: z
    .string().trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .optional().or(z.literal("")),
  // Free text a patient types about their problem. Capped, and never rendered
  // as HTML anywhere - React escapes it, and the desk sees it as plain text.
  note: z.string().trim().max(500, "Please keep this under 500 characters").optional().or(z.literal("")),
});

/** Reception moving a request along. */
export const updateCallbackRequestSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "BOOKED", "CLOSED"]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
  appointmentId: z.string().trim().max(40).optional().or(z.literal("")),
});
