import { z } from "zod";

/**
 * A doctor's own details, as the front desk maintains them.
 *
 * Deliberately NOT the admin staff schema: that one carries username, password
 * and role, because it makes login accounts. This makes a bookable person. See
 * createDoctorProfile for why the two are kept apart.
 */
const base = {
  name: z.string().trim().min(2, "Name the doctor").max(120),
  specialization: z.string().trim().min(2, "Specialization is required").max(80),
  department: z.string().trim().min(2, "Department is required").max(80),
  /** What every consultation with them is billed at, until somebody changes it. */
  consultationFee: z.coerce.number().min(0, "Fee cannot be negative").max(100000),
  qualification: z.string().trim().max(160).optional().or(z.literal("")),
  experienceYears: z.coerce.number().int().min(0).max(70).optional(),
  age: z.coerce.number().int().min(21, "A practising doctor is at least 21").max(100).optional(),
  languages: z.string().trim().max(160).optional().or(z.literal("")),
  photoUrl: z.string().trim().max(500)
    .refine((v) => v === "" || v.startsWith("/") || v.startsWith("https://"), "Photo must be an https URL or a /path")
    .optional().or(z.literal("")),
  bio: z.string().trim().max(1000).optional().or(z.literal("")),
};

export const createDoctorSchema = z.object(base);

/** Everything optional - the desk edits one field at a time. */
export const updateDoctorSchema = z.object({
  ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
  /** Off the roster without deleting them - a locum who has left still owns
   *  every appointment and bill they ever raised. */
  active: z.boolean().optional(),
} as never) as z.ZodType<Partial<z.infer<typeof createDoctorSchema>> & { active?: boolean }>;
