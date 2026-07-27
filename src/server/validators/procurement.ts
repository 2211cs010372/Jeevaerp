import { z } from "zod";

const ymd = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const money = z.coerce.number().min(0);
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const supplierSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2, "Supplier name is required").max(120),
  contactPerson: optText(120),
  phone: optText(20),
  email: z.string().trim().email("That doesn't look like an email").max(120).optional().or(z.literal("")),
  address: optText(300),
  /// 15 characters, e.g. 29ABCDE1234F1Z5. Left loose - a wrong-length GSTIN
  /// should be flagged, not refused, because it blocks receiving real stock.
  gstin: optText(20),
  drugLicenseNo: optText(40),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(30),
  active: z.boolean().optional().default(true),
  notes: optText(500),
});

const poLine = z.object({
  medicineId: z.string().trim().min(1),
  qtyOrdered: z.coerce.number().int().min(1, "Order at least 1"),
  unitCost: money,
  gstRatePct: z.coerce.number().min(0).max(28).optional(),
  freeQty: z.coerce.number().int().min(0).optional(),
});

export const createPoSchema = z.object({
  supplierId: z.string().trim().min(1, "Pick a supplier"),
  expectedDate: ymd.optional(),
  notes: optText(500),
  send: z.boolean().optional(),
  items: z.array(poLine).min(1, "Add at least one medicine").max(200, "Split an order this large in two"),
});

export const updatePoSchema = z.object({
  expectedDate: ymd.nullable().optional(),
  notes: optText(500),
  items: z.array(poLine).min(1).max(200).optional(),
});

export const reorderDraftSchema = z.object({
  send: z.boolean().optional(),
  groups: z.array(z.object({
    supplierId: z.string().trim().min(1),
    expectedDate: ymd.optional(),
    items: z.array(poLine).min(1),
  })).min(1, "Nothing selected to order"),
});

export const cancelPoSchema = z.object({
  reason: z.string().trim().min(3, "Say why it's being cancelled").max(200),
});

/** Receiving a delivery. Every line pins a batch, an expiry and a rate. */
export const receiveGoodsSchema = z.object({
  supplierId: z.string().trim().min(1, "Pick a supplier"),
  purchaseOrderId: z.string().trim().optional(),
  invoiceNo: optText(60),
  invoiceDate: ymd.optional(),
  invoiceAmount: money.optional(),
  notes: optText(500),
  items: z.array(z.object({
    // One of these two. `medicineId` for a catalogued product; `newMedicineName`
    // to book in something the catalogue has never seen, which a distributor's
    // delivery routinely contains.
    medicineId: z.string().trim().optional().or(z.literal("")),
    newMedicineName: z.string().trim().min(2).max(120).optional().or(z.literal("")),
    purchaseOrderItemId: z.string().trim().optional(),
    batchNo: z.string().trim().min(1, "Batch number is on the strip").max(40),
    expiryDate: ymd,
    qty: z.coerce.number().int().min(1, "Received quantity must be at least 1"),
    freeQty: z.coerce.number().int().min(0).optional(),
    unitCost: money,
    mrp: money,
    // As printed on the bill, and DELIBERATELY UNABLE TO FAIL THE RECEIPT.
    //
    // These four are read off a photograph by OCR. A misread G% of "300490"
    // (the HSN, one column over) used to reject the whole delivery with a 400 -
    // refusing to put real stock on a real shelf because a cosmetic column was
    // misread. They are labels, not quantities: anything out of range is
    // dropped and the pharmacist can type it, while batch, expiry, quantity and
    // price stay strict because those are the ones that hurt someone.
    pack: z.string().trim().max(20).optional().catch(undefined),
    /// Units per pack. Strict-ish (it multiplies the shelf) but still
    /// non-fatal: a bad value falls back to reading the pack label.
    packSize: z.coerce.number().int().min(1).max(5000).optional().catch(undefined),
    oMrp: z.string().trim().max(20).optional().catch(undefined),
    hsn: z.string().trim().max(12).optional().catch(undefined),
    gstRatePct: z.coerce.number().min(0).max(28).optional().catch(undefined),
  }).refine((i) => !!i.medicineId?.trim() || !!i.newMedicineName?.trim(), {
    path: ["medicineId"],
    message: "Pick a medicine, or give a name to add it to the catalogue",
  })).min(1, "Add at least one line").max(200),
});

export const purchaseReturnSchema = z.object({
  supplierId: z.string().trim().min(1, "Pick a supplier"),
  reason: z.string().trim().min(3, "Say why it's going back").max(200),
  notes: optText(500),
  send: z.boolean().optional(),
  items: z.array(z.object({
    batchId: z.string().trim().min(1),
    qty: z.coerce.number().int().min(1),
  })).min(1, "Nothing to return").max(200),
});

export const returnStatusSchema = z.object({
  status: z.enum(["SENT", "CREDITED", "REJECTED"]),
  creditNoteNo: optText(60),
  creditedAmount: money.optional(),
  notes: optText(500),
});
