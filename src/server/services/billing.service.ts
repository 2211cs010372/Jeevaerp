import { prisma } from "@/lib/prisma";
import { computeInvoiceTotals, assertRefundable, assertPaymentsWithinTotal, invoiceStatusFrom, netPaid, totalRefunded, refundable, r2 } from "@/server/billing/calc";
import { nextId } from "@/lib/ids";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma, PaymentMode } from "@prisma/client";

/**
 * Money is handled in paise-precision decimals via string math to avoid float
 * drift. Prisma Decimal accepts strings, so we build strings and let Postgres
 * store exact numeric(10,2).
 */
// r2 comes from @/server/billing/calc - one rounding definition, not two.
const s2 = (n: number) => r2(n).toFixed(2);

export type InvoiceSourceT = "CONSULTATION" | "LAB" | "PHARMACY" | "IPD" | "OTHER";
export type PaymentModeT = "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER";
export type PayerTypeT = "SELF_PAY" | "INSURANCE";

/**
 * The IPD discharge applies the admission deposit as a payment against the final
 * bill. It stamps that payment with this reference so the printed invoice can
 * tell the deposit apart from money taken at the counter and show it as an
 * explicit deduction. One prefix, written and matched in one place, so the two
 * halves can never drift.
 */
export const ADVANCE_REF_PREFIX = "Advance taken at admission";
export const advancePaymentRef = (ipNumber: string) => `${ADVANCE_REF_PREFIX} (${ipNumber})`;

/** One tender against a bill. A split (part cash, part UPI) is just several. */
export interface PaymentInput { mode: PaymentModeT; amount: number; reference?: string }

export interface BillLineInput {
  description: string;
  qty?: number;
  unitPrice: number;
  /** GST % for this line. 0 = exempt (diagnostics). Medicines are 5% or 12%. */
  gstRatePct?: number;
  hsnSac?: string;
  labTestId?: string;
  /** Pharmacy line -> the exact batch dispensed (full traceability). */
  batchId?: string;
}

export interface InvoiceDTO {
  id: string;
  receiptNo: string;
  source: string;
  status: string;
  createdAt: string;
  /** SELF_PAY (money at a counter) or INSURANCE (billed to an insurer/TPA). */
  payer: string;
  /** The insurer/TPA, when `payer` is INSURANCE. */
  payerName: string | null;
  patient: { displayId: string; fullName: string; phone: string; address: string | null; age: number | null; gender: string | null };
  items: { description: string; hsnSac: string | null; qty: number; unitPrice: string; amount: string; gstRatePct: string }[];
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  totalAmount: string;
  amountPaid: string;
  /** Of `amountPaid`, the part that was an IPD advance held from admission. Lets
   *  the printed bill show "less advance → balance to be paid" explicitly rather
   *  than folding the deposit invisibly into one "Paid" figure. 0 for non-IPD. */
  advanceAdjusted: string;
  balanceDue: string;
  payments: { mode: string; amount: string; reference: string | null; createdAt: string }[];
  hospital: {
    legalName: string; addressLine: string; city: string; state: string;
    stateCode: string; pincode: string; gstin: string | null; phone: string | null;
  } | null;
  /** The registered buyer, when this bill is B2B rather than to the patient. */
  buyer: { gstin: string; legalName: string; address: string | null; stateCode: string | null } | null;
  /**
   * The government's registration of this bill, when it has one. Present only
   * on a live IRN - a failed or cancelled one prints nothing, because a QR on a
   * bill is a claim that the supply is registered.
   */
  eInvoice: { irn: string; ackNo: string | null; ackDt: string | null; signedQrCode: string | null } | null;
}

/**
 * Creates an invoice with GST split. For intra-state supply (hospital and
 * patient both in Telangana) GST splits equally into CGST + SGST - this is how
 * Indian GST invoices must show it. A 0% line (exempt) contributes zero tax,
 * which is the correct behaviour for most diagnostic services.
 */
export async function createInvoice(
  actor: AuthUser,
  input: {
    patientId: string;
    source: InvoiceSourceT;
    appointmentId?: string;
    /** Pharmacy bills link back to the scanned prescription they fulfil. */
    prescriptionUploadId?: string;
    /** IPD discharge bills link back to the admission. */
    admissionId?: string;
    lines: BillLineInput[];
    discountAmount?: number;
    notes?: string;
    /**
     * How this bill gets settled. Defaults to SELF_PAY, so every existing caller
     * - the OP counter, the lab, the pharmacy - keeps raising ordinary counter
     * bills without knowing this parameter exists.
     *
     * INSURANCE does NOT forbid a tender below. A cashless patient still pays the
     * non-medical extras and any co-pay at the desk, and that money is genuinely
     * in the drawer: it counts on the day close as collected while the bill itself
     * is reported under insurance. Both halves are true and both are shown.
     */
    payer?: PayerTypeT;
    /** Insurer/TPA name, snapshotted onto the bill. Ignored unless payer is INSURANCE. */
    payerName?: string;
    /** Optionally record a payment immediately (walk-in pays at the counter). */
    payment?: PaymentInput;
    /**
     * A split settlement - part cash, part UPI, etc. Recorded as several Payment
     * rows against the one bill. Takes precedence over `payment` when present.
     */
    payments?: PaymentInput[];
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<InvoiceDTO> {
  if (!input.lines.length) throw new ApiError(400, "Add at least one item to the bill");

  const invoiceId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const patient = await tx.patient.findUnique({
      where: { id: input.patientId },
      select: { id: true, mergedIntoId: true, deletedAt: true },
    });
    if (!patient || patient.mergedIntoId || patient.deletedAt) throw new ApiError(404, "Patient not found");

    // ── A BILL AGAINST A STAY INHERITS THAT STAY'S PAYER ──
    //
    // The pharmacy and the lab raise their own invoices for an inpatient and
    // link them to the admission (see pharmacy.service / labs.service). They
    // have no idea who is paying for the stay, so they raised every one of them
    // as SELF_PAY - which meant a cashless patient's medicines and tests showed
    // up at discharge as "still to collect", and a family who had been promised
    // cashless was asked for them at the counter. Meanwhile the insurer was
    // never billed for them at all: they were on nobody's claim.
    //
    // Inheriting here rather than at each caller is the point. There are three
    // places that bill an inpatient and there will be more, and the one thing
    // they all already know is the admission.
    //
    // An explicit `payer` still wins - the IPD discharge passes its own, and a
    // caller that deliberately bills a self-payer inside an insurance stay
    // (a non-covered extra, say) must be able to say so.
    let payer = input.payer;
    let payerName = input.payerName;
    if (!payer && input.admissionId) {
      const adm = await tx.admission.findUnique({
        where: { id: input.admissionId },
        select: { payerType: true, insurer: true },
      });
      if (adm) {
        payer = adm.payerType;
        payerName = adm.insurer ?? undefined;
      }
    }

    // ---- compute totals ----
    // The arithmetic lives in a pure function so it can be unit-tested without a
    // database. Do not inline it back in here.
    let totals;
    try {
      totals = computeInvoiceTotals(input.lines, input.discountAmount ?? 0);
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Invalid bill");
    }
    const { items, subtotal, discount, taxable, cgst, sgst, total } = totals;

    const receiptNo = await nextId("INVOICE", { tx });

    const invoice = await tx.invoice.create({
      data: {
        receiptNo,
        patientId: input.patientId,
        source: input.source,
        appointmentId: input.appointmentId ?? null,
        prescriptionUploadId: input.prescriptionUploadId ?? null,
        admissionId: input.admissionId ?? null,
        payer: payer ?? "SELF_PAY",
        // Only meaningful on an insurance bill. Cleared otherwise rather than
        // stored-and-ignored, so nothing downstream can print an insurer's name
        // across a bill the family paid in cash.
        payerName: payer === "INSURANCE" ? payerName?.trim() || null : null,
        subtotal: s2(subtotal),
        discountAmount: s2(discount),
        taxableAmount: s2(taxable),
        cgstAmount: s2(cgst),
        sgstAmount: s2(sgst),
        totalAmount: s2(total),
        notes: input.notes?.trim() || null,
        status: "PENDING",
        createdById: actor.id,
        items: {
          create: items.map((it) => ({
            description: it.description,
            hsnSac: it.hsnSac ?? null,
            qty: it.qty,
            unitPrice: s2(it.unitPrice),
            amount: s2(it.amount),
            gstRatePct: s2(it.gstRatePct),
            labTestId: it.labTestId ?? null,
            batchId: it.batchId ?? null,
          })),
        },
      },
      select: { id: true },
    });

    // optional immediate payment - one tender, or a split (part cash, part UPI).
    // `payments` (plural) wins when given; otherwise fall back to the single
    // `payment`. Zero-amount legs are dropped so an unused split box adds nothing.
    const tenders = (input.payments?.length ? input.payments : input.payment ? [input.payment] : [])
      .filter((p) => p && p.amount > 0);
    if (tenders.length) {
      try {
        assertPaymentsWithinTotal(total, tenders);
      } catch (e) {
        throw new ApiError(400, e instanceof Error ? e.message : "Invalid payment");
      }
      await tx.payment.createMany({
        data: tenders.map((p) => ({
          invoiceId: invoice.id,
          mode: p.mode,
          amount: s2(p.amount),
          reference: p.reference?.trim() || null,
          receivedById: actor.id,
        })),
      });
      const paid = tenders.reduce((s, p) => r2(s + p.amount), 0);
      const status = paid >= total - 0.01 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "PENDING";
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status, paidAt: status === "PAID" ? new Date() : null },
      });
    }

    await logAudit(
      actor,
      { action: "INVOICE_CREATED", targetTable: "Invoice", targetId: invoice.id, meta: { receiptNo, source: input.source, total: s2(total) }, ...ctx },
      tx
    );

    return invoice.id;
  });

  return getInvoice(invoiceId);
}

/**
 * Record one or more tenders against an existing invoice; recomputes status.
 * Passing several `payments` settles the balance as a split (part cash, part
 * UPI) in a single motion - each becomes its own Payment row, exactly as if
 * they had been taken one after another.
 */
export async function recordPayments(
  actor: AuthUser,
  input: { invoiceId: string; payments: PaymentInput[] },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<InvoiceDTO> {
  const tenders = input.payments.filter((p) => p && p.amount > 0);
  if (!tenders.length) throw new ApiError(400, "Enter a payment amount");

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const inv = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, totalAmount: true, status: true, payments: { select: { amount: true } }, refunds: { select: { amount: true } } },
    });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status === "CANCELLED") throw new ApiError(400, "This invoice was cancelled");

    const alreadyPaid = netPaid(
      inv.payments.map((x: { amount: { toString(): string } }) => ({ amount: Number(x.amount.toString()) })),
      (inv.refunds ?? []).map((x: { amount: { toString(): string } }) => ({ amount: Number(x.amount.toString()) }))
    );
    const total = Number(inv.totalAmount.toString());
    const adding = tenders.reduce((s, p) => r2(s + p.amount), 0);
    const newPaid = r2(alreadyPaid + adding);
    if (newPaid > total + 0.01) throw new ApiError(400, "Payment exceeds the balance due");

    await tx.payment.createMany({
      data: tenders.map((p) => ({
        invoiceId: inv.id,
        mode: p.mode,
        amount: s2(p.amount),
        reference: p.reference?.trim() || null,
        receivedById: actor.id,
      })),
    });

    const status = newPaid >= total - 0.01 ? "PAID" : "PARTIALLY_PAID";
    await tx.invoice.update({
      where: { id: inv.id },
      data: { status, paidAt: status === "PAID" ? new Date() : null },
    });

    await logAudit(
      actor,
      {
        action: "PAYMENT_RECORDED", targetTable: "Invoice", targetId: inv.id,
        meta: { amount: s2(adding), mode: tenders.map((t) => t.mode).join("+") },
        ...ctx,
      },
      tx
    );
  });

  // Money taken is the signal that clears a due. The pharmacy's dues list, the
  // ward's outstanding panel, and every day-close on screen are all stale now -
  // and a discharge may have just become possible.
  await publishLive(
    [TOPICS.PHARMACY, TOPICS.LABS, TOPICS.RECEPTION, TOPICS.IPD, TOPICS.ADMIN],
    EVENTS.PAYMENT_TAKEN
  );
  return getInvoice(input.invoiceId);
}

/** Record a single payment against an existing invoice. Thin wrapper over the
 *  split-capable path so callers taking exactly one tender stay simple. */
export async function recordPayment(
  actor: AuthUser,
  input: { invoiceId: string; mode: PaymentModeT; amount: number; reference?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<InvoiceDTO> {
  return recordPayments(
    actor,
    { invoiceId: input.invoiceId, payments: [{ mode: input.mode, amount: input.amount, reference: input.reference }] },
    ctx
  );
}

/** Full invoice for printing / display (includes hospital GST header). */
export async function getInvoice(invoiceId: string): Promise<InvoiceDTO> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, receiptNo: true, source: true, status: true, createdAt: true,
      payer: true, payerName: true,
      subtotal: true, discountAmount: true, taxableAmount: true,
      cgstAmount: true, sgstAmount: true, totalAmount: true,
      buyerGstin: true, buyerLegalName: true, buyerAddress: true, buyerStateCode: true,
      patient: { select: { displayId: true, fullName: true, phone: true, address: true, age: true, gender: true } },
      items: { select: { description: true, hsnSac: true, qty: true, unitPrice: true, amount: true, gstRatePct: true } },
      payments: { select: { mode: true, amount: true, reference: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      refunds: { select: { mode: true, amount: true, reason: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      // signedInvoice is deliberately NOT selected - it is a large JWT nobody
      // prints, and this query runs on every bill view.
      eInvoice: { select: { status: true, irn: true, ackNo: true, ackDt: true, signedQrCode: true } },
    },
  });
  if (!inv) throw new ApiError(404, "Invoice not found");

  const config = await prisma.hospitalConfig.findFirst();

  // NET of refunds. Summing payments alone would show a fully refunded bill as
  // PAID - and the money would be gone from the drawer but still on the books.
  const paid = netPaid(
    inv.payments.map((x: { amount: { toString(): string } }) => ({ amount: Number(x.amount.toString()) })),
    (inv.refunds ?? []).map((x: { amount: { toString(): string } }) => ({ amount: Number(x.amount.toString()) }))
  );
  const total = Number(inv.totalAmount.toString());

  // How much of what's been paid is the admission deposit carried over from the
  // ward, vs. money taken at this counter. Matched on the reference the discharge
  // stamps - see advancePaymentRef.
  const advanceAdjusted = inv.payments
    .filter((p: { reference: string | null }) => p.reference?.startsWith(ADVANCE_REF_PREFIX))
    .reduce((s: number, p: { amount: { toString(): string } }) => r2(s + Number(p.amount.toString())), 0);

  return {
    id: inv.id,
    receiptNo: inv.receiptNo,
    source: inv.source,
    status: inv.status,
    createdAt: inv.createdAt.toISOString(),
    payer: inv.payer,
    payerName: inv.payerName,
    patient: inv.patient,
    items: inv.items.map((i: { description: string; hsnSac: string | null; qty: number; unitPrice: { toString(): string }; amount: { toString(): string }; gstRatePct: { toString(): string } }) => ({
      description: i.description, hsnSac: i.hsnSac, qty: i.qty,
      unitPrice: i.unitPrice.toString(), amount: i.amount.toString(), gstRatePct: i.gstRatePct.toString(),
    })),
    subtotal: inv.subtotal.toString(),
    discountAmount: inv.discountAmount.toString(),
    taxableAmount: inv.taxableAmount.toString(),
    cgstAmount: inv.cgstAmount.toString(),
    sgstAmount: inv.sgstAmount.toString(),
    totalAmount: inv.totalAmount.toString(),
    amountPaid: s2(paid),
    advanceAdjusted: s2(advanceAdjusted),
    balanceDue: s2(Math.max(0, r2(total - paid))),
    payments: inv.payments.map((p: { mode: string; amount: { toString(): string }; reference: string | null; createdAt: Date }) => ({
      mode: p.mode, amount: p.amount.toString(), reference: p.reference, createdAt: p.createdAt.toISOString(),
    })),
    hospital: config
      ? {
          legalName: config.legalName, addressLine: config.addressLine, city: config.city,
          state: config.state, stateCode: config.stateCode, pincode: config.pincode,
          gstin: config.gstin, phone: config.phone,
        }
      : null,
    buyer: inv.buyerGstin
      ? {
          gstin: inv.buyerGstin,
          legalName: inv.buyerLegalName ?? "",
          address: inv.buyerAddress,
          stateCode: inv.buyerStateCode,
        }
      : null,
    // Only a LIVE registration prints. A cancelled IRN must not carry a QR: the
    // QR is what a tax officer scans to confirm the supply was registered, and
    // showing one for a cancelled invoice would assert something untrue.
    eInvoice:
      inv.eInvoice?.status === "GENERATED" && inv.eInvoice.irn
        ? {
            irn: inv.eInvoice.irn,
            ackNo: inv.eInvoice.ackNo,
            ackDt: inv.eInvoice.ackDt?.toISOString() ?? null,
            signedQrCode: inv.eInvoice.signedQrCode,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Invoice amendment. A tax invoice is a legal document: we allow free edits
// only while it is UNPAID and has no payments. Once money has been taken the
// invoice can only be CANCELLED (kept forever, never deleted) and reissued.
// This preserves the audit trail instead of silently rewriting history.
// ---------------------------------------------------------------------------

/** Replace the line items / discount of an invoice that has NOT been paid. */
export async function updateInvoice(
  actor: AuthUser,
  input: { invoiceId: string; lines: BillLineInput[]; discountAmount?: number; notes?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<InvoiceDTO> {
  if (!input.lines.length) throw new ApiError(400, "An invoice needs at least one item");

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const inv = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, status: true, payments: { select: { id: true } } },
    });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status === "CANCELLED") throw new ApiError(400, "This invoice was cancelled and can't be edited");
    if (inv.payments.length > 0 || inv.status === "PAID" || inv.status === "PARTIALLY_PAID") {
      throw new ApiError(400, "A paid invoice can't be edited. Cancel it and issue a new one.");
    }

    // recompute
    let subtotal = 0;
    const items = input.lines.map((l) => {
      const qty = l.qty && l.qty > 0 ? l.qty : 1;
      const amount = r2(qty * l.unitPrice);
      subtotal = r2(subtotal + amount);
      return { ...l, qty, amount, gstRatePct: l.gstRatePct ?? 0 };
    });
    const discount = r2(input.discountAmount ?? 0);
    if (discount > subtotal) throw new ApiError(400, "Discount can't exceed the bill amount");

    const ratio = subtotal > 0 ? discount / subtotal : 0;
    let taxable = 0, cgst = 0, sgst = 0;
    for (const it of items) {
      const after = r2(it.amount * (1 - ratio));
      taxable = r2(taxable + after);
      const tax = r2((after * it.gstRatePct) / 100);
      cgst = r2(cgst + tax / 2);
      sgst = r2(sgst + tax / 2);
    }
    const total = r2(taxable + cgst + sgst);

    // swap the items wholesale (receiptNo is preserved - same invoice, corrected)
    await tx.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        subtotal: s2(subtotal), discountAmount: s2(discount), taxableAmount: s2(taxable),
        cgstAmount: s2(cgst), sgstAmount: s2(sgst), totalAmount: s2(total),
        notes: input.notes?.trim() || null,
        items: {
          create: items.map((it) => ({
            description: it.description, hsnSac: it.hsnSac ?? null, qty: it.qty,
            unitPrice: s2(it.unitPrice), amount: s2(it.amount), gstRatePct: s2(it.gstRatePct),
            labTestId: it.labTestId ?? null,
          })),
        },
      },
    });

    await logAudit(actor, { action: "INVOICE_EDITED", targetTable: "Invoice", targetId: inv.id, meta: { newTotal: s2(total) }, ...ctx }, tx);
  });

  return getInvoice(input.invoiceId);
}

/**
 * Cancel an invoice. Never deleted - status flips to CANCELLED and it stays in
 * the ledger forever. Any lab tests on it are released so they can be re-billed.
 */
export async function cancelInvoice(
  actor: AuthUser,
  input: { invoiceId: string; reason: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<InvoiceDTO> {
  if (!input.reason?.trim()) throw new ApiError(400, "A cancellation reason is required");

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const inv = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, status: true, notes: true },
    });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status === "CANCELLED") throw new ApiError(400, "This invoice is already cancelled");

    // Release the lab tests so they can be billed again on a corrected invoice.
    await tx.invoiceItem.updateMany({ where: { invoiceId: inv.id }, data: { labTestId: null } });

    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        notes: [inv.notes, `CANCELLED: ${input.reason.trim()}`].filter(Boolean).join(" | "),
      },
    });

    await logAudit(actor, { action: "INVOICE_CANCELLED", targetTable: "Invoice", targetId: inv.id, meta: { reason: input.reason.trim() }, ...ctx }, tx);
  });

  return getInvoice(input.invoiceId);
}

/** Recent invoices for the billing list (filterable by source). */
export async function listInvoices(source?: InvoiceSourceT, limit = 50): Promise<{
  id: string; receiptNo: string; source: string; status: string; totalAmount: string;
  amountPaid: string; refunded: string; refundable: string;
  /** Distinct payment types used on this bill: [] unpaid, ["CASH"], or ["CASH","UPI"] for a split. */
  paymentModes: string[];
  /**
   * How the bill settles. SELF_PAY reads off `paymentModes`; INSURANCE is its own
   * answer to that question and is why an empty `paymentModes` is not always the
   * same as "not paid yet".
   */
  payer: string;
  payerName: string | null;
  createdAt: string; patient: { displayId: string; fullName: string };
}[]> {
  const MODE_ORDER = ["CASH", "UPI", "CARD", "NETBANKING", "OTHER"];
  const rows = await prisma.invoice.findMany({
    where: source ? { source } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, receiptNo: true, source: true, status: true, totalAmount: true, createdAt: true,
      payer: true, payerName: true,
      patient: { select: { displayId: true, fullName: true } },
      payments: { select: { amount: true, mode: true } },
      refunds: { select: { amount: true } },
    },
  });
  return rows.map((i: {
    id: string; receiptNo: string; source: string; status: string;
    totalAmount: { toString(): string }; createdAt: Date;
    payer: string; payerName: string | null;
    patient: { displayId: string; fullName: string };
    payments: { amount: { toString(): string }; mode: string }[];
    refunds: { amount: { toString(): string } }[];
  }) => {
    const pays = i.payments.map((x) => ({ amount: Number(x.amount.toString()), mode: x.mode as string }));
    const refs = (i.refunds ?? []).map((x) => ({ amount: Number(x.amount.toString()) }));
    // Which tender types actually took money on this bill, in a stable order.
    const paymentModes = MODE_ORDER.filter((m) => pays.some((p) => p.mode === m && p.amount > 0));
    return {
      id: i.id, receiptNo: i.receiptNo, source: i.source, status: i.status,
      totalAmount: i.totalAmount.toString(),
      // NET. A fully refunded bill must not still read as paid.
      amountPaid: s2(netPaid(pays, refs)),
      refunded: s2(totalRefunded(refs)),
      // The desk should never have to work out the ceiling itself.
      refundable: s2(refundable(pays, refs)),
      paymentModes,
      payer: i.payer, payerName: i.payerName,
      createdAt: i.createdAt.toISOString(),
      patient: i.patient,
    };
  });
}

/**
 * REFUND - money going back across the counter.
 *
 * The single most dangerous operation in the whole ERP: it takes cash OUT of a
 * hospital. Every guard lives in `assertRefundable`, which is pure and tested,
 * and is called INSIDE the transaction so two clerks refunding the same bill at
 * once can't both succeed.
 *
 * A refund is NOT a negative payment. It has a reason, an authoriser, and it must
 * never be mistaken for income in a report.
 */
export async function refundInvoice(
  actor: AuthUser,
  input: { invoiceId: string; amount: number; mode: string; reason: string; reference?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ receiptNo: string; refunded: string; netPaid: string; status: string }> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const inv = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true, receiptNo: true, status: true, totalAmount: true, cancelledAt: true,
        payments: { select: { amount: true } },
        refunds: { select: { amount: true } },
      },
    });
    if (!inv) throw new ApiError(404, "Bill not found");

    const payments = inv.payments.map((x: { amount: { toString(): string } }) => ({ amount: Number(x.amount.toString()) }));
    const refunds = inv.refunds.map((x: { amount: { toString(): string } }) => ({ amount: Number(x.amount.toString()) }));

    try {
      assertRefundable(input.amount, input.reason, payments, refunds);
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Refund not allowed");
    }

    await tx.refund.create({
      data: {
        invoiceId: inv.id,
        // validated upstream against the PaymentMode values; narrow for Prisma
        mode: input.mode as PaymentMode,
        amount: r2(input.amount),
        reason: input.reason.trim(),
        reference: input.reference?.trim() || null,
        refundedById: actor.id,
      },
    });

    const after = [...refunds, { amount: r2(input.amount) }];
    const total = Number(inv.totalAmount.toString());
    const status = invoiceStatusFrom(total, payments, after, !!inv.cancelledAt);

    await tx.invoice.update({ where: { id: inv.id }, data: { status } });

    await logAudit(actor, {
      action: "INVOICE_REFUNDED",
      targetTable: "Invoice",
      targetId: inv.id,
      meta: { receiptNo: inv.receiptNo, amount: r2(input.amount), reason: input.reason.trim(), mode: input.mode },
      ...ctx,
    }, tx);

    return {
      receiptNo: inv.receiptNo,
      refunded: r2(input.amount).toFixed(2),
      netPaid: netPaid(payments, after).toFixed(2),
      status,
    };
  });
}

// ---------------------------------------------------------------------------
// DUES AT A COUNTER - who owes this counter money, grouped the way it collects.
// ---------------------------------------------------------------------------
//
// The pharmacy and the lab each bill inpatients on their own invoices, left
// unpaid until the family leaves. Both counters then need the same screen: what
// is still open, oldest first, ward before walk-in.
//
// ONE ROW PER INPATIENT, not one per invoice. A ward patient is dispensed to or
// sampled several times over a stay and each one is its own bill; listed
// individually, bed 12 was four separate rows, so the counter settled the one
// the family asked about and left three behind that nobody went looking for
// until the discharge desk refused to let them go. The list is read as "who owes
// us" and it was answering "which slips are open", which is a different
// question.
//
// Shared rather than written twice on purpose: the two counters had no reason to
// differ and every reason to drift if they were separate copies.

export interface CounterDue {
  invoiceId: string; receiptNo: string; createdAt: string;
  total: string; paid: string; due: string;
  patient: { id: string; displayId: string; fullName: string; phone: string | null };
  ipNumber: string | null; ward: string | null; bedNo: string | null;
  stillAdmitted: boolean;
  /** Enough of the first line to recognise the bill without opening it. */
  summary: string;
}

export interface CounterIpdDue {
  patient: { id: string; displayId: string; fullName: string; phone: string | null };
  ipNumber: string | null; ward: string | null; bedNo: string | null;
  stillAdmitted: boolean;
  bills: { invoiceId: string; receiptNo: string; due: string; createdAt: string; summary: string }[];
  billCount: number;
  due: string;
  /** The oldest open bill - what makes this row urgent. */
  oldestAt: string;
}

export interface CounterDues {
  dues: CounterDue[];
  /** Ward dues rolled up per patient - what the counter actually collects. */
  ipdByPatient: CounterIpdDue[];
  ipdCount: number;
  ipdTotal: string;
  count: number;
  totalDue: string;
}

/**
 * `source` omitted means EVERY counter - which is what the front desk needs. A
 * lab bill is settled at reception, not at the collection window, so the desk
 * has to be able to see and take a patient's lab and pharmacy dues together.
 */
export async function counterDues(source?: InvoiceSourceT): Promise<CounterDues> {
  const rows = await prisma.invoice.findMany({
    where: {
      ...(source ? { source } : { source: { in: ["LAB", "PHARMACY", "OTHER"] } }),
      status: { notIn: ["CANCELLED", "PAID"] },
      // A cashless bill is with the insurer, not with anybody at this counter.
      // Listing it here sends staff to chase a family who owes nothing.
      payer: "SELF_PAY",
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, receiptNo: true, createdAt: true, totalAmount: true,
      payments: { select: { amount: true } },
      refunds: { select: { amount: true } },
      patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
      items: { select: { description: true }, orderBy: { id: "asc" } },
      admission: {
        select: { ipNumber: true, status: true, bed: { select: { bedNo: true, ward: { select: { name: true } } } } },
      },
    },
  });

  const dues: CounterDue[] = [];
  for (const inv of rows) {
    const total = Number(inv.totalAmount);
    const paid = r2(
      inv.payments.reduce((s, x) => r2(s + Number(x.amount)), 0) -
      inv.refunds.reduce((s, x) => r2(s + Number(x.amount)), 0)
    );
    const due = r2(total - paid);
    // A rounding tail of a paisa is settled, not owed.
    if (due <= 0.01) continue;
    if (!inv.patient) continue;

    const first = inv.items[0];
    const more = inv.items.length - 1;
    dues.push({
      invoiceId: inv.id,
      receiptNo: inv.receiptNo,
      createdAt: inv.createdAt.toISOString(),
      total: total.toFixed(2), paid: paid.toFixed(2), due: due.toFixed(2),
      patient: inv.patient,
      ipNumber: inv.admission?.ipNumber ?? null,
      ward: inv.admission?.bed?.ward.name ?? null,
      bedNo: inv.admission?.bed?.bedNo ?? null,
      stillAdmitted: inv.admission?.status === "ADMITTED",
      summary: first ? `${first.description.split("·")[0].trim()}${more > 0 ? ` + ${more} more` : ""}` : "\u2014",
    });
  }

  // Ward bills first - a discharge is held up by those, a counter bill is not.
  dues.sort((a, b) => {
    if (a.stillAdmitted !== b.stillAdmitted) return a.stillAdmitted ? -1 : 1;
    if (!!a.ipNumber !== !!b.ipNumber) return a.ipNumber ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const ipd = dues.filter((d) => d.ipNumber !== null);

  // Grouped by the PATIENT rather than the admission: a re-admitted patient
  // still owes one person's worth of money, and it is collected once.
  const byPatient = new Map<string, CounterIpdDue>();
  for (const d of ipd) {
    const row = byPatient.get(d.patient.id) ?? {
      patient: d.patient, ipNumber: d.ipNumber, ward: d.ward, bedNo: d.bedNo,
      stillAdmitted: d.stillAdmitted, bills: [], billCount: 0, due: "0.00", oldestAt: d.createdAt,
    };
    row.bills.push({ invoiceId: d.invoiceId, receiptNo: d.receiptNo, due: d.due, createdAt: d.createdAt, summary: d.summary });
    row.billCount = row.bills.length;
    row.due = r2(Number(row.due) + Number(d.due)).toFixed(2);
    if (d.createdAt < row.oldestAt) row.oldestAt = d.createdAt;
    // Any live stay makes the row a ward row, whichever slip we are on.
    if (d.stillAdmitted) {
      row.stillAdmitted = true;
      row.ipNumber = d.ipNumber; row.ward = d.ward; row.bedNo = d.bedNo;
    }
    byPatient.set(d.patient.id, row);
  }
  const ipdByPatient = [...byPatient.values()].sort((a, b) => {
    if (a.stillAdmitted !== b.stillAdmitted) return a.stillAdmitted ? -1 : 1;
    return a.oldestAt.localeCompare(b.oldestAt);
  });

  return {
    dues,
    ipdByPatient,
    ipdCount: ipd.length,
    ipdTotal: ipd.reduce((s, d) => r2(s + Number(d.due)), 0).toFixed(2),
    count: dues.length,
    totalDue: dues.reduce((s, d) => r2(s + Number(d.due)), 0).toFixed(2),
  };
}

/**
 * SETTLE EVERYTHING A PATIENT OWES A COUNTER, IN ONE MOTION.
 *
 * A ward patient accumulates several bills over a stay and the family settles
 * them together - they hand over one amount, not one amount per slip. Paying
 * them one at a time is how three of four get settled and the fourth is found
 * at discharge.
 *
 * But each invoice is its own tax document and money has to land against a
 * specific one, so this does not invent a combined bill: it ALLOCATES the tender
 * across the open invoices, oldest first. Oldest first because that is the debt
 * most likely to be forgotten, and because a part-payment should clear whole old
 * bills rather than leave every bill part-paid.
 *
 * Tender modes are preserved exactly. ₹500 cash + ₹700 UPI across three bills
 * stays ₹500 of cash and ₹700 of UPI in the day close, split across whichever
 * invoices they land on - the drawer has to reconcile, and a mode invented here
 * would break it.
 */
export async function settleDues(
  actor: AuthUser,
  input: { patientId: string; source?: InvoiceSourceT; payments: PaymentInput[] },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ settled: { receiptNo: string; applied: string }[]; totalApplied: string }> {
  const tenders = input.payments.filter((p) => p && p.amount > 0);
  if (!tenders.length) throw new ApiError(400, "Enter a payment amount");

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const invoices = await tx.invoice.findMany({
      where: {
        patientId: input.patientId,
        ...(input.source ? { source: input.source } : {}),
        status: { notIn: ["CANCELLED", "PAID"] },
        // Never take a family's money against a bill that is with their insurer.
        payer: "SELF_PAY",
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, receiptNo: true, totalAmount: true,
        payments: { select: { amount: true } },
        refunds: { select: { amount: true } },
      },
    });

    const open = invoices
      .map((i) => ({
        id: i.id,
        receiptNo: i.receiptNo,
        total: Number(i.totalAmount),
        due: r2(
          Number(i.totalAmount) -
          netPaid(
            i.payments.map((p) => ({ amount: Number(p.amount) })),
            i.refunds.map((p) => ({ amount: Number(p.amount) }))
          )
        ),
      }))
      // A rounding tail of a paisa is settled, not owed.
      .filter((i) => i.due > 0.01);

    if (!open.length) throw new ApiError(409, "Nothing is outstanding for this patient");

    const totalDue = r2(open.reduce((s, i) => r2(s + i.due), 0));
    const offered = r2(tenders.reduce((s, t) => r2(s + t.amount), 0));
    if (offered > totalDue + 0.01) {
      throw new ApiError(400, `That is more than the ₹${totalDue.toFixed(2)} outstanding. Take the balance as a fresh bill, not as an overpayment.`);
    }

    // Draw from the tenders in the order they were given, so a split keeps its
    // shape: the cash is spent before the UPI, not smeared across every bill.
    const pool = tenders.map((t) => ({ mode: t.mode, reference: t.reference, left: t.amount }));
    const settled: { receiptNo: string; applied: string }[] = [];

    for (const inv of open) {
      let need = inv.due;
      let appliedHere = 0;
      for (const p of pool) {
        if (need <= 0.001) break;
        if (p.left <= 0.001) continue;
        const take = r2(Math.min(need, p.left));
        await tx.payment.create({
          data: {
            invoiceId: inv.id,
            mode: p.mode as PaymentMode,
            amount: s2(take),
            reference: p.reference?.trim() || null,
            receivedById: actor.id,
          },
        });
        p.left = r2(p.left - take);
        need = r2(need - take);
        appliedHere = r2(appliedHere + take);
      }
      if (appliedHere > 0) {
        await tx.invoice.update({
          where: { id: inv.id },
          data: {
            status: need <= 0.01 ? "PAID" : "PARTIALLY_PAID",
            paidAt: need <= 0.01 ? new Date() : null,
          },
        });
        settled.push({ receiptNo: inv.receiptNo, applied: s2(appliedHere) });
      }
      if (pool.every((p) => p.left <= 0.001)) break;
    }

    await logAudit(
      actor,
      {
        action: "DUES_SETTLED", targetTable: "Patient", targetId: input.patientId,
        meta: { source: input.source ?? "ALL", bills: settled.length, total: s2(offered) },
        ...ctx,
      },
      tx
    );

    return { settled, totalApplied: s2(offered) };
  });

  // A due clearing changes the discharge desk's answer, the counter's list and
  // the day close all at once.
  await publishLive([TOPICS.RECEPTION, TOPICS.PHARMACY, TOPICS.LABS, TOPICS.IPD, TOPICS.ADMIN], EVENTS.PAYMENT_TAKEN);
  return result;
}

/**
 * MOVE BILLS BACK OFF A CLAIM, ONTO THE PATIENT.
 *
 * The insurer said no. Or said yes to less than was asked. Either way somebody
 * still has to pay for the treatment, and until this existed there was no way
 * back: a bill marked INSURANCE is deliberately kept out of the dues lists and
 * out of every collection total, so a refused claim left the money sitting
 * against an insurer who had already declined it. Nobody was ever going to
 * collect it, and nothing on any screen said so.
 *
 * NOT AUTOMATIC ON REJECTION, and that is deliberate. A refused pre-auth is
 * argued with, re-documented and re-submitted all the time; flipping the bills
 * the moment a rejection is recorded would put a family into the dues list while
 * the desk is still on the phone to the TPA. Somebody decides, and their reason
 * is stored.
 *
 * Only bills with NO money on them move. If a co-pay was taken against a bill it
 * is already part self-paid and re-pointing it would misstate what was collected
 * and from whom.
 */
export async function revertBillsToSelfPay(
  actor: AuthUser,
  input: { admissionId: string; invoiceIds?: string[]; reason: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ moved: { receiptNo: string; total: string }[]; movedTotal: string; skipped: { receiptNo: string; why: string }[] }> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ApiError(400, "Say why this is going back to the patient");

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const adm = await tx.admission.findUnique({
      where: { id: input.admissionId },
      select: { id: true, ipNumber: true, insurer: true },
    });
    if (!adm) throw new ApiError(404, "Admission not found");

    const invoices = await tx.invoice.findMany({
      where: {
        admissionId: input.admissionId,
        payer: "INSURANCE",
        status: { not: "CANCELLED" },
        ...(input.invoiceIds?.length ? { id: { in: input.invoiceIds } } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, receiptNo: true, totalAmount: true, payments: { select: { amount: true } } },
    });
    if (!invoices.length) throw new ApiError(409, "There are no insurance bills on this stay to move");

    const moved: { receiptNo: string; total: string }[] = [];
    const skipped: { receiptNo: string; why: string }[] = [];

    for (const inv of invoices) {
      const taken = inv.payments.reduce((s, p) => r2(s + Number(p.amount)), 0);
      if (taken > 0.01) {
        skipped.push({ receiptNo: inv.receiptNo, why: `₹${taken.toFixed(2)} was already taken against it` });
        continue;
      }
      await tx.invoice.update({
        where: { id: inv.id },
        // status is untouched: it was PENDING as an insurance bill and it is
        // PENDING as a patient bill. What changed is who is being asked.
        data: { payer: "SELF_PAY", payerName: null },
      });
      moved.push({ receiptNo: inv.receiptNo, total: Number(inv.totalAmount).toFixed(2) });
    }

    if (moved.length) {
      // On the stay's own record, not only in the audit log. The family will ask
      // why they are being billed for a stay they were told was cashless, and the
      // answer has to be somewhere the ward can read.
      await tx.admissionNote.create({
        data: {
          admissionId: adm.id,
          kind: "NURSING",
          body:
            `Billed to the patient instead of ${adm.insurer ?? "the insurer"}: ` +
            `${moved.map((m) => m.receiptNo).join(", ")}. Reason: ${reason}`,
          authorId: actor.id,
        },
      });
    }

    await logAudit(
      actor,
      {
        action: "BILLS_REVERTED_TO_SELF_PAY", targetTable: "Admission", targetId: adm.id,
        meta: {
          ipNumber: adm.ipNumber, insurer: adm.insurer, reason,
          moved: moved.map((m) => m.receiptNo), skipped: skipped.map((s) => s.receiptNo),
        },
        ...ctx,
      },
      tx
    );

    return {
      moved,
      movedTotal: s2(moved.reduce((s, m) => r2(s + Number(m.total)), 0)),
      skipped,
    };
  });

  // These bills have just become money somebody has to collect - every dues list
  // and every day close is now wrong until it hears this.
  await publishLive(
    [TOPICS.RECEPTION, TOPICS.PHARMACY, TOPICS.LABS, TOPICS.IPD, TOPICS.INSURANCE, TOPICS.ADMIN],
    EVENTS.INVOICE_RAISED
  );
  return result;
}
