"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
// BillHead is deliberately NOT used here any more. It is a full-width centred
// masthead, and this sheet now sets the hospital beside the patient instead.
// The advance receipt still uses it, which is why it stays in stationery.
import { INVOICE_PRINT_CSS, PrintToolbar, type HospitalInfo } from "@/components/print/stationery";
import { billItemName, billItemBatch } from "@/lib/bill-item-name";

/**
 * THE BILL PRINTS IN INK, NOT IN BRAND COLOUR.
 *
 * Appended after the shared invoice stylesheet so it wins on specificity of
 * order, and scoped to this sheet so the advance receipt - which shares that
 * stylesheet - keeps the house green.
 *
 * `--pr-primary` is the hospital's teal, and it was on the masthead, the column
 * headings, the total rule and the amount in words. On the office laser printer
 * that everything actually comes out of, a mid-tone teal renders as a washed
 * grey that reads lighter than the body text - so the most important figure on
 * the page printed fainter than the address. Ink is one colour, prints black on
 * every device, and photocopies without turning to mush.
 *
 * The greys are darkened at the same time. #6b7772 on white is fine on a screen
 * and marginal at 7.5px through a toner cartridge that is two-thirds empty.
 */
/**
 * ── THE PAPER THIS BILL IS CUT FROM ──
 *
 * A4 IN THE TRAY, HALF AN A4 OF BILL. The hospital feeds ordinary A4 and cuts
 * the sheet across the middle, so the bill is 210mm WIDE and 148.5mm TALL - a
 * short, wide document. It was previously built as 148 x 210, which is the same
 * two numbers the other way round: a tall narrow bill printed onto a page the
 * printer was being told was A5. On an A4 tray that is what produced the
 * scaled-down, off-centre result.
 *
 * THE ARITHMETIC IS EXACT, and it is what makes the fold land in the right
 * place. A4 is 297mm tall. With a 10mm page margin the first copy starts at
 * 10mm; give it a height of 138.5mm and it ends at 148.5mm - the true half of
 * the sheet. A second copy then runs 148.5 -> 287mm, leaving the same 10mm at
 * the foot. So one A4 carries two halves with nothing left over, and the cut
 * line printed between them is the real midpoint rather than an approximation
 * somebody has to eyeball.
 *
 * A LAB BILL THEREFORE NEEDS NO PAGE BREAK. Both its copies live on one sheet -
 * patient above the cut, hospital below it - which is one sheet of paper per
 * lab bill instead of two.
 *
 * Nothing is edge-to-edge: the @page margin reserves the border no printer can
 * reach, so there is nothing for a driver to clip or to shrink to fit.
 */
const HALF_A4_MM = 138.5;

const BILL_MONO_CSS = `
  .print-stage { --pr-primary: #173f3a; --pr-accent: #173f3a; --pr-ink: #17211e; --pr-line: #b8c2be; --pr-soft: #f3f6f5; --pr-muted: #66736f; }
  #print-sheet table { border-collapse: collapse; }
  #print-sheet { box-sizing: border-box; }
  #print-sheet { width: 190mm !important; padding: 0 !important; background: transparent !important; box-shadow: none !important; min-height: 0 !important; }
  .bill-copy {
    box-sizing: border-box;
    min-height: ${HALF_A4_MM}mm;
    background: #fff;
    padding: 6mm 6mm 5mm;
    border: 0.5px solid #d5ddda;
    border-radius: 2px;
    color: var(--pr-ink);
  }
  .print-stage .bill-copy { box-shadow: 0 8px 40px rgba(0,0,0,.12); }
  .print-stage .bill-copy + .bill-copy { margin-top: 8mm; }
  .invoice-section-title { font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--pr-primary); }
  .invoice-meta-label { font-size: 8px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--pr-muted); }
  .invoice-meta-value { font-size: 10px; font-weight: 650; color: var(--pr-ink); }
  .invoice-soft { background: var(--pr-soft); }
  .invoice-table th { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #fff; background: var(--pr-primary); }
  .invoice-table td { border-bottom: .4px solid #d9dfdd; }
  .invoice-total { background: var(--pr-primary); color: #fff; }
  .invoice-status { border: .6px solid var(--pr-primary); color: var(--pr-primary); background: #fff; }
  .invoice-divider { border-top: .7px solid var(--pr-primary); }
  @media print {
    @page { size: A4 portrait; margin: 9mm 10mm; }
    #print-sheet { width: auto !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
    .print-stage .bill-copy { box-shadow: none !important; }
    .print-stage .bill-copy + .bill-copy { margin-top: 0 !important; }
    .cut-line { display: none !important; }
    .bill-copy ~ .bill-copy { border-top: 1px dashed #9aa5a1; }
    .bill-copy { height: ${HALF_A4_MM}mm; break-inside: avoid; page-break-inside: avoid; }
    .invoice-soft, .invoice-soft * , .invoice-total, .invoice-total * , .invoice-status, .invoice-status * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  }
`;


interface Invoice {
  id: string; receiptNo: string; source: string; status: string; createdAt: string;
  /** The corrected date to print, when a desk set one. Null on an uncorrected bill. */
  billDate?: string | null;
  patient: { displayId: string; fullName: string; phone: string; address: string | null; age: number | null; gender: string | null };
  items: { description: string; hsnSac: string | null; qty: number; unitPrice: string; amount: string; gstRatePct: string }[];
  subtotal: string; discountAmount: string; taxableAmount: string;
  cgstAmount: string; sgstAmount: string; totalAmount: string;
  amountPaid: string; advanceAdjusted: string; balanceDue: string;
  /** SELF_PAY or INSURANCE, with the insurer's name when it is the latter. */
  payer?: string; payerName?: string | null;
  payments: { mode: string; amount: string; reference: string | null; createdAt: string }[];
  hospital: HospitalInfo | null;
  buyer: { gstin: string; legalName: string; address: string | null; stateCode: string | null } | null;
  eInvoice: { irn: string; ackNo: string | null; ackDt: string | null; signedQrCode: string | null } | null;
}

const SOURCE_LABEL: Record<string, string> = {
  CONSULTATION: "OP Consultation", LAB: "Laboratory", PHARMACY: "Pharmacy", IPD: "Inpatient / Bed charges", OTHER: "Services",
};

/**
 * WHICH COPY OF THE BILL THIS IS.
 *
 * A lab bill prints twice - one for the patient, one for the hospital's own
 * file - so "the barcode" and "the header" stop being singular and each copy
 * needs its own. The wording follows the GST convention ("Original for
 * Recipient" / "Duplicate for Supplier") with the plain-English gloss beside it,
 * because the person filing the second copy is a receptionist, not a tax
 * consultant.
 */
interface CopyKind { formal: string; plain: string }
const COPY_PATIENT: CopyKind = { formal: "Original", plain: "Patient copy" };
const COPY_OFFICE: CopyKind = { formal: "Duplicate", plain: "Hospital copy" };

/**
 * One barcode, drawing into its own element.
 *
 * A component rather than a ref held by the sheet, because a lab bill renders
 * two copies and one ref can only ever point at the last of them - the first
 * copy would print an empty box where its barcode should be.
 */
function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128", displayValue: false, height: 24, width: 1.1,
        margin: 0, background: "transparent", lineColor: "#17211e",
      });
    } catch { /* non-encodable receipt - barcode simply omitted */ }
  }, [value]);
  return <svg ref={ref} className="h-[24px] w-[104px]" aria-label={`Barcode ${value}`} />;
}
const money = (v: string | number) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const GENDER: Record<string, string> = { MALE: "M", FEMALE: "F", OTHER: "O" };

/**
 * The Jeeva bill - one Bill-of-Supply layout used by every portal.
 *
 * A5, text masthead (no letterhead image), and it paginates onto a second sheet
 * when a stay has more lines than fit. "staff" reads the staff endpoint;
 * "portal" reads the patient-scoped one.
 */
export function InvoiceSheet({ source = "staff" }: { source?: "staff" | "portal" } = {}) {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const path = source === "portal" ? `/portal/invoice/${invoiceId}` : `/billing/invoice/${invoiceId}`;
    api.get<{ invoice: Invoice }>(path)
      .then((r) => setInv(r.invoice))
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the bill."));
  }, [invoiceId, source]);

  /**
   * The signed e-invoice QR.
   *
   * What is encoded is the string the government returned, byte for byte - not
   * anything derived from the invoice on screen. That string is a signed JWT,
   * and re-deriving or reformatting it would produce a QR that scans but fails
   * verification, which is worse than printing none at all.
   *
   * `qrcode` is imported dynamically: only B2B bills carry a QR, and the other
   * ninety-odd percent of bills shouldn't load the library to print.
   */
  useEffect(() => {
    const signed = inv?.eInvoice?.signedQrCode;
    if (!signed) { setQrDataUrl(null); return; }
    let cancelled = false;
    import("qrcode")
      .then((QR) => QR.toDataURL(signed, { errorCorrectionLevel: "M", margin: 0, width: 200 }))
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [inv]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!inv) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the bill…</div>;

  // THE DATE ON THE PAPER is the corrected one where a desk set one, and the
  // real one everywhere else. Every portal prints this one sheet, so a bill
  // re-dated at reception prints the same date from admin, the lab and the
  // patient's own portal - there is no second copy of this rule to forget.
  // `createdAt` is untouched and still what the day close counts; see the schema
  // note on Invoice.billDate.
  const created = new Date(inv.billDate ?? inv.createdAt);
  const gstApplies = Number(inv.cgstAmount) > 0 || Number(inv.sgstAmount) > 0;
  const discPctNum = Number(inv.subtotal) > 0 ? (Number(inv.discountAmount) / Number(inv.subtotal)) * 100 : 0;
  const discPct = discPctNum % 1 === 0 ? discPctNum.toFixed(0) : discPctNum.toFixed(1);
  const ageSex = [inv.patient.age != null ? `${inv.patient.age}y` : null, inv.patient.gender ? GENDER[inv.patient.gender] ?? inv.patient.gender : null].filter(Boolean).join(" / ") || "-";
  const payMode = inv.payments.length ? [...new Set(inv.payments.map((p) => p.mode))].join(", ") : "-";

  // The final chargeable amount = subtotal + GST, then (for inpatients only) less
  // the admission deposit. Every other desk's bill is a straight subtotal + GST;
  // the advance credit belongs to the IP section alone.
  const total = Number(inv.totalAmount);            // taxable + CGST + SGST
  const isIpd = inv.source === "IPD";
  const advance = isIpd ? Number(inv.advanceAdjusted) : 0;
  const netPayable = Math.max(0, Math.round((total - advance) * 100) / 100);

  const Meta = ({ k, v, right, strong }: { k: string; v: string; right?: boolean; strong?: boolean }) => (
    <div className={`flex items-baseline gap-1.5 ${right ? "justify-end" : ""}`}>
      <span className="shrink-0 whitespace-nowrap text-[7px] font-bold uppercase tracking-[0.06em] text-[#6b7772]">{k}</span>
      <span className={`truncate font-mono text-[9px] text-[var(--pr-ink)] ${strong ? "font-bold" : "font-medium"}`}>{v}</span>
    </div>
  );

  /**
   * Does this bill have batches to show?
   *
   * The column appears only when at least one line carries one - which in
   * practice means a pharmacy bill. A "Batch" heading over a column of dashes
   * on a consultation or a lab bill is worse than no column at all: it takes
   * width from the particulars and tells the reader nothing.
   */
  const showBatch = inv.items.some((it) => billItemBatch(it.description) !== null);

  const hospitalName = inv.hospital?.legalName ?? "Jeeva Multispeciality Hospital";
  const hospitalAddr = inv.hospital
    ? `${inv.hospital.addressLine}, ${inv.hospital.city}, ${inv.hospital.state} – ${inv.hospital.pincode}`
    : "# 1-8-81, Sai Nagar, Beside Swimming Pool, Balasamudram, Hanamkonda, Telangana – 506 001";
  const hospitalPhone = inv.hospital?.phone ?? "9704691308";

  /**
   * A LAB BILL PRINTS TWICE.
   *
   * The counter hands the patient theirs and keeps one for the file, so the two
   * come off the same press of the button rather than the desk printing, then
   * remembering, then printing again - which is how the file copy ends up
   * missing for exactly the bills somebody later queries.
   *
   * Only the lab. Every other counter still prints one: reception's bill is
   * already reconciled against the day close, and doubling every pharmacy slip
   * would double that counter's paper for no filing anybody does.
   */
  const copies: CopyKind[] = inv.source === "LAB" ? [COPY_PATIENT, COPY_OFFICE] : [COPY_PATIENT];

  /**
   * ONE COPY OF THE BILL, filling exactly half an A4.
   *
   * A COLUMN, NOT A STACK. The half-sheet is a fixed 138.5mm tall whatever the
   * bill contains, so the pieces are laid out as a flex column with the item
   * table taking the slack: the letterhead sits at the top edge, the totals sit
   * on the bottom edge, and a three-line lab bill and a fifteen-line stay bill
   * both come out looking like the same document rather than one of them
   * trailing off into half a page of white.
   */
  const renderCopy = (copy: CopyKind, idx: number) => (
    <div key={idx} className="bill-copy flex flex-col gap-[5px]">
      {/* Professional hospital invoice masthead */}
      <div className="flex items-start justify-between gap-5 border-b-[1.2px] pb-[5px]" style={{ borderColor: "var(--pr-primary)" }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {inv.hospital?.logoDataUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={inv.hospital.logoDataUrl} alt="Hospital logo" className="h-[28px] w-[28px] shrink-0 object-contain" />
            )}
            <div>
              <div className="text-[14px] font-extrabold uppercase leading-none tracking-tight" style={{ color: "var(--pr-primary)" }}>
                {hospitalName}
              </div>
              <div className="mt-[2px] text-[6.5px] font-medium leading-snug text-[#45524e]">{hospitalAddr}</div>
              <div className="mt-[1px] flex flex-wrap gap-x-3 text-[6.5px] font-semibold text-[#45524e]">
                {inv.hospital?.gstin && <span>GSTIN: <span className="font-mono">{inv.hospital.gstin}</span></span>}
                <span>Phone: <span className="font-mono">{hospitalPhone}</span></span>
              </div>
            </div>
          </div>
        </div>
        <div className="w-[118px] shrink-0 text-right">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.08em]" style={{ color: "var(--pr-primary)" }}>
            {gstApplies ? "Tax Invoice" : "Bill of Supply"}
          </div>
          <div className="mt-[2px] inline-block border px-2 py-[2px] text-[6px] font-bold uppercase tracking-[0.08em] invoice-status">
            {copy.formal} · {copy.plain}
          </div>
          <div className="mt-[3px] grid grid-cols-[38px_1fr] gap-x-2 gap-y-[1px] text-right">
            <span className="invoice-meta-label">Bill No</span><span className="invoice-meta-value font-mono">{inv.receiptNo}</span>
            <span className="invoice-meta-label">Date</span><span className="invoice-meta-value">{created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
            <span className="invoice-meta-label">Dept</span><span className="invoice-meta-value">{SOURCE_LABEL[inv.source] ?? inv.source}</span>
          </div>
        </div>
      </div>

      {/* Patient / visit information */}
      <div className="invoice-soft rounded-[2px] px-[5px] py-[4px]">
        <div className="invoice-section-label mb-[3px]">
          Patient & Visit Details
        </div>

        <div className="grid grid-cols-5 gap-x-3">
          <div className="min-w-0 ">
            <div className="invoice-meta-title">Patient Name</div>
            <div className="invoice-meta-value truncate">
              {inv.patient.fullName}
            </div>
          </div>

          <div className="min-w-0">
            <div className="invoice-meta-title">UHID</div>
            <div className="invoice-meta-value font-mono truncate">
              {inv.patient.displayId}
            </div>
          </div>

          <div className="min-w-0">
            <div className="invoice-meta-label">Age / Sex</div>
            <div className="invoice-meta-value truncate">
              {ageSex}
            </div>
          </div>

          <div className="min-w-0">
            <div className="invoice-meta-label">Mobile</div>
            <div className="invoice-meta-value font-mono truncate">
              {inv.patient.phone}
            </div>
          </div>

          <div className="min-w-0">
            <div className="invoice-meta-label">Address</div>
            <div className="invoice-meta-value truncate">
              {inv.patient.address || "-"}
            </div>
          </div>
        </div>
      </div>

      {/* Billing particulars */}
      <div className="min-h-0 flex-1">
        <div className="invoice-section-title mb-[3px]">Billing Particulars</div>
        <table className="invoice-table w-full text-[8px]">
          <thead>
            <tr className="text-left">
              <th className="w-[18px] px-1 py-[4px] text-center">#</th>
              <th className="px-1.5 py-[4px]">Description</th>
              {showBatch && <th className="w-[58px] px-1 py-[4px]">Batch</th>}
              <th className="w-[45px] px-1 py-[4px]">HSN/SAC</th>
              <th className="w-[27px] px-1 py-[4px] text-right">Qty</th>
              <th className="w-[56px] px-1 py-[4px] text-right">Rate</th>
              <th className="w-[32px] px-1 py-[4px] text-right">GST</th>
              <th className="w-[70px] px-1.5 py-[4px] text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={i} className="align-top">
                <td className="px-1 py-[3px] text-center font-mono text-[7px] text-[#65716d]">{i + 1}</td>
                <td className="px-1.5 py-[3px] font-medium">{billItemName(it.description)}</td>
                {showBatch && <td className="px-1 py-[3px] font-mono text-[7px] text-[#46524e]">{billItemBatch(it.description) ?? "—"}</td>}
                <td className="px-1 py-[3px] font-mono text-[7px] text-[#65716d]">{it.hsnSac ?? "—"}</td>
                <td className="px-1 py-[3px] text-right font-mono">{it.qty}</td>
                <td className="px-1 py-[3px] text-right font-mono">{money(it.unitPrice)}</td>
                <td className="px-1 py-[3px] text-right font-mono text-[7px] text-[#65716d]">{Number(it.gstRatePct) ? `${it.gstRatePct}%` : "—"}</td>
                <td className="px-1.5 py-[3px] text-right font-mono font-bold">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Settlement + totals */}
      <div className="invoice-divider pt-[5px]">
        <div className="grid grid-cols-[1fr_190px] gap-5 items-start">
          <div className="min-w-0">
            <div className="invoice-section-title">Settlement</div>
            <div className="mt-[2px] text-[8px] font-bold leading-snug">{amountInWords(netPayable)}</div>
            {inv.payer === "INSURANCE" ? (
              <div className="mt-[3px] text-[7px] leading-snug"><span className="font-bold">Payer:</span> {inv.payerName || "Insurer / TPA"} · Cashless</div>
            ) : inv.payments.length > 0 ? (
              <div className="mt-[3px] text-[7px]"><span className="font-bold">Payment mode:</span> {payMode}</div>
            ) : null}

            {inv.eInvoice && (
              <div className="mt-[4px] flex items-center gap-2 border-t border-[#d9dfdd] pt-[3px]">
                {qrDataUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={qrDataUrl} alt="Signed e-invoice QR code" className="h-[36px] w-[36px] shrink-0" />
                )}
                <div className="min-w-0 font-mono text-[5.8px] leading-tight text-[#4a5652]">
                  <div><span className="font-bold">IRN:</span> {inv.eInvoice.irn}</div>
                  {inv.eInvoice.ackNo && <div><span className="font-bold">Ack No:</span> {inv.eInvoice.ackNo}</div>}
                  {inv.eInvoice.ackDt && <div><span className="font-bold">Ack Date:</span> {inv.eInvoice.ackDt}</div>}
                </div>
              </div>
            )}
          </div>

          <div>
            <table className="w-full text-[8px]">
              <tbody>
                <Trow k="Sub-total" v={money(inv.subtotal)} />
                {Number(inv.discountAmount) > 0 && <Trow k={`Discount (${discPct}%)`} v={`− ${money(inv.discountAmount)}`} />}
                {gstApplies && Number(inv.discountAmount) > 0 && <Trow k="Taxable value" v={money(inv.taxableAmount)} />}
                {gstApplies && <Trow k="CGST" v={money(inv.cgstAmount)} />}
                {gstApplies && <Trow k="SGST" v={money(inv.sgstAmount)} />}
                {isIpd && advance > 0 ? (
                  <>
                    <Trow k="Total incl. GST" v={money(total)} />
                    <Trow k="Less: Advance" v={`− ${money(advance)}`} accent />
                    <TotalRow k="Net Payable" v={money(netPayable)} />
                  </>
                ) : <TotalRow k="Net Payable" v={money(total)} />}
              </tbody>
            </table>
            <div className="mt-[3px] flex justify-between text-[6px] text-[#65716d]">
              <span>Payment status</span>
              <span className="font-bold uppercase" style={{ color: "var(--pr-primary)" }}>
                {inv.payer === "INSURANCE" ? "CASHLESS" : Number(inv.balanceDue) > 0 ? "BALANCE DUE" : "PAID"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between gap-4 border-t border-[#d9dfdd] pt-[3px]">
        <div className="min-w-0 flex-1 text-[5.8px] leading-snug text-[#697570]">
          {inv.hospital?.invoiceFooterNote ? <span className="whitespace-pre-line">{inv.hospital.invoiceFooterNote}</span> : "This is a computer-generated invoice. Please retain it for your records."}
        </div>
        {copy === COPY_OFFICE ? (
          <div className="w-[95px] text-center">
            <div className="border-t border-[#7f8b87]" />
            <div className="mt-[1px] text-[6px] font-bold uppercase tracking-wide text-[#66736f]">Authorised Signatory</div>
          </div>
        ) : (
          <div className="text-right text-[5.8px] text-[#7b8581]">Computer-generated<br />No signature required</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: INVOICE_PRINT_CSS + BILL_MONO_CSS }} />
      <PrintToolbar
        title={`Bill · ${inv.receiptNo} · ${inv.patient.fullName}${copies.length > 1 ? " · 2 copies" : ""}`}
      />

      <div id="print-sheet">
        {copies.map((copy, i) => (
          <Fragment key={i}>
            {/* The fold, drawn. "Half of A4" measured by eye is how one copy
                loses its last line - and on a lab bill the two halves are two
                different documents, so the cut has to be findable without
                holding the sheet up to the light. */}
            {i > 0 && <div className="cut-line my-[2mm]">cut here</div>}
            {renderCopy(copy, i)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Trow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <tr>
      <td className={`py-0.5 text-[9.5px] ${accent ? "font-semibold text-[var(--pr-ink)]" : "text-[#4a5652]"}`}>{k}</td>
      <td className={`py-0.5 text-right font-mono ${accent ? "font-semibold text-[var(--pr-ink)]" : ""}`}>{v}</td>
    </tr>
  );
}

/**
 * The grand total - the one figure the patient pays.
 *
 * Carried on a filled black band rather than a coloured rule. It is the only
 * reversed element on the sheet, which is what makes it findable in a second on
 * a page that is otherwise uniform ink - and unlike a tint it survives a
 * photocopy, which is what a patient's insurer usually receives.
 */
function TotalRow({ k, v }: { k: string; v: string }) {
  return (
    <tr className="total-band">
      <td className="py-[5px] pl-1.5 text-[9px] font-extrabold uppercase tracking-wide text-white"
        style={{ background: "var(--pr-ink)" }}>{k}</td>
      <td className="py-[5px] pr-1.5 text-right font-mono text-[12px] font-bold text-white"
        style={{ background: "var(--pr-ink)" }}>{v}</td>
    </tr>
  );
}