import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import { irpAdapterFor } from "@/server/irp/adapter";
import {
  buildEInvoicePayload,
  checkEligibility,
  isValidGstin,
  stateCodeOfGstin,
  EInvoiceIneligibleError,
  type EInvoiceBuyer,
  type EInvoiceSeller,
  type EInvoiceSourceDoc,
} from "@/lib/gst/einvoice-payload";
import type { AuthUser } from "@/lib/auth/types";

/**
 * e-Invoicing against the government's Invoice Registration Portal.
 *
 * Two things shape everything in this file.
 *
 * First, almost nothing this hospital bills is in scope. Healthcare services by
 * a clinical establishment are GST-exempt, and a bill to a patient paying for
 * themselves is B2C - neither gets an IRN. What IS in scope is the small tail:
 * a cashless claim billed to an insurer or TPA, a corporate health-check
 * contract, anything where the recipient is GST-registered. So the normal
 * answer to "should this bill have an IRN?" is no, and the code says so plainly
 * rather than treating it as a failure.
 *
 * Second, an IRN is issued by an outside authority we do not control. Every
 * function here is therefore written around the possibility that the portal
 * says no, is unreachable, or is being driven by hand by an accountant.
 */

const SOURCE_IS_SERVICE: Record<string, boolean> = {
  CONSULTATION: true,
  LAB: true,
  IPD: true,
  // Pharmacy sells goods. The distinction is not cosmetic: the portal validates
  // HSN codes against it, and a service line carrying a goods HSN is rejected.
  PHARMACY: false,
  OTHER: true,
};

export interface EInvoiceDTO {
  status: "NOT_APPLICABLE" | "PENDING" | "GENERATED" | "FAILED" | "CANCELLED";
  provider: string;
  irn: string | null;
  ackNo: string | null;
  ackDt: string | null;
  signedQrCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  generatedAt: string | null;
  /** Why this bill can't be registered. Empty when it can. */
  reasons: string[];
  /** Whether the configured provider can reach the portal on its own. */
  automatic: boolean;
}

/** Load the invoice in the shape the payload builder wants. */
async function loadDoc(invoiceId: string) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, receiptNo: true, source: true, status: true, createdAt: true,
      discountAmount: true, taxableAmount: true, cgstAmount: true,
      sgstAmount: true, totalAmount: true,
      buyerGstin: true, buyerLegalName: true, buyerAddress: true, buyerStateCode: true,
      items: { select: { description: true, hsnSac: true, qty: true, unitPrice: true, amount: true, gstRatePct: true } },
      eInvoice: true,
    },
  });
  if (!inv) throw new ApiError(404, "Invoice not found");
  return inv;
}

type LoadedInvoice = Awaited<ReturnType<typeof loadDoc>>;

const num = (v: { toString(): string }) => Number(v.toString());

function toSourceDoc(inv: LoadedInvoice): EInvoiceSourceDoc {
  const isService = SOURCE_IS_SERVICE[inv.source] ?? true;
  return {
    receiptNo: inv.receiptNo,
    invoiceDate: inv.createdAt,
    discountAmount: num(inv.discountAmount),
    taxableAmount: num(inv.taxableAmount),
    cgstAmount: num(inv.cgstAmount),
    sgstAmount: num(inv.sgstAmount),
    totalAmount: num(inv.totalAmount),
    lines: inv.items.map((i) => ({
      description: i.description,
      hsnSac: i.hsnSac,
      qty: i.qty,
      unitPrice: num(i.unitPrice),
      amount: num(i.amount),
      gstRatePct: num(i.gstRatePct),
      isService,
    })),
  };
}

function toBuyer(inv: LoadedInvoice): EInvoiceBuyer | null {
  if (!inv.buyerGstin) return null;
  return {
    gstin: inv.buyerGstin,
    legalName: inv.buyerLegalName ?? "",
    address: inv.buyerAddress,
    stateCode: inv.buyerStateCode || stateCodeOfGstin(inv.buyerGstin),
  };
}

async function loadSeller(): Promise<{ seller: EInvoiceSeller | null; enabled: boolean; provider: string }> {
  const c = await prisma.hospitalConfig.findFirst();
  if (!c) return { seller: null, enabled: false, provider: "MANUAL" };
  return {
    enabled: c.eInvoiceEnabled,
    provider: c.eInvoiceProvider,
    seller: c.gstin
      ? {
          gstin: c.gstin, legalName: c.legalName, addressLine: c.addressLine,
          city: c.city, stateCode: c.stateCode, pincode: c.pincode,
          phone: c.phone, email: c.email,
        }
      : null,
  };
}

/**
 * Where this bill stands, and whether it could be registered at all.
 *
 * Answers for ANY invoice, including the overwhelming majority that will never
 * need an IRN - those come back NOT_APPLICABLE with the reasons spelled out,
 * which is what a billing clerk asking "why is there no QR on this?" needs.
 */
export async function eInvoiceStatus(invoiceId: string): Promise<EInvoiceDTO> {
  const inv = await loadDoc(invoiceId);
  const { seller, enabled, provider } = await loadSeller();
  const adapter = irpAdapterFor(provider);
  const existing = inv.eInvoice;

  const reasons: string[] = [];
  if (!enabled) reasons.push("e-Invoicing is switched off for this hospital.");
  if (inv.status === "CANCELLED") reasons.push("This bill is cancelled.");
  if (!seller) reasons.push("The hospital's GSTIN is not set.");
  if (seller) reasons.push(...checkEligibility(toSourceDoc(inv), seller, toBuyer(inv)).reasons);

  const base = {
    provider: existing?.provider ?? provider,
    irn: existing?.irn ?? null,
    ackNo: existing?.ackNo ?? null,
    ackDt: existing?.ackDt?.toISOString() ?? null,
    signedQrCode: existing?.signedQrCode ?? null,
    errorCode: existing?.errorCode ?? null,
    errorMessage: existing?.errorMessage ?? null,
    cancelledAt: existing?.cancelledAt?.toISOString() ?? null,
    cancelReason: existing?.cancelReason ?? null,
    generatedAt: existing?.generatedAt?.toISOString() ?? null,
    reasons,
    automatic: adapter.automatic,
  };

  // A registered invoice keeps its status even if the bill would no longer
  // qualify today - history is not re-judged by today's configuration.
  if (existing && (existing.status === "GENERATED" || existing.status === "CANCELLED")) {
    return { ...base, status: existing.status, reasons: [] };
  }
  if (reasons.length > 0) return { ...base, status: "NOT_APPLICABLE" };
  return { ...base, status: existing?.status ?? "PENDING" };
}

/** The exact document that would be sent. Shown to the accountant registering by hand. */
export async function eInvoicePayloadFor(invoiceId: string): Promise<unknown> {
  const inv = await loadDoc(invoiceId);
  const { seller } = await loadSeller();
  const buyer = toBuyer(inv);
  if (!seller) throw new ApiError(400, "The hospital's GSTIN is not set.");
  if (!buyer) throw new ApiError(400, "This bill has no registered buyer, so it is out of scope for e-invoicing.");
  try {
    return buildEInvoicePayload(toSourceDoc(inv), seller, buyer);
  } catch (e) {
    if (e instanceof EInvoiceIneligibleError) throw new ApiError(400, e.reasons.join(" "));
    throw e;
  }
}

/** Record the party a bill is raised TO, which is what makes it B2B. */
export async function setInvoiceBuyer(
  actor: AuthUser,
  invoiceId: string,
  buyer: { gstin: string; legalName: string; address?: string | null; stateCode?: string | null } | null,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<EInvoiceDTO> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true, eInvoice: { select: { status: true } } },
  });
  if (!inv) throw new ApiError(404, "Invoice not found");
  // Once the portal holds a copy, the buyer on it is fixed. Changing it here
  // would put our record and the government's out of step, and only a
  // cancellation-and-reissue can legitimately change a registered invoice.
  if (inv.eInvoice?.status === "GENERATED") {
    throw new ApiError(400, "This bill is already registered. Cancel the IRN before changing the buyer.");
  }

  if (buyer && !isValidGstin(buyer.gstin)) {
    throw new ApiError(400, `"${buyer.gstin}" is not a valid GSTIN.`);
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: buyer
      ? {
          buyerGstin: buyer.gstin.trim().toUpperCase(),
          buyerLegalName: buyer.legalName.trim(),
          buyerAddress: buyer.address?.trim() || null,
          buyerStateCode: buyer.stateCode?.trim() || stateCodeOfGstin(buyer.gstin),
        }
      : { buyerGstin: null, buyerLegalName: null, buyerAddress: null, buyerStateCode: null },
  });

  await logAudit(actor, {
    action: buyer ? "INVOICE_BUYER_SET" : "INVOICE_BUYER_CLEARED",
    targetTable: "Invoice", targetId: invoiceId,
    meta: buyer ? { gstin: buyer.gstin, legalName: buyer.legalName } : {},
    ...ctx,
  });

  return eInvoiceStatus(invoiceId);
}

/**
 * Submit the bill to the portal through the configured provider.
 *
 * A rejection is persisted, not thrown: the error code is the thing that tells
 * an accountant what to fix, and it belongs on the record next to the invoice
 * rather than in a toast that disappears.
 */
export async function generateEInvoice(
  actor: AuthUser,
  invoiceId: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<EInvoiceDTO> {
  const status = await eInvoiceStatus(invoiceId);
  if (status.status === "GENERATED") throw new ApiError(400, "This bill already has an IRN.");
  if (status.status === "NOT_APPLICABLE") throw new ApiError(400, status.reasons.join(" "));

  const inv = await loadDoc(invoiceId);
  const { seller, provider } = await loadSeller();
  const buyer = toBuyer(inv);
  if (!seller || !buyer) throw new ApiError(400, "Seller or buyer details are incomplete.");

  const payload = buildEInvoicePayload(toSourceDoc(inv), seller, buyer);
  const result = await irpAdapterFor(provider).generate(payload);

  const common = { provider, payloadJson: JSON.stringify(payload) };

  if (!result.ok) {
    await prisma.eInvoice.upsert({
      where: { invoiceId },
      create: { invoiceId, ...common, status: "FAILED", errorCode: result.errorCode, errorMessage: result.errorMessage },
      update: { ...common, status: "FAILED", errorCode: result.errorCode, errorMessage: result.errorMessage },
    });
    await logAudit(actor, {
      action: "EINVOICE_FAILED", targetTable: "Invoice", targetId: invoiceId,
      meta: { errorCode: result.errorCode, errorMessage: result.errorMessage }, ...ctx,
    });
    return eInvoiceStatus(invoiceId);
  }

  await prisma.eInvoice.upsert({
    where: { invoiceId },
    create: {
      invoiceId, ...common, status: "GENERATED",
      irn: result.irn, ackNo: result.ackNo, ackDt: result.ackDt,
      signedQrCode: result.signedQrCode, signedInvoice: result.signedInvoice ?? null,
      errorCode: null, errorMessage: null,
      generatedById: actor.id, generatedAt: new Date(),
    },
    update: {
      ...common, status: "GENERATED",
      irn: result.irn, ackNo: result.ackNo, ackDt: result.ackDt,
      signedQrCode: result.signedQrCode, signedInvoice: result.signedInvoice ?? null,
      errorCode: null, errorMessage: null,
      generatedById: actor.id, generatedAt: new Date(),
    },
  });
  await logAudit(actor, {
    action: "EINVOICE_GENERATED", targetTable: "Invoice", targetId: invoiceId,
    meta: { irn: result.irn, ackNo: result.ackNo, provider }, ...ctx,
  });
  return eInvoiceStatus(invoiceId);
}

/**
 * Record an IRN obtained outside this system.
 *
 * The path for the MANUAL provider, and the fallback whenever a GSP is down and
 * the accountant registers on the portal directly. The IRN is stored exactly as
 * given - it is a hash, and a "cleaned up" one is a wrong one.
 */
export async function recordEInvoice(
  actor: AuthUser,
  invoiceId: string,
  input: { irn: string; ackNo: string; ackDt: string; signedQrCode: string; signedInvoice?: string | null },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<EInvoiceDTO> {
  const inv = await loadDoc(invoiceId);
  if (inv.eInvoice?.status === "GENERATED") throw new ApiError(400, "This bill already has an IRN.");

  const irn = input.irn.trim();
  // The portal's IRN is a SHA-256 hex digest. Anything else is a paste error,
  // and catching it here stops a bad IRN being printed on a legal document.
  if (!/^[a-fA-F0-9]{64}$/.test(irn)) {
    throw new ApiError(400, "An IRN is 64 hexadecimal characters. Check what was pasted.");
  }
  const ackDt = new Date(input.ackDt);
  if (Number.isNaN(ackDt.getTime())) throw new ApiError(400, "The acknowledgement date isn't a valid date.");

  const clash = await prisma.eInvoice.findUnique({ where: { irn }, select: { invoiceId: true } });
  if (clash && clash.invoiceId !== invoiceId) {
    throw new ApiError(400, "That IRN is already recorded against another bill.");
  }

  const data = {
    status: "GENERATED" as const,
    provider: "MANUAL",
    irn,
    ackNo: input.ackNo.trim(),
    ackDt,
    signedQrCode: input.signedQrCode.trim(),
    signedInvoice: input.signedInvoice?.trim() || null,
    errorCode: null,
    errorMessage: null,
    generatedById: actor.id,
    generatedAt: new Date(),
  };
  await prisma.eInvoice.upsert({ where: { invoiceId }, create: { invoiceId, ...data }, update: data });

  await logAudit(actor, {
    action: "EINVOICE_RECORDED", targetTable: "Invoice", targetId: invoiceId,
    meta: { irn, ackNo: data.ackNo }, ...ctx,
  });
  return eInvoiceStatus(invoiceId);
}

/**
 * Cancel a registered invoice at the portal.
 *
 * The 24-hour limit is the government's, not ours, and it is hard: after that
 * window the only remedy is a credit note. We check it before calling out so
 * the user gets a straight answer instead of an opaque portal error code.
 */
export async function cancelEInvoice(
  actor: AuthUser,
  invoiceId: string,
  input: { reason: string; remarks?: string; manual?: boolean },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<EInvoiceDTO> {
  const rec = await prisma.eInvoice.findUnique({ where: { invoiceId } });
  if (!rec || rec.status !== "GENERATED" || !rec.irn) {
    throw new ApiError(400, "This bill has no active IRN to cancel.");
  }
  if (!input.reason?.trim()) throw new ApiError(400, "A cancellation reason is required.");

  const generatedAt = rec.generatedAt ?? rec.createdAt;
  if (Date.now() - generatedAt.getTime() > 24 * 60 * 60 * 1000) {
    throw new ApiError(
      400,
      "An IRN can only be cancelled within 24 hours of generation. Raise a credit note instead."
    );
  }

  // `manual` covers the case where the accountant already cancelled on the
  // portal and is recording the fact here.
  if (!input.manual) {
    const res = await irpAdapterFor(rec.provider).cancel(rec.irn, input.reason, input.remarks);
    if (!res.ok) throw new ApiError(400, res.errorMessage ?? "The portal refused the cancellation.");
  }

  await prisma.eInvoice.update({
    where: { invoiceId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason.trim() },
  });
  await logAudit(actor, {
    action: "EINVOICE_CANCELLED", targetTable: "Invoice", targetId: invoiceId,
    meta: { irn: rec.irn, reason: input.reason, manual: !!input.manual }, ...ctx,
  });
  return eInvoiceStatus(invoiceId);
}
