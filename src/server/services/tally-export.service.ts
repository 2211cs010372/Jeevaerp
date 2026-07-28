import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import {
  buildTallyXml, tallyFilename, toTallyDate,
  type TallyVoucher,
} from "@/lib/export/tally-xml";
import type { AuthUser } from "@/lib/auth/types";

/**
 * Turn a date range of billing activity into Tally vouchers.
 *
 * THREE VOUCHERS, NOT ONE
 * -----------------------
 * A bill and the money for it are separate events and are posted separately:
 * a Sales voucher when the invoice is raised, a Receipt when payment is taken,
 * a Credit Note when money goes back. Collapsing them into one "sales with
 * payment" voucher is the tempting shortcut and it is wrong here, because this
 * hospital genuinely bills before it collects - an inpatient's lab and pharmacy
 * bills sit unpaid until discharge by design (see labs.service). Posting those
 * as cash sales would show income the hospital has not received and would make
 * the debtors ledger, which is the number the hospital actually chases, empty.
 *
 * CANCELLED BILLS ARE OMITTED, NOT REVERSED
 * -----------------------------------------
 * A cancelled invoice never became income. It is skipped entirely rather than
 * posted and contra-ed, which would inflate both sides of the P&L for no reason.
 * Refunds, by contrast, ARE posted - the money genuinely left the drawer.
 */

/** Which income ledger a revenue stream posts to. */
type LedgerMap = {
  sales: Record<string, string>;
  cash: string;
  bank: string;
  debtor: string;
  cgst: string;
  sgst: string;
  company: string;
};

async function ledgerMap(): Promise<LedgerMap> {
  const c = await prisma.hospitalConfig.findFirst();
  if (!c) throw new ApiError(400, "Hospital settings are not configured.");
  if (!c.tallyCompanyName?.trim()) {
    throw new ApiError(
      400,
      "Set the Tally company name in Settings first - it must match the company in Tally exactly, or the import will be refused."
    );
  }
  return {
    company: c.tallyCompanyName.trim(),
    sales: {
      CONSULTATION: c.tallySalesConsultation,
      LAB: c.tallySalesLab,
      PHARMACY: c.tallySalesPharmacy,
      IPD: c.tallySalesIpd,
      OTHER: c.tallySalesOther,
    },
    cash: c.tallyCashLedger,
    bank: c.tallyBankLedger,
    debtor: c.tallyDebtorLedger,
    cgst: c.tallyCgstLedger,
    sgst: c.tallySgstLedger,
  };
}

/**
 * Cash drawer or bank, by how it was paid.
 *
 * UPI, card and netbanking all settle into the bank account, not the till. The
 * distinction matters at reconciliation: only the CASH figure should match the
 * physical count at day close.
 */
const ledgerForMode = (mode: string, m: LedgerMap): string =>
  mode === "CASH" ? m.cash : m.bank;

const num = (v: { toString(): string }) => Number(v.toString());
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface TallyExportResult {
  filename: string;
  xml: string;
  counts: { sales: number; receipts: number; creditNotes: number };
  /** Bills skipped and why - shown to the accountant so nothing looks missing. */
  skipped: { receiptNo: string; reason: string }[];
}

export async function buildTallyExport(
  actor: AuthUser,
  range: { from: string; to: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<TallyExportResult> {
  const from = new Date(`${range.from}T00:00:00`);
  const to = new Date(`${range.to}T00:00:00`);
  to.setDate(to.getDate() + 1); // half-open: [from, to+1)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ApiError(400, "Invalid date range.");
  }
  if (to <= from) throw new ApiError(400, "The 'to' date must not be before the 'from' date.");

  const m = await ledgerMap();

  const invoices = await prisma.invoice.findMany({
    where: { createdAt: { gte: from, lt: to } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, receiptNo: true, source: true, status: true, createdAt: true,
      taxableAmount: true, cgstAmount: true, sgstAmount: true, totalAmount: true,
      buyerLegalName: true, buyerGstin: true,
      patient: { select: { fullName: true, displayId: true } },
      payments: { select: { mode: true, amount: true, reference: true, createdAt: true } },
      refunds: { select: { mode: true, amount: true, reason: true, createdAt: true } },
    },
  });

  const vouchers: TallyVoucher[] = [];
  const skipped: { receiptNo: string; reason: string }[] = [];
  let sales = 0, receipts = 0, creditNotes = 0;

  for (const inv of invoices) {
    // A bill that was cancelled never became income - see the note above.
    if (inv.status === "CANCELLED") {
      skipped.push({ receiptNo: inv.receiptNo, reason: "Cancelled" });
      continue;
    }

    const party = inv.buyerLegalName?.trim() || inv.patient.fullName;
    const income = m.sales[inv.source] ?? m.sales.OTHER;
    const taxable = num(inv.taxableAmount);
    const cgst = num(inv.cgstAmount);
    const sgst = num(inv.sgstAmount);
    const total = num(inv.totalAmount);

    if (total <= 0) {
      skipped.push({ receiptNo: inv.receiptNo, reason: "Zero value" });
      continue;
    }

    // ── Sales ────────────────────────────────────────────────────────────────
    // Always to the debtor ledger, never straight to cash. The Receipt voucher
    // below is what moves it out of debtors, and posting both is what makes an
    // unpaid inpatient bill show up as money owed rather than money taken.
    const salesEntries = [
      { ledger: m.debtor, amount: -r2(total) },
      { ledger: income, amount: r2(taxable) },
    ];
    if (cgst > 0) salesEntries.push({ ledger: m.cgst, amount: r2(cgst) });
    if (sgst > 0) salesEntries.push({ ledger: m.sgst, amount: r2(sgst) });

    vouchers.push({
      type: "Sales",
      date: toTallyDate(inv.createdAt.toISOString().slice(0, 10)),
      voucherNo: inv.receiptNo,
      partyName: party,
      narration: `${inv.source} - ${inv.patient.displayId}${inv.buyerGstin ? ` (B2B ${inv.buyerGstin})` : ""}`,
      entries: salesEntries,
    });
    sales++;

    // ── Receipts ─────────────────────────────────────────────────────────────
    // One per payment, because a split bill (part cash, part UPI) is two real
    // movements into two different ledgers and must reconcile as two.
    for (const [i, p] of inv.payments.entries()) {
      const amount = r2(num(p.amount));
      if (amount <= 0) continue;
      vouchers.push({
        type: "Receipt",
        date: toTallyDate(p.createdAt.toISOString().slice(0, 10)),
        voucherNo: `${inv.receiptNo}-R${i + 1}`,
        partyName: party,
        narration: `${p.mode}${p.reference ? ` ref ${p.reference}` : ""} against ${inv.receiptNo}`,
        entries: [
          { ledger: ledgerForMode(p.mode, m), amount: -amount },
          { ledger: m.debtor, amount },
        ],
      });
      receipts++;
    }

    // ── Credit notes ─────────────────────────────────────────────────────────
    // Money genuinely handed back. Posted against income, not against the
    // original sale, so the P&L shows the net position for the period.
    for (const [i, rf] of inv.refunds.entries()) {
      const amount = r2(num(rf.amount));
      if (amount <= 0) continue;
      vouchers.push({
        type: "Credit Note",
        date: toTallyDate(rf.createdAt.toISOString().slice(0, 10)),
        voucherNo: `${inv.receiptNo}-CN${i + 1}`,
        partyName: party,
        narration: `Refund (${rf.mode}): ${rf.reason}`,
        entries: [
          { ledger: income, amount: -amount },
          { ledger: ledgerForMode(rf.mode, m), amount },
        ],
      });
      creditNotes++;
    }
  }

  const xml = buildTallyXml({ companyName: m.company, from: range.from, to: range.to, vouchers });

  await logAudit(actor, {
    action: "TALLY_EXPORTED",
    targetTable: "Invoice",
    // An export spans many invoices, so the range IS the thing acted on. Using
    // one arbitrary invoice id here would make the audit trail read as though
    // somebody touched a single bill.
    targetId: `${range.from}..${range.to}`,
    meta: { from: range.from, to: range.to, sales, receipts, creditNotes, skipped: skipped.length },
    ...ctx,
  });

  return {
    filename: tallyFilename(range.from, range.to),
    xml,
    counts: { sales, receipts, creditNotes },
    skipped,
  };
}
