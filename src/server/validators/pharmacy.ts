import { z } from "zod";

export const addBatchSchema = z.object({
  medicineId: z.string().trim().min(1),
  /// WHO IT CAME FROM. Required - a batch on the shelf that cannot be traced to
  /// a distributor cannot be recalled or returned. `supplierRef` below is free
  /// text (a docket number); this is the actual link.
  supplierId: z.string().trim().min(1, "Choose the supplier this stock came from"),
  batchNo: z.string().trim().min(1, "Batch number is required").max(40),
  expiryDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  /// In PACKS, as bought. The shelf stores dispensing units - see lib/pharmacy/pack.
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  pack: z.string().trim().max(20).optional().catch(undefined),
  packSize: z.coerce.number().int().min(1).max(5000).optional().catch(undefined),
  mrp: z.coerce.number().min(0),
  purchasePrice: z.coerce.number().min(0).optional(),
  supplierRef: z.string().trim().max(60).optional(),
});

/** Bulk stock receipt - from a spreadsheet or a keyed-in scanned invoice.
 *  Each row identifies its medicine by catalog id (preferred) or by name. */
export const bulkAddBatchesSchema = z.object({
  /// ONE INVOICE, ONE SUPPLIER. Every row in an import is stock off the same
  /// distributor's invoice, so the supplier belongs to the import and not to
  /// each line - which also stops a half-filled sheet producing rows attributed
  /// to nobody. A second supplier's invoice is a second import.
  supplierId: z.string().trim().min(1, "Choose the supplier this invoice is from"),
  /// The distributor's invoice number and date, carried onto every row's ledger
  /// entry so a batch traces back to the document it arrived on.
  invoiceNo: z.string().trim().max(60).optional().or(z.literal("")),
  invoiceDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().or(z.literal("")),
  rows: z.array(
    z.object({
      medicineId: z.string().trim().min(1).optional(),
      medicine: z.string().trim().max(120).optional(),
      /// when true and the name isn't in the catalog, create the medicine first
      createNew: z.boolean().optional(),
      hsn: z.string().trim().max(20).optional(),
      gstRatePct: z.coerce.number().min(0).max(28).optional(),
      batchNo: z.string().trim().min(1, "Batch number is required").max(40),
      expiryDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
      /// In PACKS. Multiplied by packSize to reach dispensing units.
      quantity: z.coerce.number().int().min(1),
      pack: z.string().trim().max(20).optional().catch(undefined),
      packSize: z.coerce.number().int().min(1).max(5000).optional().catch(undefined),
      mrp: z.coerce.number().min(0),
      purchasePrice: z.coerce.number().min(0).optional(),
      supplierRef: z.string().trim().max(60).optional(),
    }).refine((r) => r.medicineId || r.medicine, { message: "medicine id or name is required" })
  ).min(1, "Nothing to import").max(500, "Import up to 500 rows at a time"),
});

export const adjustStockSchema = z.object({
  batchId: z.string().trim().min(1),
  delta: z.coerce.number().int(),
  reason: z.string().trim().min(3, "Give a reason").max(160),
});

export const dispenseSchema = z.object({
  patientId: z.string().trim().min(1),
  prescriptionUploadId: z.string().trim().optional(),
  items: z.array(z.object({
    medicineId: z.string().trim().min(1),
    qty: z.coerce.number().int().min(1),
  })).min(1, "Add at least one medicine"),
  discountAmount: z.coerce.number().min(0).optional(),
  shortSupplyReason: z.string().trim().max(200).optional(),
  payment: z.object({
    mode: z.enum(["CASH", "UPI", "CARD", "NETBANKING", "OTHER"]),
    amount: z.coerce.number().min(0),
    reference: z.string().trim().max(80).optional(),
  }).optional(),
  // Split settlement: part cash, part UPI, etc. Each leg must be > ₹0.
  payments: z.array(z.object({
    mode: z.enum(["CASH", "UPI", "CARD", "NETBANKING", "OTHER"]),
    amount: z.coerce.number().min(0.01),
    reference: z.string().trim().max(80).optional(),
  })).min(1).max(4).optional(),
});

export const medicineSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2).max(120),
  genericName: z.string().trim().max(120).optional().or(z.literal("")),
  manufacturer: z.string().trim().max(120).optional().or(z.literal("")),
  hsnCode: z.string().trim().max(20).optional().or(z.literal("")),
  gstRatePct: z.coerce.number().min(0).max(28),
  unit: z.string().trim().max(30).default("tablet"),
  reorderThreshold: z.coerce.number().int().min(0).default(10),
  rackLocation: z.string().trim().max(30).optional().or(z.literal("")),
  active: z.boolean().optional().default(true),
  courseCritical: z.boolean().optional().default(false),
  /// Procurement defaults. Empty string clears them - the stock form sends ""
  /// for "no preferred supplier" rather than omitting the key.
  preferredSupplierId: z.string().trim().optional().or(z.literal("")),
  reorderQty: z.coerce.number().int().min(0).optional(),

  // ── MASTER LINKS ──
  // Optional throughout. Omitted entirely -> the existing link is left alone,
  // so any caller written before these existed keeps working. Empty string ->
  // the link is cleared. `scheduleId` is included for completeness but is only
  // ever set by someone picking it: nothing infers a drug schedule.
  categoryId: z.string().trim().optional().or(z.literal("")),
  genericId: z.string().trim().optional().or(z.literal("")),
  manufacturerId: z.string().trim().optional().or(z.literal("")),
  dosageFormId: z.string().trim().optional().or(z.literal("")),
  unitId: z.string().trim().optional().or(z.literal("")),
  hsnId: z.string().trim().optional().or(z.literal("")),
  taxRateId: z.string().trim().optional().or(z.literal("")),
  scheduleId: z.string().trim().optional().or(z.literal("")),
});
