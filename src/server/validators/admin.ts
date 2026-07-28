import { z } from "zod";
import { isIndianMobile, toE164 } from "@/lib/phone";

export const createStaffSchema = z.object({
  /** role.name - e.g. reception.ravi */
  username: z.string().trim().toLowerCase()
    .regex(/^(admin|reception|labs|pharmacy|doctor)\.[a-z0-9_]{2,30}$/, "Username must be role.name (e.g. reception.ravi)"),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  // Staff numbers are stored in the same +91 form as patients - see lib/phone.
  phone: z.string().trim().refine(isIndianMobile, "Enter a valid 10-digit number").transform(toE164),
  role: z.enum(["ADMIN", "RECEPTIONIST", "LAB_TECH", "PHARMACIST", "DOCTOR"]),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
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
  brandName: z.string().trim().min(1).max(40).optional(),
  tagline: z.string().trim().max(120).optional().or(z.literal("")),
  invoiceFooterNote: z.string().trim().max(600).optional().or(z.literal("")),

  // Behaviour switches. Each one changes what a portal actually does.
  expiryAlertDays: z.coerce.number().int().min(1).max(730).optional(),
  blockDischargeOnDues: z.boolean().optional(),
  onlineBookingEnabled: z.boolean().optional(),
  callbackRequestsEnabled: z.boolean().optional(),
});
