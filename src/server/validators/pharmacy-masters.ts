import { z } from "zod";
import { MASTER_KINDS } from "@/lib/pharmacy/masters";

export const masterKindSchema = z.enum(MASTER_KINDS);

/**
 * One schema for eight masters. The kind-specific fields are all optional
 * because each master only sends its own - and the service, which knows which
 * kind it is dealing with, is what enforces the ones that are required (a tax
 * rate without a percentage, for instance).
 *
 * Empty strings are accepted throughout and normalised to "not given" in the
 * service: a form clearing a field sends "", not a missing key.
 */
export const masterSchema = z.object({
  id: z.string().trim().optional(),
  /// `name` for most masters, `code` for HSN and drug schedules.
  label: z.string().trim().min(1, "This can't be blank").max(120),
  active: z.boolean().optional().default(true),

  description: z.string().trim().max(300).optional().or(z.literal("")),
  strength: z.string().trim().max(60).optional().or(z.literal("")),
  shortCode: z.string().trim().max(20).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  symbol: z.string().trim().max(12).optional().or(z.literal("")),
  /// GST in India tops out at 28%. A rate outside that is a typing error.
  ratePct: z.coerce.number().min(0).max(28).optional(),
  defaultTaxRateId: z.string().trim().optional().or(z.literal("")),
  requiresPrescription: z.boolean().optional(),
  retentionYears: z.coerce.number().int().min(0).max(20).optional(),
});

export const setActiveSchema = z.object({
  active: z.boolean(),
});
