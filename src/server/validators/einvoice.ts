import { z } from "zod";

/**
 * The registered party a bill is raised to. Passing null clears it and puts the
 * bill back to B2C, which is the correct state for an ordinary counter sale.
 */
export const setBuyerSchema = z.object({
  buyer: z
    .object({
      gstin: z.string().trim().length(15, "A GSTIN is 15 characters"),
      legalName: z.string().trim().min(1, "The buyer's registered name is required").max(200),
      address: z.string().trim().max(300).nullish(),
      stateCode: z.string().trim().regex(/^\d{2}$/, "State code is two digits").nullish(),
    })
    .nullable(),
});

/**
 * An IRN obtained on the government portal and typed back in.
 *
 * `irn` is checked for shape here AND in the service. The duplication is
 * deliberate - this one gives the user a clean field-level error, the service's
 * one holds even if some future caller bypasses this schema.
 */
export const recordEInvoiceSchema = z.object({
  irn: z.string().trim().regex(/^[a-fA-F0-9]{64}$/, "An IRN is 64 hexadecimal characters"),
  ackNo: z.string().trim().min(1, "Acknowledgement number is required").max(40),
  ackDt: z.string().trim().min(1, "Acknowledgement date is required"),
  /// Stored verbatim: it is signed, and any edit invalidates the signature.
  signedQrCode: z.string().trim().min(1, "The signed QR text is required"),
  signedInvoice: z.string().trim().nullish(),
});

export const cancelEInvoiceSchema = z.object({
  reason: z.string().trim().min(1, "A cancellation reason is required").max(200),
  remarks: z.string().trim().max(200).optional(),
  /// True when the portal cancellation already happened and we're recording it.
  manual: z.boolean().optional(),
});

/** Date range for the Tally export. Inclusive of both ends. */
export const tallyExportSchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});
