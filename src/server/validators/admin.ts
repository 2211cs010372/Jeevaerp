import { z } from "zod";
import { isIndianMobile, toE164 } from "@/lib/phone";

/**
 * A doctor's consulting profile - everything the booking cards and the public
 * directory render. Optional as a block: only a DOCTOR carries one, and the
 * refinement below is what makes the clinically-required parts mandatory.
 *
 * `photoUrl` takes either a path under /public (the pre-existing avifs) or an
 * absolute https URL (what a Supabase Storage upload returns). http:// is
 * refused - a mixed-content image is blocked by the browser anyway, so accepting
 * it only produces a card with a hole in it.
 */
const doctorProfileSchema = z.object({
  specialization: z.string().trim().min(2, "Specialization is required").max(80),
  department: z.string().trim().min(2, "Department is required").max(80),
  consultationFee: z.coerce.number().min(0, "Fee cannot be negative").max(100000),
  qualification: z.string().trim().max(160).optional().or(z.literal("")),
  experienceYears: z.coerce.number().int().min(0).max(70).optional(),
  age: z.coerce.number().int().min(21, "A practising doctor is at least 21").max(100).optional(),
  languages: z.string().trim().max(160).optional().or(z.literal("")),
  photoUrl: z.string().trim().max(500)
    .refine((v) => v === "" || v.startsWith("/") || v.startsWith("https://"), "Photo must be an https URL or a /path")
    .optional().or(z.literal("")),
  bio: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type DoctorProfileInput = z.infer<typeof doctorProfileSchema>;

/** A doctor without a specialization is not bookable - the directory groups on it. */
const requireDoctorProfile = (
  v: { role: string; doctor?: DoctorProfileInput },
  ctx: z.RefinementCtx
) => {
  if (v.role === "DOCTOR" && !v.doctor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["doctor"],
      message: "A doctor needs a specialization, department and consultation fee",
    });
  }
};

export const createStaffSchema = z.object({
  /** role.name - e.g. reception.ravi */
  username: z.string().trim().toLowerCase()
    .regex(/^(admin|reception|labs|pharmacy|doctor|insurance)\.[a-z0-9_]{2,30}$/, "Username must be role.name (e.g. reception.ravi)"),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  // Staff numbers are stored in the same +91 form as patients - see lib/phone.
  phone: z.string().trim().refine(isIndianMobile, "Enter a valid 10-digit number").transform(toE164),
  role: z.enum(["ADMIN", "RECEPTIONIST", "LAB_TECH", "PHARMACIST", "DOCTOR", "INSURANCE_DESK"]),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  doctor: doctorProfileSchema.optional(),
}).superRefine(requireDoctorProfile);

/**
 * Editing an existing account. Every field is optional - the form sends only
 * what changed - but `role` is NOT here on purpose: moving a receptionist to
 * DOCTOR would leave a username reading `reception.ravi` on a consulting card,
 * and moving a doctor out would orphan their appointments. Deactivate and
 * create the correct account instead.
 */
export const updateStaffSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().trim().refine(isIndianMobile, "Enter a valid 10-digit number").transform(toE164).optional(),
  /** Omitted or empty = leave the existing password alone. */
  password: z.string().min(8, "Password must be at least 8 characters").max(72).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  /** Ignored unless the account already is a doctor. */
  doctor: doctorProfileSchema.partial().optional(),
});

export const setStaffActiveSchema = z.object({
  userId: z.string().trim().min(1),
  isActive: z.boolean(),
});

export const catalogItemSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(20).optional().or(z.literal("")),
  price: z.coerce.number().min(0),
  gstRatePct: z.coerce.number().min(0).max(28),
  active: z.boolean().optional().default(true),
});

/**
 * A logo, inline. Only raster formats a browser and a printer both handle, plus
 * SVG - which is text, so it is length-checked like everything else.
 *
 * 512 KB of base64 is roughly a 380 KB image, far more than a logo ever needs and
 * small enough that shipping it inside the config response costs nothing. The
 * regex is the real gate: without it this column would accept
 * `data:text/html,<script>` and every portal would render it.
 */
const LOGO_DATA_URL = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
export const logoSchema = z
  .string()
  .trim()
  .max(512 * 1024, "Logo must be under 512 KB - resize it and try again")
  .regex(LOGO_DATA_URL, "Upload a PNG, JPEG, WEBP or SVG image");

/**
 * A favicon. Same shape as a logo but a tighter cap and one extra format.
 *
 * 64 KB is generous for something rendered at 16 px - and the limit matters more
 * here than for the logo, because this one is fetched by every browser tab on
 * every page of the public site, not just by a signed-in staff member.
 *
 * image/x-icon is allowed because a .ico is what most people already have to
 * hand; SVG is allowed because it is what actually stays sharp on a retina tab.
 */
const FAVICON_DATA_URL = /^data:image\/(png|x-icon|vnd\.microsoft\.icon|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
export const faviconSchema = z
  .string()
  .trim()
  .max(64 * 1024, "Favicon must be under 64 KB - it is rendered at 16 pixels")
  .regex(FAVICON_DATA_URL, "Upload a PNG, ICO, WEBP or SVG image");

/** A 24-hour wall-clock time, "H:MM" or "HH:MM". Rejects 24:00 and 20:60. */
const hhmm = /^([01]?\d|2[0-3]):[0-5]\d$/;

export const hospitalConfigSchema = z.object({
  legalName: z.string().trim().min(2).max(120),
  addressLine: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  stateCode: z.string().trim().regex(/^\d{2}$/, "State code is 2 digits (Telangana = 36)"),
  pincode: z.string().trim().regex(/^\d{6}$/, "6-digit PIN"),
  gstin: z.string().trim().max(20).optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),

  // Branding. An empty string is how the form says "remove the logo" - distinct
  // from the field being absent, which means "leave whatever is there alone".
  logoDataUrl: logoSchema.optional().or(z.literal("")),
  faviconDataUrl: faviconSchema.optional().or(z.literal("")),
  brandName: z.string().trim().min(1).max(40).optional(),
  tagline: z.string().trim().max(120).optional().or(z.literal("")),
  invoiceFooterNote: z.string().trim().max(600).optional().or(z.literal("")),

  // Behaviour switches. Each one changes what a portal actually does.
  expiryAlertDays: z.coerce.number().int().min(1).max(730).optional(),
  blockDischargeOnDues: z.boolean().optional(),
  onlineBookingEnabled: z.boolean().optional(),
  callbackRequestsEnabled: z.boolean().optional(),
  accountsTabEnabled: z.boolean().optional(),
  /// Hands reception and the insurance desk the ability to rewrite an unpaid
  /// bill. See the HospitalConfig column comment for why it defaults off.
  billEditingEnabled: z.boolean().optional(),

  // The nightly report to the owners. Both lists are free text because that is
  // what a distribution list is - typed, pasted, corrected at a desk. They are
  // parsed and de-duplicated in lib/daily-report.ts, which also drops anything
  // that is not an address or an Indian mobile, so a stray word costs a
  // recipient rather than a rejected form.
  dailyReportEnabled: z.boolean().optional(),
  reportEmails: z.string().trim().max(2000).optional().or(z.literal("")),
  reportWhatsappNumbers: z.string().trim().max(1000).optional().or(z.literal("")),

  // After-hours OP pricing. The times are "HH:MM" on a 24-hour clock; end may be
  // earlier than start, which means the window crosses midnight.
  afterHoursOpEnabled: z.boolean().optional(),
  afterHoursOpStart: z.string().trim().regex(hhmm, "Use a 24-hour time like 20:00").optional(),
  afterHoursOpEnd: z.string().trim().regex(hhmm, "Use a 24-hour time like 06:00").optional(),
  // Floor of 1 and not 0: this is a surcharge, and a multiplier below 1 would
  // quietly turn the night shift into a discount.
  afterHoursOpMultiplier: z.coerce.number().min(1).max(10).optional(),
});

/**
 * Send the daily report now.
 *
 * The date is optional and means "today" when absent. It exists for the case
 * the button is really for: a night the cron missed, re-sent the next morning
 * for the day it should have covered.
 */
export const dailyReportSendSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
});

/**
 * Archive or restore a patient. Deliberately a boolean rather than a DELETE
 * verb: the record is hidden, never removed (see setPatientArchived), and the
 * same endpoint puts it back.
 */
export const archivePatientSchema = z.object({
  archived: z.boolean(),
});
