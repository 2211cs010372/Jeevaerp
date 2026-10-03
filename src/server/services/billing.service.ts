import { prisma } from "@/lib/prisma";
import { computeInvoiceTotals, fitTendersToTotal, assertRefundable, assertPaymentsWithinTotal, invoiceStatusFrom, netPaid, totalRefunded, refundable, r2, resolveBillDate, BillDateError, assertTotalCoversCollected, billTrimsPaymentOnShortfall, InvoiceMathError, planPaymentTrim } from "@/server/billing/calc";
import { nextId } from "@/lib/ids";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import { notifyBillGenerated } from "./notify.service";
import { publishLive } from "@/server/realtime/publish";
import { splitInvoice, allocateCoverage } from "@/lib/insurance-split";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import { isAdvanceAdjustment, advanceReceiptNoFromRef } from "@/server/billing/advances";
import { minutesAgo, repeatWindowStart, type RepeatBlock } from "@/lib/repeat-guard";
import { isSettled, owed } from "@/lib/money-round";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma, PaymentMode } from "@prisma/client";
import { buildAdminBillsWhere, COUNTER_MODES, type AdminBillsQuery } from "@/lib/admin-bills-query";

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
 * The IPD discharge applies each admission deposit as a payment against the
 * final bill, stamped with a reference that names the deposit slip. Re-exported
 * here so the many call sites that already import it from this service keep
 * working; the rule itself lives in a Prisma-free module so the day close can
 * import it too, and so it can be tested without a database.
 */
export {
  ADVANCE_REF_PREFIX, advancePaymentRef, isAdvanceAdjustment, advanceReceiptNoFromRef,
} from "@/server/billing/advances";

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
  /** The stay this bill belongs to, or null for an OP/walk-in bill. A lab or
   *  pharmacy bill with one is on a running tab, where a test may be taken off
   *  even after collection - see updateInvoice's trim path. */
  admissionId: string | null;
  status: string;
  /** When the row was actually written. What the day close and GST returns count. */
  createdAt: string;
  /**
   * The corrected date this bill PRINTS, or null if nobody has corrected it.
   *
   * Never substituted for createdAt in this DTO - both are here, so a screen that
   * needs the real clock still has it and a sheet that needs the printed date
   * does not have to guess which one it is holding.
   */
  billDate: string | null;
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
  /**
   * The same money as `advanceAdjusted`, but ONE ROW PER DEPOSIT SLIP.
   *
   * A family that paid twice holds two receipts, and a bill showing a single
   * "Less: Advance ₹8,000" cannot be tied back to either of them - which is the
   * conversation at the counter that nobody can settle. So each deposit prints
   * its own line, with the number on the slip in their hand.
   *
   * `receiptNo` is null only for advances taken before the slips were numbered.
   */
  advanceLines: { receiptNo: string | null; mode: string; amount: string; at: string }[];
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
     * The date the sheet prints, when it is not today - a bill raised now for
     * something given during a stay. Already validated by the caller (see
     * resolveBillDate). Day close and GST still count the bill on createdAt.
     */
    billDate?: Date;
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
    /**
     * Text the patient that this bill exists. Defaults ON, because this is the
     * single place every counter's bill passes through and a per-counter opt-in
     * would guarantee one of them is forgotten.
     *
     * Pass false where a bill is one half of an event the patient is already
     * being told about - the IPD discharge is the case that exists today, where
     * the final bill and the discharge are one moment and two texts would be
     * two charges for one piece of news.
     */
    notify?: boolean;
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
        billDate: input.billDate ?? null,
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
    const tenders = fitTendersToTotal(
      (input.payments?.length ? input.payments : input.payment ? [input.payment] : []).filter((p) => p && p.amount > 0),
      total,
    );
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
      // Under a rupee short is paid (lib/money-round).
      const status = isSettled(r2(total - paid)) ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "PENDING";
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

    // A NEW BILL ON AN INSURANCE STAY CHANGES HOW THE COVER SPREADS.
    //
    // The approval is one number over however many bills the stay ends up with,
    // so every bill added after the insurer answered has to re-run the split -
    // otherwise it lands with zero cover and reads as wholly the family's, which
    // is exactly what happened to every bill raised after a pre-auth approval.
    // Recomputes from scratch, so calling it per invoice is safe.
    if (input.admissionId && payer === "INSURANCE") {
      await syncStayCoverage(tx, input.admissionId);
    }

    return invoice.id;
  });

  const dto = await getInvoice(invoiceId);

  // ── the patient's copy, after the bill is safely committed ───────────────
  //
  // Outside the transaction on purpose. A provider timeout is ten seconds, and
  // ten seconds of held row locks on the invoice table at a billing counter is
  // a queue. The receipt on the printer is the real receipt; this is a copy.
  if (input.notify !== false) {
    await notifyBillGenerated(dto.patient.phone, {
      name: dto.patient.fullName,
      receiptNo: dto.receiptNo,
      total: dto.totalAmount,
      balanceDue: dto.balanceDue,
      source: dto.source,
    });
  }

  return dto;
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
      id: true, receiptNo: true, source: true, status: true, createdAt: true, billDate: true,
      payer: true, payerName: true,
      // Whether this bill belongs to a stay. The edit dialog reads it to know a
      // lab or pharmacy line can be removed even from a collected bill - on a
      // stay the recorded payment is lowered to the new total instead of the
      // edit being refused (owner, 3 Oct 2026). See updateInvoice.
      admissionId: true,
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
  //
  // Kept as rows, not just a total: the discharge writes one payment per deposit
  // slip, so the bill can name each one instead of printing a lump the family
  // cannot reconcile against the receipts they are holding.
  type PayRow = { mode: string; amount: { toString(): string }; reference: string | null; createdAt: Date };
  const advancePayments = (inv.payments as PayRow[]).filter((p) => isAdvanceAdjustment(p.reference));
  const advanceAdjusted = advancePayments
    .reduce((s: number, p) => r2(s + Number(p.amount.toString())), 0);
  const advanceLines = advancePayments.map((p) => ({
    receiptNo: advanceReceiptNoFromRef(p.reference),
    mode: p.mode,
    amount: p.amount.toString(),
    at: p.createdAt.toISOString(),
  }));

  return {
    id: inv.id,
    receiptNo: inv.receiptNo,
    source: inv.source,
    admissionId: inv.admissionId,
    status: inv.status,
    createdAt: inv.createdAt.toISOString(),
    billDate: inv.billDate ? inv.billDate.toISOString() : null,
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
    advanceLines,
    // Under a rupee is not a balance (lib/money-round).
    balanceDue: s2(owed(Math.max(0, r2(total - paid)))),
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

/**
 * THE COUNTER DESKS EDIT BILLS ONLY IF THE HOSPITAL HAS SAID THEY MAY.
 *
 * Reception and the insurance room got bill editing behind an admin switch,
 * off by default - see HospitalConfig.billEditingEnabled. The check lives HERE
 * rather than in the route because hiding a button is not a permission: the
 * PATCH endpoint is reachable with a session and a URL, and a switch that only
 * dims the UI protects nobody.
 *
 * ADMIN and LAB_TECH are deliberately outside it. An admin who cannot correct a
 * bill has no way to fix the very mistake the switch guards against, and the lab
 * counter had this before the switch existed - taking it away by default would
 * be a regression dressed up as a safety feature.
 */
const EDIT_GATED_ROLES = new Set(["RECEPTIONIST", "INSURANCE_DESK"]);

export async function assertMayEditBills(actor: AuthUser): Promise<void> {
  if (!EDIT_GATED_ROLES.has(actor.role)) return;
  // Read the column directly rather than through admin.service's getSettings().
  // admin.service imports pharmacy.service which imports this file, so pulling
  // it in here would close an import cycle - and a cycle whose failure mode is
  // an undefined createInvoice at module init is not one to introduce for the
  // sake of reusing a five-line query.
  const c = await prisma.hospitalConfig.findFirst({ select: { billEditingEnabled: true } });
  // Fails CLOSED: no config row must never be the reason a desk can rewrite a
  // tax document.
  if (!c?.billEditingEnabled) {
    throw new ApiError(
      403,
      "Bill editing is switched off for this desk. An admin can turn it on in Settings → Behaviour. Until then, cancel the bill and reissue it."
    );
  }
}

/**
 * The printed date, as a timestamp - or a 400 the desk can act on.
 *
 * The rule itself lives in billing/calc, pure and tested (noon anchoring, no
 * future dates, no 31st of February). This only translates its error into the
 * HTTP one, the same division of labour computeInvoiceTotals already has.
 */
function billDateOrThrow(input: string | null | undefined): Date | null | undefined {
  try {
    return resolveBillDate(input);
  } catch (e) {
    if (e instanceof BillDateError) throw new ApiError(400, e.message);
    throw e;
  }
}

/**
 * Replace the line items / discount / printed date of a live invoice.
 *
 * PAID BILLS ARE EDITABLE, which they were not before. The desk asked for it and
 * the reason is a real one: a counter that billed the wrong test to a patient who
 * has already paid needs to correct the paperwork, and voiding a settled bill to
 * reissue it puts two documents in the ledger for one visit and a cancelled
 * receipt in the patient's hand.
 *
 * What holds the money story together instead is three narrower rules, each of
 * which refuses something specific rather than refusing everything:
 *
 *   1. A CANCELLED bill is finished and stays finished.
 *   2. A bill with a live IRN is the government's copy - credit note only.
 *   3. The total may not fall BELOW what has already been collected. Money in
 *      the drawer is real; a bill that says less than was taken is an
 *      over-collection that nothing records. Refund first, then edit.
 *
 * Everything above the floor recomputes cleanly: the total moves, the status is
 * re-derived, the balance comes back, and the edit lands in the audit log under
 * its own action name.
 */
export async function updateInvoice(
  actor: AuthUser,
  input: {
    invoiceId: string; lines: BillLineInput[]; discountAmount?: number; notes?: string;
    /** "YYYY-MM-DD" to correct the printed date, null to clear it, absent to leave it. */
    billDate?: string | null;
    /**
     * INTERNAL - an IPD stay re-issue only, never from an API body. Instead of
     * refusing a total below what was collected, lower the recorded payments to
     * it. See planPaymentTrim.
     */
    trimPaymentsToTotal?: boolean;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<InvoiceDTO> {
  if (!input.lines.length) throw new ApiError(400, "An invoice needs at least one item");
  await assertMayEditBills(actor);
  const billDate = billDateOrThrow(input.billDate);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const inv = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true, status: true, totalAmount: true,
        // The day it was raised, and the correction it is carrying now - the two
        // a CLEARED correction moves the money between. See the block below.
        createdAt: true, billDate: true,
        // Whether this bill is on a stay's running tab. A LAB or PHARMACY bill
        // that is decides the floor below - see trimToTotal.
        source: true, admissionId: true,
        payments: { select: { id: true, amount: true, reference: true, createdAt: true } },
        refunds: { select: { amount: true } },
        eInvoice: { select: { status: true } },
      },
    });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status === "CANCELLED") throw new ApiError(400, "This invoice was cancelled and can't be edited");

    // ── A TEST COMES OFF A STAY'S BILL EVEN AFTER IT IS COLLECTED ──
    //
    // The floor below refuses a total under what was collected, and for an OP
    // or walk-in bill it still does: that money left as an over-collection with
    // nothing recording it, and the refund flow is where it belongs.
    //
    // A LAB or PHARMACY bill that hangs off an admission is different. It is a
    // line on the ward's running tab, and the desk corrects that tab the way it
    // corrects every other line on it - by taking the wrong one off. Refusing
    // because the window already took the money forced a cancel-and-reissue on a
    // bill the family holds, over one test keyed in twice. So on that bill the
    // removal saves and the recorded payment comes DOWN to the new total, the
    // same instrument an IPD stay correction already uses (owner, 3 Oct 2026).
    //
    // CONSEQUENCE, stated: the day that bill was collected on shows that much
    // less, the cash in the drawer is unchanged, and the only record of the gap
    // is the audit entry below. The internal `trimPaymentsToTotal` (the stay
    // re-issue) still forces the same path; this widens it to the two counters'
    // own bills, decided HERE from the bill itself so an OP bill can never ask
    // for it down the API.
    const trimToTotal =
      input.trimPaymentsToTotal === true
      || billTrimsPaymentOnShortfall({ source: inv.source, admissionId: inv.admissionId });

    // ── A REGISTERED BILL IS THE GOVERNMENT'S COPY, NOT OURS ──
    //
    // A live IRN means these exact figures were filed with the IRP and a QR
    // carrying them is printed on the patient's copy. Rewriting the bill under
    // that QR leaves a document whose face and whose registration disagree, and
    // the only lawful correction is a credit note.
    //
    // This guard is NEW because it used to be free: nothing with an IRN was
    // editable, since e-invoicing only happens on bills that have been paid, and
    // paid bills were refused outright. Allowing paid edits removed the accident
    // that was protecting it.
    if (inv.eInvoice?.status === "GENERATED") {
      throw new ApiError(
        400,
        "This bill is registered with an IRN and can't be edited. Cancel the e-invoice, or cancel the bill and reissue it."
      );
    }

    // ── WHAT HAS ALREADY BEEN COLLECTED IS THE FLOOR ──
    //
    // Editing a PAID bill is allowed - a desk that billed the wrong test for a
    // patient who has already paid needs to correct the paperwork, and voiding
    // and reissuing a settled bill is a heavier instrument than that mistake
    // deserves. What is NOT allowed is dropping the total below the money in the
    // drawer: that money is real, the patient handed it over, and a bill that
    // says less than was taken is an over-collection with nothing anywhere
    // recording it. The refund flow exists precisely for giving it back, and it
    // writes a Refund row somebody can find later.
    //
    // Above the floor there is no problem: the total goes up, the balance
    // reappears, the status drops back to PARTIALLY_PAID and the desk collects
    // the difference.
    // `let`, because an IPD re-issue may lower these below - see trimPaymentsToTotal.
    let paymentLines = inv.payments.map((p) => ({ amount: Number(p.amount.toString()) }));
    const refundLines = inv.refunds.map((r: { amount: { toString(): string } }) => ({ amount: Number(r.amount.toString()) }));
    let collected = netPaid(paymentLines, refundLines);

    // ── RECOMPUTE, THROUGH THE ONE FUNCTION THAT DOES THIS ──
    //
    // This was a hand-copied second implementation of computeInvoiceTotals -
    // identical arithmetic, separately maintained. The edit dialog then had to
    // guess at what it would produce, guessed pre-GST, and disabled its own Save
    // button on every settled bill as a result. Two copies of the invoice
    // arithmetic is how that happens, so now there is one.
    let calc;
    try {
      calc = computeInvoiceTotals(
        input.lines.map((l) => ({ ...l, unitPrice: l.unitPrice, gstRatePct: l.gstRatePct ?? 0 })),
        input.discountAmount ?? 0,
      );
    } catch (e) {
      if (e instanceof InvoiceMathError) throw new ApiError(400, e.message);
      throw e;
    }
    const { items, subtotal, discount, taxable, cgst, sgst, total } = calc;

    // The floor, checked now that there is a new total to check it against. The
    // rule and its wording live in billing/calc, where they are tested.
    //
    // EXCEPT where `trimToTotal` holds - an IPD stay re-issue, or a lab/pharmacy
    // bill on a stay's running tab (see above). There the owner's rule is that
    // the edit always saves and the recorded payment comes down to the corrected
    // total instead (planPaymentTrim says why and which rows give way). Every
    // row it touches goes in the audit log with its old figure - that entry is
    // the only place the earlier amount survives.
    if (trimToTotal && r2(total) < r2(collected) - 0.01) {
      const plan = planPaymentTrim(
        inv.payments.map((p) => ({
          id: p.id, amount: Number(p.amount.toString()),
          isAdvance: isAdvanceAdjustment(p.reference), createdAt: p.createdAt,
        })),
        r2(collected - total),
      );
      for (const step of plan) {
        if (step.to <= 0) await tx.payment.delete({ where: { id: step.id } });
        else await tx.payment.update({ where: { id: step.id }, data: { amount: s2(step.to) } });
      }
      await logAudit(actor, {
        // A stay re-issue and a test taken off a tab bill both land here; the
        // meta's `source` tells them apart when the log is read later.
        action: "PAYMENT_REDUCED_ON_STAY_CORRECTION",
        targetTable: "Invoice", targetId: inv.id,
        meta: {
          source: inv.source,
          oldTotal: inv.totalAmount.toString(), newTotal: s2(total),
          collectedBefore: s2(collected),
          payments: plan.map((s) => ({ id: s.id, from: s2(s.from), to: s2(s.to) })),
        },
        ...ctx,
      }, tx);
      const changed = new Map(plan.map((s) => [s.id, s.to]));
      paymentLines = inv.payments
        .map((p) => ({ amount: changed.has(p.id) ? changed.get(p.id)! : Number(p.amount.toString()) }))
        .filter((p) => p.amount > 0);
      collected = netPaid(paymentLines, refundLines);
    }

    try {
      assertTotalCoversCollected(total, collected);
    } catch (e) {
      if (e instanceof InvoiceMathError) throw new ApiError(400, e.message);
      throw e;
    }

    // ── THE STATUS HAS TO BE RE-DERIVED, NOT LEFT ALONE ──
    //
    // This did not matter while only unpaid bills were editable: PENDING in,
    // PENDING out. Now a PAID bill whose total goes up is PART paid, and leaving
    // the column saying PAID would drop it off the desk's "due" list with money
    // still owed on it - the bill would simply stop being chased.
    //
    // Derived by the same function every other money path uses, so a bill edited
    // here and a bill paid at the counter cannot disagree about what PAID means.
    const status = invoiceStatusFrom(total, paymentLines, refundLines);

    // ── A RE-DATED BILL TAKES ITS MONEY WITH IT (owner, 2 Oct 2026) ──
    //
    // `billDate` started life as a PRINTED date only: the sheet moved, the
    // Payment rows did not, and the day close, the collection report and the GST
    // return all went on counting the money under the day it was typed. That was
    // deliberate and it is now wrong for this hospital. A bill moved to the day
    // the treatment actually happened was still showing the day it was keyed in
    // everywhere the money appeared - including the stay's Payment Details table,
    // which is where the desk kept seeing it - and the owner's rule is that the
    // corrected date IS the bill's date, with the collection on it.
    //
    // So every payment on the bill moves to the new date, and a settled bill's
    // `paidAt` with them. CONSEQUENCE, stated plainly: a closed day's takings
    // change. Money leaves the day it was keyed in and lands on the day the bill
    // now carries, so a day close printed before the edit will not match one
    // printed after it. That is the trade the owner asked for.
    //
    // THE OLD TIMESTAMPS SURVIVE ONLY IN THE AUDIT LOG, below - nothing else
    // records them, which is why they go in with the row ids.
    //
    // CLEARING a correction moves it back, to the day the bill was raised: the
    // dialog's "Back to …" button means this bill was never on another day, and
    // leaving its money on the date somebody has just withdrawn would be the
    // same split the other way round.
    //
    // ONLY WHERE THERE WAS A CORRECTION TO CLEAR. The dialog sends `billDate:
    // null` on every save where the box was not touched, so a routine line
    // correction on a never-re-dated bill arrives here as a clear - and pulling
    // its payments back to the raise instant would move money nobody asked to
    // move. `undefined` - no date field at all - touches nothing either.
    const moveTo =
      billDate === undefined ? null
      : billDate ? billDate
      : inv.billDate ? inv.createdAt
      : null;
    const redated: { id: string; from: string }[] = [];
    if (moveTo) {
      for (const p of inv.payments) {
        if (p.createdAt.getTime() === moveTo.getTime()) continue;
        await tx.payment.update({ where: { id: p.id }, data: { createdAt: moveTo } });
        redated.push({ id: p.id, from: p.createdAt.toISOString() });
      }
    }

    // Settled, and re-dated, means it was settled on the new date. Cleared
    // entirely where the bill has stopped being settled - see below.
    const paidAtPatch =
      status !== "PAID" ? { paidAt: null }
      : moveTo ? { paidAt: moveTo }
      : {};

    // ── WHAT THE LINES POINT AT SURVIVES THE REWRITE ──
    //
    // A pharmacy line carries the batch it was dispensed from and a lab line the
    // test it bills. The edit below deletes every line and writes it back, and
    // the dialog only ever sends description/qty/price - so before this, ANY
    // correction silently cut those links. Five pharmacy bills in this database
    // lost all 38 of their batch references that way: the medicine was still on
    // the bill, but which strip it came off was gone, and with it the recall
    // trail from a batch back to the patients who were given it.
    //
    // Carried by POSITION, and only while the description still matches. A line
    // somebody has rewritten into a different medicine must NOT inherit the last
    // one's batch - a wrong traceability link is worse than an absent one, and
    // the absent one is what an untouched line never has to fall back on.
    const prevLines = await tx.invoiceItem.findMany({
      where: { invoiceId: inv.id },
      // No explicit order column; ids are cuids written in line order, so this
      // reconstructs the order the desk is looking at.
      orderBy: { id: "asc" },
      select: { description: true, batchId: true, labTestId: true },
    });

    // swap the items wholesale (receiptNo is preserved - same invoice, corrected)
    await tx.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        subtotal: s2(subtotal), discountAmount: s2(discount), taxableAmount: s2(taxable),
        cgstAmount: s2(cgst), sgstAmount: s2(sgst), totalAmount: s2(total),
        status,
        // paidAt belongs to the moment the bill was settled - which a re-date
        // moves, like every other date on the bill. Cleared where the bill has
        // stopped being settled: a re-opened bill carrying the date it was
        // "paid" is a contradiction on its face. See paidAtPatch.
        ...paidAtPatch,
        notes: input.notes?.trim() || null,
        // `undefined` is Prisma's "leave this column alone", which is exactly
        // what a caller that did not send a date means. `createdAt` is never
        // among these fields - see the schema note on billDate.
        ...(billDate === undefined ? {} : { billDate }),
        items: {
          create: items.map((it, idx) => {
            // Same slot, same description -> the same physical line, so whatever
            // it pointed at still applies. See the note above deleteMany.
            const prev = prevLines[idx];
            const carried = prev && prev.description === it.description ? prev : null;
            return {
              description: it.description, hsnSac: it.hsnSac ?? null, qty: it.qty,
              unitPrice: s2(it.unitPrice), amount: s2(it.amount), gstRatePct: s2(it.gstRatePct),
              batchId: carried?.batchId ?? null,
              // An explicit test from the caller wins; otherwise keep the one the
              // line already had, which is what a date or price correction means.
              labTestId: it.labTestId ?? carried?.labTestId ?? null,
            };
          }),
        },
      },
    });

    await logAudit(actor, {
      // A SETTLED bill being rewritten is its own action, not a variant of the
      // ordinary one. Editing an unpaid bill is routine paperwork; editing a
      // bill somebody has already paid changes a document that is in their
      // hands, and it should be findable in the log by searching for exactly
      // that rather than by reading the meta of every edit ever made.
      action: collected > 0 ? "INVOICE_EDITED_AFTER_PAYMENT" : "INVOICE_EDITED",
      targetTable: "Invoice", targetId: inv.id,
      // The before-figure and the date both go in because they are the parts an
      // edit leaves no other trace of: afterwards the row simply holds the new
      // values, and "what was this bill before, and who moved it" is otherwise
      // unanswerable.
      meta: {
        oldTotal: inv.totalAmount.toString(),
        newTotal: s2(total),
        collected: s2(collected),
        status,
        ...(billDate === undefined ? {} : { billDate: billDate ? billDate.toISOString() : null }),
        // The ONLY record that these payments were ever stamped with another
        // day. Written per row, with the id, so a day close that no longer adds
        // up can be traced back to the edit that moved the money.
        ...(redated.length
          ? { paymentsRedated: redated, paymentsRedatedTo: moveTo!.toISOString() }
          : {}),
      },
      ...ctx,
    }, tx);
  });

  return getInvoice(input.invoiceId);
}

/**
 * Cancel an invoice. Never deleted - status flips to CANCELLED and it stays in
 * the ledger forever. Any lab tests on it are released so they can be re-billed,
 * and any medicine on it goes back on the shelf.
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
      select: {
        id: true, receiptNo: true, status: true, notes: true,
        // Only the lines that moved stock. A batch is what a dispensed line
        // carries; a consultation or a lab line has none and reverses nothing.
        items: { where: { batchId: { not: null } }, select: { batchId: true, qty: true } },
      },
    });
    if (!inv) throw new ApiError(404, "Invoice not found");
    if (inv.status === "CANCELLED") throw new ApiError(400, "This invoice is already cancelled");

    // ── VOIDING A PHARMACY BILL PUTS THE MEDICINE BACK ON THE SHELF ──
    //
    // The sale decremented the batch FEFO picked from and wrote a DISPENSE row
    // against it. Voiding used to undo the money and nothing else, so a sale
    // billed to the wrong patient - or handed back across the counter, which is
    // the ordinary reason this counter voids at all - left the strip physically
    // on the shelf and missing from the system. The next FEFO pick could not see
    // it, the stock sheet under-counted it, and the only correction was a
    // pharmacist remembering to type a manual adjustment with the right batch
    // and the right quantity.
    //
    // REVERSED OFF THE INVOICE LINES, NOT OFF THE LEDGER. A DISPENSE row carries
    // no invoice reference, so the ledger cannot say which movements belong to
    // this bill. The line can: it holds the exact batch it was dispensed from
    // and keeps that link through a bill edit. So what goes back is what the
    // bill currently says - which is what this patient was actually charged for.
    //
    // A RETURN row per line, mirroring the DISPENSE row per line the sale wrote,
    // stamped with the receipt so a batch's history reads as a pair. Cancelling
    // an already-cancelled bill is refused above, which is what stops the same
    // batch being credited twice.
    const returnedUnits = inv.items.reduce((n: number, l: { qty: number }) => n + l.qty, 0);
    for (const line of inv.items) {
      if (!line.batchId) continue;
      await tx.stockBatch.update({ where: { id: line.batchId }, data: { quantity: { increment: line.qty } } });
      await tx.stockTransaction.create({
        data: {
          batchId: line.batchId, type: "RETURN", qty: line.qty,
          refId: inv.receiptNo, reason: `Bill voided: ${input.reason.trim()}`,
          performedById: actor.id,
        },
      });
    }

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

    await logAudit(actor, {
      action: "INVOICE_CANCELLED", targetTable: "Invoice", targetId: inv.id,
      // The units that went back on the shelf ride along, so "what did voiding
      // this bill return, and who did it" is answerable from the bill's own
      // audit row rather than by matching timestamps against the stock ledger.
      meta: {
        reason: input.reason.trim(),
        ...(returnedUnits > 0 ? { stockReturned: returnedUnits } : {}),
      },
      ...ctx,
    }, tx);
  });

  return getInvoice(input.invoiceId);
}

/** Recent invoices for the billing list (filterable by source). */
/**
 * HOW MANY BILLS A LIST REQUEST MAY HAVE - all of them, unless it asks for fewer.
 *
 * These screens used to get the latest hundred, five hundred at most, and the
 * desk could not find a bill older than about a week. Owner's rule (1 Oct
 * 2026): no data limits anywhere, every bill is fetched. A readable positive
 * `?limit=` still narrows it; anything else means "everything".
 */
export function billsLimit(raw: string | null | undefined): number | undefined {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

/**
 * "Show me the bills for the 28th" - as a query, matched on the day each bill
 * SHOWS.
 *
 * ── ONE CALENDAR DAY, WHEN THE DESK ASKS FOR ONE ──
 *
 * Without this the screen could only ever filter the last `limit` bills it had
 * already fetched, so "show me the 3rd" came back empty on any day further back
 * than a hundred invoices - which in this hospital is about a week. The filter
 * has to be a query, not a client-side pass over a truncated list.
 *
 * LOCAL midnight to local midnight. `new Date("2026-08-03")` is UTC midnight,
 * which in IST is 05:30 on the 3rd: half a day of the 2nd's takings would come
 * back under the 3rd, and the day close would disagree with this screen.
 *
 * ── THE DAY ASKED FOR IS THE DAY THE BILL SHOWS ──
 *
 * Matched on the EFFECTIVE date - the corrected `billDate` where a desk has set
 * one, the raised date otherwise. That is exactly what the list prints in its
 * date column and what the patient's copy carries.
 *
 * Matching `createdAt` alone is what made re-dating look broken at the pharmacy
 * counter: a bill moved to the 28th saved correctly, then could not be found
 * under the 28th, because the filter was still looking at the day it was typed.
 * The desk read that as "the date did not save" and re-dated it again.
 *
 * This is a LOOKUP, and it is no longer the only reader that follows a
 * correction. The till and the day close count Payment.createdAt, and since the
 * owner's 2 Oct 2026 rule those payments are re-dated along with the bill (see
 * updateInvoice) - so a re-dated bill and its money now move together, and this
 * filter and the day close agree about which day they belong to.
 */
export function invoiceDayWhere(onDate?: string):
  | Record<string, never>
  | { OR: [{ billDate: { gte: Date; lt: Date } }, { billDate: null; createdAt: { gte: Date; lt: Date } }] } {
  if (!onDate) return {};
  const [y, m, d] = onDate.split("-").map(Number);
  if (!y || !m || !d) return {};
  const dayRange = { gte: new Date(y, m - 1, d), lt: new Date(y, m - 1, d + 1) };
  return {
    OR: [
      // Re-dated INTO this day, whenever it was actually raised.
      { billDate: dayRange },
      // Never re-dated, so the day it was raised is the day it shows.
      { billDate: null, createdAt: dayRange },
    ],
  };
}

/** One row of a bills list - the shape the desks' queues and the admin register share. */
export interface InvoiceListRow {
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
  createdAt: string;
  /** The corrected date this bill prints, when a desk has set one. */
  billDate: string | null;
  patient: { displayId: string; fullName: string };
}

const INVOICE_LIST_SELECT = {
  id: true, receiptNo: true, source: true, status: true, totalAmount: true,
  createdAt: true, billDate: true,
  payer: true, payerName: true,
  patient: { select: { displayId: true, fullName: true } },
  payments: { select: { amount: true, mode: true } },
  refunds: { select: { amount: true } },
} as const;

function toInvoiceListRow(i: {
  id: string; receiptNo: string; source: string; status: string;
  totalAmount: { toString(): string }; createdAt: Date; billDate: Date | null;
  payer: string; payerName: string | null;
  patient: { displayId: string; fullName: string };
  payments: { amount: { toString(): string }; mode: string }[];
  refunds: { amount: { toString(): string } }[];
}): InvoiceListRow {
  const pays = i.payments.map((x) => ({ amount: Number(x.amount.toString()), mode: x.mode as string }));
  const refs = (i.refunds ?? []).map((x) => ({ amount: Number(x.amount.toString()) }));
  // Which tender types actually took money on this bill, in a stable order. The
  // same list the admin register's payment filter reads, so a row and the
  // bucket that returned it cannot disagree.
  const paymentModes = COUNTER_MODES.filter((m) => pays.some((p) => p.mode === m && p.amount > 0));
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
    billDate: i.billDate ? i.billDate.toISOString() : null,
    patient: i.patient,
  };
}

/**
 * The bills a desk works from.
 *
 * `source` narrows to one counter. `excludeSource` keeps one counter OUT, which
 * is the shape reception needs: the pharmacy settles, voids and reprints its own
 * bills at its own window, so a medicine receipt on the front desk's queue is a
 * row nobody there is meant to act on.
 */
export async function listInvoices(source?: InvoiceSourceT, limit?: number, onDate?: string, excludeSource?: InvoiceSourceT): Promise<InvoiceListRow[]> {
  const onEffectiveDay = invoiceDayWhere(onDate);

  const rows = await prisma.invoice.findMany({
    where: {
      ...(source ? { source } : {}),
      // A counter that does not settle another counter's bills does not list
      // them either. Its own clause rather than folded into `source`, so a
      // request naming a source that is also excluded comes back empty - the
      // safe direction for a filter whose whole job is keeping bills off a
      // screen.
      ...(excludeSource ? { NOT: { source: excludeSource } } : {}),
      ...onEffectiveDay,
    },
    // Ordered by when it was RAISED, not by the printed date. The list is the
    // desk's working queue - most recent work first - and a bill back-dated to
    // last month would otherwise fall to the bottom of the screen the moment
    // somebody corrected its date.
    orderBy: { createdAt: "desc" },
    take: limit,
    select: INVOICE_LIST_SELECT,
  });
  return rows.map(toInvoiceListRow);
}

/**
 * A HAND-WRITTEN DESK BILL, GENERATED TWICE.
 *
 * Reception's "Generate bill" on the patient file takes a description and an
 * amount and raises a bill - and a slow response pressed again raises a second
 * one. The same description at the same amount for the same patient within
 * REPEAT_WINDOW_MIN is refused with the bill that exists (RepeatBlock), before
 * anything is written; a different charge, or the same one later, goes through.
 */
export async function assertNotJustBilled(input: {
  patientId: string; source: InvoiceSourceT; description: string; unitPrice: number;
}): Promise<void> {
  const same = await prisma.invoice.findFirst({
    where: {
      patientId: input.patientId, source: input.source, status: { not: "CANCELLED" },
      createdAt: { gte: repeatWindowStart() },
      items: { some: { description: input.description.trim(), unitPrice: input.unitPrice } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, receiptNo: true, createdAt: true, totalAmount: true },
  });
  if (!same) return;
  const details: RepeatBlock = {
    code: "REPEAT_ENTRY", kind: "CONSULTATION",
    items: [{
      label: input.description.trim(),
      at: same.createdAt.toISOString(),
      detail: `Bill ${same.receiptNo} · ₹${same.totalAmount.toString()}`,
      invoiceId: same.id,
    }],
  };
  throw new ApiError(
    409,
    `"${input.description.trim()}" was billed to this patient ${minutesAgo(same.createdAt)} (${same.receiptNo}). ` +
      "This looks like the same bill generated again.",
    details
  );
}

/**
 * EVERY BILL ONE PATIENT HAS EVER HAD - and nobody else's.
 *
 * The reception patient file used to borrow listInvoices() above: the hospital's
 * fifty most recent bills, every patient's, "filtered" with `(x) => true`. So a
 * file showed strangers' bills and stopped showing this patient's own the day
 * fifty newer ones were raised anywhere in the building.
 *
 * Scoped by patientId in the query and never capped: a patient's history is the
 * whole of it, from registration to today - including bills a duplicate record
 * carried before it was merged into this one. Cancelled bills are listed too,
 * because a file that hides a cancelled receipt is a file that can't explain
 * the gap in the receipt numbers.
 */
export async function listPatientInvoices(patientId: string): Promise<InvoiceListRow[]> {
  const rows = await prisma.invoice.findMany({
    where: { patientId },
    orderBy: { createdAt: "desc" },
    select: INVOICE_LIST_SELECT,
  });
  return rows.map(toInvoiceListRow);
}

/**
 * THE ADMIN REGISTER - every bill in the hospital, a page at a time.
 *
 * The desks' lists above are working queues and are meant to stop. This one is
 * the register and must not, so every filter runs here, in the query: the
 * answer covers the whole invoice table while only one page crosses the wire.
 * What each filter means lives in admin-bills-query, where it is tested.
 *
 * `totals` are over EVERY matching bill, not the page - the summary tiles read
 * them, and a "Billed" figure that changed as you paged would be no figure at
 * all. Collected is payments less refunds, which is netPaid summed per bill:
 * the one definition of "paid".
 */
export async function listAdminBills(query: AdminBillsQuery): Promise<{
  invoices: InvoiceListRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: { billed: string; collected: string };
}> {
  const where = buildAdminBillsWhere(query);
  const [rows, total, billed, paid, refunded] = await Promise.all([
    prisma.invoice.findMany({
      where,
      // Most recently RAISED first, like the desks' lists. The id breaks ties,
      // so two bills raised in the same millisecond cannot trade places between
      // two page loads and turn up on both pages, or on neither.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: INVOICE_LIST_SELECT,
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where, _sum: { totalAmount: true } }),
    prisma.payment.aggregate({ where: { invoice: { is: where } }, _sum: { amount: true } }),
    prisma.refund.aggregate({ where: { invoice: { is: where } }, _sum: { amount: true } }),
  ]);
  const sum = (v: { toString(): string } | null) => (v === null ? 0 : Number(v.toString()));
  return {
    invoices: rows.map(toInvoiceListRow),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totals: {
      billed: s2(sum(billed._sum.totalAmount)),
      collected: s2(sum(paid._sum.amount) - sum(refunded._sum.amount)),
    },
  };
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
  /** `total` is the whole bill; `paid` and `due` are the PATIENT'S side of it.
   *  On a cashless bill total !== paid + due, and that is not a bug - the
   *  difference is `insuranceCovered`, which the family is not being asked for. */
  total: string; paid: string; due: string;
  /** What the insurer agreed to take off this bill. "0.00" on a counter bill. */
  insuranceCovered: string;
  /** The insurer, when this bill went to one - so the desk can explain to a
   *  family who was promised cashless why they are being asked for anything. */
  insurerName: string | null;
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
  /** Total the insurer agreed to take off this patient's open bills. > 0 means
   *  the amount owed is a SHARE, and the desk must be able to say so - a family
   *  told the stay was cashless will ask why they are being billed at all. */
  insuranceCovered: string;
  /** The insurer behind that figure, when there is one. */
  insurerName: string | null;
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
      // ── NO LONGER FILTERED BY PAYER ──
      //
      // This used to be `payer: "SELF_PAY"`, on the reasoning that a cashless
      // bill is with the insurer and chasing the family for it is wrong. That
      // was right about the whole bill and wrong about the part of it the
      // insurer refused: a ₹2,00,000 stay approved at ₹1,80,000 leaves ₹20,000
      // that IS the family's, and this filter hid it from every collection
      // screen in the hospital. Nobody chased it because nobody could see it.
      //
      // The payer question is now answered per-rupee by insuranceCoveredAmount
      // rather than per-bill, so the filter below is the honest one: does this
      // patient still owe money on this bill? An insurance bill whose coverage
      // equals its total computes a zero patient balance and drops out here
      // exactly as it did before.
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, receiptNo: true, createdAt: true, totalAmount: true,
      payer: true, payerName: true, insuranceCoveredAmount: true,
      payments: { select: { mode: true, amount: true } },
      refunds: { select: { amount: true } },
      patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
      // ONE line, plus how many there are. The summary below shows the first
      // description and "+ N more", so pulling every line of every unpaid bill
      // fetched fifteen rows off a pharmacy invoice to render one of them. On a
      // screen that already reads every open bill in the hospital, that is the
      // difference between a query that grows with BILLS and one that grows with
      // bills × lines.
      items: { select: { description: true }, orderBy: { id: "asc" }, take: 1 },
      _count: { select: { items: true } },
      admission: {
        select: { ipNumber: true, status: true, bed: { select: { bedNo: true, ward: { select: { name: true } } } } },
      },
    },
  });

  const dues: CounterDue[] = [];
  for (const inv of rows) {
    // THE PATIENT'S SHARE, not the bill's balance. On a cashless bill those are
    // two different numbers, and it is the first one this counter collects.
    const split = splitInvoice({
      totalAmount: Number(inv.totalAmount),
      insuranceCoveredAmount: Number(inv.insuranceCoveredAmount),
      payments: inv.payments.map((p) => ({ mode: String(p.mode), amount: Number(p.amount) })),
      refunds: inv.refunds.map((x) => ({ amount: Number(x.amount) })),
    });
    // A rounding tail of a paisa is settled, not owed.
    if (split.patientBalance <= 0.01) continue;
    if (!inv.patient) continue;

    const first = inv.items[0];
    const more = inv._count.items - 1;
    dues.push({
      invoiceId: inv.id,
      receiptNo: inv.receiptNo,
      createdAt: inv.createdAt.toISOString(),
      total: split.total.toFixed(2),
      paid: split.patientPaid.toFixed(2),
      due: split.patientBalance.toFixed(2),
      // What the insurer took off this bill, so the desk can explain the figure
      // to a family who was told the stay was cashless.
      insuranceCovered: split.insuranceCovered.toFixed(2),
      insurerName: inv.payer === "INSURANCE" ? inv.payerName : null,
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
      stillAdmitted: d.stillAdmitted, bills: [], billCount: 0, due: "0.00",
      insuranceCovered: "0.00", insurerName: null as string | null,
      oldestAt: d.createdAt,
    };
    row.bills.push({ invoiceId: d.invoiceId, receiptNo: d.receiptNo, due: d.due, createdAt: d.createdAt, summary: d.summary });
    row.billCount = row.bills.length;
    row.due = r2(Number(row.due) + Number(d.due)).toFixed(2);
    row.insuranceCovered = r2(Number(row.insuranceCovered) + Number(d.insuranceCovered)).toFixed(2);
    // First insurer wins - one stay is one insurer, and the rollup is per stay.
    if (!row.insurerName && d.insurerName) row.insurerName = d.insurerName;
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
        // ── NO PAYER FILTER ──
        //
        // This was `payer: "SELF_PAY"`, to stop a family's cash being taken
        // against a bill their insurer was carrying. Right instinct, wrong
        // instrument: it also refused the CO-PAY on that bill, which is money
        // the family genuinely owes and the counter genuinely has to take.
        //
        // The protection is now exact rather than blanket - `due` below is the
        // patient's share alone, so a tender can never be applied to the part
        // of a bill the insurer agreed to pay.
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, receiptNo: true, totalAmount: true, insuranceCoveredAmount: true,
        payments: { select: { mode: true, amount: true } },
        refunds: { select: { amount: true } },
      },
    });

    const open = invoices
      .map((i) => {
        const split = splitInvoice({
          totalAmount: Number(i.totalAmount),
          insuranceCoveredAmount: Number(i.insuranceCoveredAmount),
          payments: i.payments.map((p) => ({ mode: String(p.mode), amount: Number(p.amount) })),
          refunds: i.refunds.map((x) => ({ amount: Number(x.amount) })),
        });
        return {
          id: i.id,
          receiptNo: i.receiptNo,
          total: split.total,
          // THE PATIENT'S SHARE. Allocating against the whole balance would
          // have the family paying down the insurer's ₹1,80,000.
          due: split.patientBalance,
        };
      })
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
        // ── STATUS IS ABOUT THE WHOLE BILL, NOT THE FAMILY'S HALF ──
        //
        // `need` above reached zero when the PATIENT finished paying their
        // share. Marking the invoice PAID there would have closed a bill on
        // which the insurer still owed ₹1,80,000 - and a closed bill is one no
        // settlement screen lists and nobody ever chases.
        //
        // So the status is recomputed from every payment on the bill, which is
        // the same rule createInvoice and recordPayments use.
        const after = await tx.invoice.findUnique({
          where: { id: inv.id },
          select: { totalAmount: true, cancelledAt: true, payments: { select: { amount: true } }, refunds: { select: { amount: true } } },
        });
        const status = after
          ? invoiceStatusFrom(
              Number(after.totalAmount),
              after.payments.map((x) => ({ amount: Number(x.amount) })),
              after.refunds.map((x) => ({ amount: Number(x.amount) })),
              !!after.cancelledAt
            )
          : "PARTIALLY_PAID";
        await tx.invoice.update({
          where: { id: inv.id },
          data: { status, paidAt: status === "PAID" ? new Date() : null },
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
  input: {
    admissionId: string; invoiceIds?: string[]; reason: string;
    /**
     * THE INSURER REFUSED THE WHOLE STAY, so the stay itself becomes self-pay.
     *
     * Without this the function moved the BILLS and left the ADMISSION marked
     * INSURANCE, which is three wrong things at once: the ward sheet still said
     * "Paying: Insurance" to a family being asked for cash, the stay stayed on
     * the claims desk's list forever (insuranceStays filters on payerType), and
     * the next bill raised against it defaulted straight back to the insurer.
     *
     * Off for a PARTIAL revert - an insurer refusing one pharmacy bill has not
     * refused the admission, and flipping the stay on that would be wrong.
     */
    convertStay?: boolean;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ moved: { receiptNo: string; total: string }[]; movedTotal: string; skipped: { receiptNo: string; why: string }[]; stayConverted: boolean }> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ApiError(400, "Say why this is going back to the patient");

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const adm = await tx.admission.findUnique({
      where: { id: input.admissionId },
      select: { id: true, ipNumber: true, insurer: true, payerType: true },
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
    // NO BILLS IS NOT AN ERROR WHEN THE WHOLE STAY IS BEING CONVERTED.
    //
    // An insurer refuses a pre-auth on day one, before the ward has raised a
    // single invoice - that is the commonest refusal there is. This threw a 409
    // and converted nothing, so the stay stayed INSURANCE, the claim stayed
    // SUBMITTED, and the desk was told "there are no insurance bills to move"
    // when what they were trying to say was "this patient is paying cash now".
    //
    // It IS still an error on a partial move: naming invoices that turn out not
    // to exist means the desk is looking at something stale.
    if (!invoices.length && !input.convertStay) {
      throw new ApiError(409, "There are no insurance bills on this stay to move");
    }

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
        //
        // insuranceCoveredAmount MUST go back to zero with it. That column is
        // what splitInvoice subtracts to get the patient's share, so a bill the
        // insurer had approved at ₹1,80,000 and then refused would still have
        // credited them that much - the family would be billed the ₹20,000
        // co-pay for a stay they now owe in full, and the desk would collect it
        // and think the bill was settled.
        data: { payer: "SELF_PAY", payerName: null, insuranceCoveredAmount: "0.00" },
      });
      moved.push({ receiptNo: inv.receiptNo, total: Number(inv.totalAmount).toFixed(2) });
    }

    // The insurer is out of this stay entirely. `insurer` and `policyNo` are
    // LEFT ON THE ROW on purpose - they are what the note above refers to and
    // the only record of who refused; it is payerType that decides where the
    // stay is listed and what the next bill defaults to.
    const convertStay = Boolean(input.convertStay) && adm.payerType === "INSURANCE";
    if (convertStay) {
      await tx.admission.update({
        where: { id: adm.id },
        data: { payerType: "SELF_PAY" },
      });

      // ── AND THE CLAIM IS MARKED REFUSED, IN THE SAME BREATH ──
      //
      // Converting the stay without touching the claim left the two saying
      // opposite things about one admission: the ward billing the family in
      // cash while the claims board still showed the stay SUBMITTED and waiting
      // on Star Health. Whichever screen you opened, the other one was wrong,
      // and the desk had to remember to go and close the claim by hand - which
      // is exactly the kind of second step that does not happen at 8pm.
      //
      // Only claims still in play. One already SETTLED is money that arrived and
      // must not be rewritten as a refusal; one already REJECTED is why we are
      // here. The reason is carried onto the claim's own timeline, because
      // "why was this refused" is asked of the claim, not of the stay.
      const live = await tx.insuranceClaim.findMany({
        where: {
          admissionId: adm.id,
          status: { notIn: ["SETTLED", "REJECTED", "CLOSED"] },
        },
        select: { id: true },
      });
      for (const c of live) {
        await tx.insuranceClaim.update({
          where: { id: c.id },
          data: { status: "REJECTED", decisionAt: new Date() },
        });
        await tx.claimEvent.create({
          data: {
            claimId: c.id, kind: "REJECTED",
            detail: `Refused - the stay was moved to self-pay. ${reason}`,
            byId: actor.id,
          },
        });
      }
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
            `${moved.map((m) => m.receiptNo).join(", ")}. Reason: ${reason}` +
            (convertStay ? " The stay is now SELF-PAY." : ""),
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
      stayConverted: convertStay,
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


/**
 * RE-SPREAD A STAY'S APPROVED COVER ACROSS ITS BILLS.
 *
 * `insuranceCoveredAmount` is a STORED figure - splitInvoice subtracts it to get
 * the family's share - so it has to be rewritten every time either side of the
 * sum moves. Two things move it, and until now only one of them triggered:
 *
 *   THE APPROVAL CHANGES. Handled all along, inside actOnClaim.
 *
 *   A NEW BILL APPEARS. Not handled, and this is the one that broke the planned
 *   path. A pre-auth approved at Rs 60,000 before admission had no bills to land
 *   on; the pharmacy and the ward then raised theirs over the next three days
 *   and every one of them got zero cover. The stay read as wholly the family's
 *   on a claim the insurer had already agreed to pay.
 *
 * WHICH NUMBER IS THE COVER. A stay can carry a pre-auth AND a final claim, and
 * adding them would cover the stay twice. The final claim supersedes: it is
 * raised against the real bill and is the number the insurer will actually pay.
 * The pre-auth is used only while no final claim has a decision on it.
 *
 * Safe to call whenever anything moves - it recomputes from scratch rather than
 * adjusting, so running it twice is the same as running it once.
 */
export async function syncStayCoverage(
  tx: Prisma.TransactionClient,
  admissionId: string,
): Promise<void> {
  const claims = await tx.insuranceClaim.findMany({
    where: {
      admissionId,
      status: { in: ["APPROVED", "PARTIALLY_APPROVED", "SETTLED"] },
    },
    orderBy: { decisionAt: "asc" },
    select: { stage: true, approvedAmount: true, settledAmount: true },
  });

  const amountOf = (c: (typeof claims)[number]) =>
    Number(c.approvedAmount ?? c.settledAmount ?? 0);

  const final = claims.filter((c) => c.stage === "FINAL");
  // Latest decision of the governing stage - a claim queried and re-approved
  // leaves two rows, and the later answer is the one that stands.
  const governing = final.length ? final : claims;
  const approved = governing.length ? amountOf(governing[governing.length - 1]) : 0;

  const bills = await tx.invoice.findMany({
    where: { admissionId, payer: "INSURANCE", status: { not: "CANCELLED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, totalAmount: true, insuranceCoveredAmount: true },
  });

  for (const a of allocateCoverage(approved, bills.map((b) => ({ id: b.id, totalAmount: Number(b.totalAmount) })))) {
    const before = bills.find((b) => b.id === a.id);
    // Only write where it actually moved: this runs on every invoice creation,
    // and an UPDATE per bill per bill would be noise in the audit trail.
    if (before && Math.abs(Number(before.insuranceCoveredAmount) - a.covered) > 0.005) {
      await tx.invoice.update({ where: { id: a.id }, data: { insuranceCoveredAmount: a.covered.toFixed(2) } });
    }
  }
}
