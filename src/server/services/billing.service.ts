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
        payer: input.payer ?? "SELF_PAY",
        // Only meaningful on an insurance bill. Cleared otherwise rather than
        // stored-and-ignored, so nothing downstream can print an insurer's name
        // across a bill the family paid in cash.
        payerName: input.payer === "INSURANCE" ? input.payerName?.trim() || null : null,
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
