/**
 * The e-invoice payload, built to the NIC schema (version 1.1).
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It does not create an IRN. An IRN is a 64-character hash the government's
 * Invoice Registration Portal returns AFTER it has accepted an invoice, and
 * nothing computed on this machine is a valid one. What this file does is build
 * the document that gets submitted, and - more usefully - refuse to submit
 * documents that will be rejected.
 *
 * That refusal is the real value here. An IRP rejection is not free: the portal
 * counts a failed submission against the invoice number, and a bill rejected
 * for a mistyped GSTIN has to be cancelled and reissued under a NEW number
 * rather than simply corrected. So every rule the portal enforces that we can
 * check locally, we check locally.
 *
 * INTRA-STATE ONLY, ON PURPOSE
 * ----------------------------
 * Invoice carries cgstAmount and sgstAmount and no IGST column, and that is
 * correct for this hospital rather than an oversight. Place of supply for a
 * health service is where the service is performed, and for over-the-counter
 * goods it is where the goods are handed over - both are the hospital. A bill
 * raised here is an intra-state supply even when the patient, or the insurer
 * being billed, sits in another state. The payload therefore always reports
 * CGST + SGST and a zero IGST, and `buildEInvoicePayload` refuses to guess
 * otherwise. If this hospital ever makes a genuine inter-state supply, that is
 * a schema change, not a formatting change.
 */

export interface EInvoiceSeller {
  gstin: string;
  legalName: string;
  addressLine: string;
  city: string;
  /** Two-digit GST state code, e.g. "36" for Telangana. */
  stateCode: string;
  pincode: string;
  phone?: string | null;
  email?: string | null;
}

export interface EInvoiceBuyer {
  gstin: string;
  legalName: string;
  address?: string | null;
  city?: string | null;
  stateCode: string;
  pincode?: string | null;
}

export interface EInvoiceLine {
  description: string;
  hsnSac: string | null;
  qty: number;
  unitPrice: number;
  /** Line value before tax. */
  amount: number;
  gstRatePct: number;
  /** Services (consultation, a lab test) vs goods (a strip of tablets). */
  isService: boolean;
}

export interface EInvoiceSourceDoc {
  /** Our receipt number. Becomes DocDtls.No and must satisfy the portal's rules. */
  receiptNo: string;
  invoiceDate: Date;
  lines: EInvoiceLine[];
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
}

/** The subset of the NIC v1.1 schema this hospital actually populates. */
export interface EInvoicePayload {
  Version: "1.1";
  TranDtls: { TaxSch: "GST"; SupTyp: "B2B"; RegRev: "N"; IgstOnIntra: "N" };
  DocDtls: { Typ: "INV"; No: string; Dt: string };
  SellerDtls: Record<string, string | undefined>;
  BuyerDtls: Record<string, string | number | undefined>;
  ItemList: Record<string, string | number | undefined>[];
  ValDtls: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GSTIN
// ─────────────────────────────────────────────────────────────────────────────

const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** 2 state digits, 10-char PAN, entity digit, 'Z', checksum. */
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * The GSTIN's own check digit.
 *
 * Worth doing rather than trusting the shape regex: a transposed pair of
 * characters passes the regex and fails at the portal, and the portal is the
 * expensive place to find out. This is the standard weighted-modulus-36
 * algorithm published with the GSTIN format.
 */
export function isValidGstinChecksum(gstin: string): boolean {
  if (gstin.length !== 15) return false;
  let sum = 0;
  let factor = 2;
  for (let i = 13; i >= 0; i--) {
    const codePoint = GSTIN_CHARSET.indexOf(gstin[i]);
    if (codePoint < 0) return false;
    const product = codePoint * factor;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = GSTIN_CHARSET[(36 - (sum % 36)) % 36];
  return expected === gstin[14];
}

/** Shape AND check digit. Either failing means the portal will reject it. */
export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  const g = gstin.trim().toUpperCase();
  return GSTIN_SHAPE.test(g) && isValidGstinChecksum(g);
}

/** The first two characters of a GSTIN are its state code, always. */
export const stateCodeOfGstin = (gstin: string): string => gstin.trim().slice(0, 2);

// ─────────────────────────────────────────────────────────────────────────────
// Portal formatting rules
// ─────────────────────────────────────────────────────────────────────────────

/** The portal wants DD/MM/YYYY, and rejects anything else including ISO. */
export function toIrpDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Document numbers the portal accepts: at most 16 characters, alphanumeric
 * plus slash and hyphen, and it may not begin with 0, / or -.
 */
export function isValidDocNo(no: string): boolean {
  return /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/.test(no);
}

/**
 * GST rates the portal recognises. A rate not on this list is rejected outright,
 * which is how a fat-fingered "1.8" instead of "18" gets caught here rather than
 * three days later by the accountant.
 */
const VALID_GST_RATES = new Set([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28]);

/** Money as the portal wants it: a number, two decimals, never a string. */
const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility
// ─────────────────────────────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean;
  /** Every problem found, not just the first - one round of fixes, not five. */
  reasons: string[];
}

/**
 * Would the portal accept this bill?
 *
 * Returns ALL failures rather than throwing on the first, because the person
 * reading this is at a billing counter fixing a bill, and telling them about
 * one wrong field at a time is how a five-minute correction becomes an hour.
 */
export function checkEligibility(
  doc: EInvoiceSourceDoc,
  seller: EInvoiceSeller,
  buyer: EInvoiceBuyer | null
): EligibilityResult {
  const reasons: string[] = [];

  if (!isValidGstin(seller.gstin)) {
    reasons.push("The hospital's own GSTIN is missing or invalid - set it in Settings.");
  }

  // The defining test. No registered buyer means this is a B2C supply, and B2C
  // supplies do not get an IRN at any turnover.
  if (!buyer || !buyer.gstin) {
    reasons.push("This is a B2C bill (no buyer GSTIN). e-Invoicing applies only to registered buyers.");
  } else {
    if (!isValidGstin(buyer.gstin)) reasons.push(`The buyer's GSTIN "${buyer.gstin}" is not valid.`);
    if (!buyer.legalName?.trim()) reasons.push("The buyer's registered legal name is required.");
    if (buyer.gstin && isValidGstin(buyer.gstin) && buyer.stateCode
      && stateCodeOfGstin(buyer.gstin) !== buyer.stateCode) {
      reasons.push("The buyer's state code doesn't match the first two digits of their GSTIN.");
    }
  }

  if (!isValidDocNo(doc.receiptNo)) {
    reasons.push(`Receipt number "${doc.receiptNo}" isn't a valid document number (max 16 chars, no leading 0/-//).`);
  }

  if (doc.lines.length === 0) reasons.push("The bill has no line items.");
  if (doc.totalAmount <= 0) reasons.push("The bill total must be greater than zero.");

  for (const [i, l] of doc.lines.entries()) {
    if (!VALID_GST_RATES.has(l.gstRatePct)) {
      reasons.push(`Line ${i + 1} ("${l.description}") has GST rate ${l.gstRatePct}%, which the portal doesn't accept.`);
    }
    // A taxed line without an HSN/SAC is the single most common rejection.
    if (l.gstRatePct > 0 && !l.hsnSac?.trim()) {
      reasons.push(`Line ${i + 1} ("${l.description}") charges GST but has no HSN/SAC code.`);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// The payload
// ─────────────────────────────────────────────────────────────────────────────

export class EInvoiceIneligibleError extends Error {
  constructor(public reasons: string[]) {
    super(reasons.join(" "));
    this.name = "EInvoiceIneligibleError";
  }
}

/**
 * Build the submission document.
 *
 * Throws rather than returning a half-formed payload when the bill isn't
 * eligible: there is no useful thing a caller can do with an invalid e-invoice
 * except not send it, and a payload that exists is a payload something will
 * eventually POST.
 */
export function buildEInvoicePayload(
  doc: EInvoiceSourceDoc,
  seller: EInvoiceSeller,
  buyer: EInvoiceBuyer
): EInvoicePayload {
  const check = checkEligibility(doc, seller, buyer);
  if (!check.eligible) throw new EInvoiceIneligibleError(check.reasons);

  // Line-level tax. The invoice stores CGST and SGST only as totals, so each
  // line's share is computed from its own rate - halved, because an intra-state
  // supply splits the rate evenly between centre and state.
  const items = doc.lines.map((l, i) => {
    const half = l.gstRatePct / 2;
    const cgst = money((l.amount * half) / 100);
    const sgst = money((l.amount * half) / 100);
    return {
      SlNo: String(i + 1),
      PrdDesc: l.description.slice(0, 300),
      // Y/N, and the portal cares: an HSN code on a line marked as a service
      // is a validation failure.
      IsServc: l.isService ? "Y" : "N",
      HsnCd: l.hsnSac?.trim() || undefined,
      Qty: l.qty,
      // "OTH" (others) is the honest unit for a consultation or a blood test.
      Unit: l.isService ? "OTH" : "NOS",
      UnitPrice: money(l.unitPrice),
      TotAmt: money(l.amount),
      AssAmt: money(l.amount),
      GstRt: l.gstRatePct,
      IgstAmt: 0,
      CgstAmt: cgst,
      SgstAmt: sgst,
      TotItemVal: money(l.amount + cgst + sgst),
    };
  });

  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: doc.receiptNo, Dt: toIrpDate(doc.invoiceDate) },
    SellerDtls: {
      Gstin: seller.gstin.trim().toUpperCase(),
      LglNm: seller.legalName,
      Addr1: seller.addressLine,
      Loc: seller.city,
      Pin: seller.pincode,
      Stcd: seller.stateCode,
      Ph: seller.phone?.replace(/\D/g, "").slice(-10) || undefined,
      Em: seller.email || undefined,
    },
    BuyerDtls: {
      Gstin: buyer.gstin.trim().toUpperCase(),
      LglNm: buyer.legalName,
      // Place of supply. Always the seller's state here - see the note at the
      // top of this file on why a hospital's supply is intra-state.
      Pos: seller.stateCode,
      Addr1: buyer.address || seller.addressLine,
      Loc: buyer.city || seller.city,
      Pin: buyer.pincode || seller.pincode,
      Stcd: buyer.stateCode || stateCodeOfGstin(buyer.gstin),
    },
    ItemList: items,
    ValDtls: {
      AssVal: money(doc.taxableAmount),
      CgstVal: money(doc.cgstAmount),
      SgstVal: money(doc.sgstAmount),
      IgstVal: 0,
      Discount: money(doc.discountAmount),
      TotInvVal: money(doc.totalAmount),
    },
  };
}
