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
