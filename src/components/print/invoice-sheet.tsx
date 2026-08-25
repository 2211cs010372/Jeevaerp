"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
// The packing arithmetic is the lab report's, and it is not lab-specific: rows,
// a paper height, and the rule that a row lands on exactly one sheet. A bill
// that outgrows its half-sheet is the same problem as a panel that outgrows an
// A4, so it gets the same tested answer rather than a second one.
import { rowsThatFit, repack, pageSlices } from "@/lib/lab-pagination";
// BillHead is deliberately NOT used here any more. It is a full-width centred
// masthead, and this sheet now sets the hospital beside the patient instead.
// The advance receipt still uses it, which is why it stays in stationery.
import { INVOICE_PRINT_CSS, PrintToolbar, type HospitalInfo } from "@/components/print/stationery";
import { billItemName, billItemBatch } from "@/lib/bill-item-name";

/**
 * THE BILL PRINTS IN INK, ON WHITE. NOTHING IS REVERSED OUT.
 *
 * Appended after the shared invoice stylesheet so it wins on specificity of
 * order, and scoped to this sheet so the advance receipt - which shares that
 * stylesheet - keeps the house green.
 *
 * `--pr-primary` was the hospital's teal, and it was on the masthead, the column
 * headings, the total rule and the amount in words. On the office laser printer
 * that everything actually comes out of, a mid-tone teal renders as a washed
 * grey that reads lighter than the body text - so the most important figure on
 * the page printed fainter than the address. Ink is one colour, prints black on
 * every device, and photocopies without turning to mush. Every brand token on
 * this sheet therefore resolves to ink.
 *
 * THE FILLED BANDS ARE GONE FOR A HARDER REASON THAN TASTE. The column headings
 * sat as white text on a teal fill and the grand total as white text on a black
 * one, and a background is the one thing a print driver is free to drop -
 * "background graphics" is off by default in most of them, and the desk's driver
 * has it off. Drop the fill and white text lands on white paper: on the bills
 * coming off the counter right now, DESCRIPTION / HSN / QTY / RATE / AMOUNT and
 * NET PAYABLE - the heading row and the one figure the patient pays - are the
 * two things that print faintest, or not at all. So the total is carried on
 * rules instead of a band, and the heading row on a top-and-bottom rule. Rules
 * are borders; no driver setting suppresses those.
 *
 * The greys are darkened and neutralised at the same time. #6b7772 is a
 * green-cast grey: fine on a screen, marginal at 7.5px through a toner cartridge
 * that is two-thirds empty, and off-message on a sheet that is meant to be one
 * colour.
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
  .print-stage {
    --pr-ink: #111111;
    /* The brand tokens still exist because the shared stylesheet references
       them; on this sheet they are ink, so a stray var() can't reintroduce a
       colour. */
    --pr-primary: var(--pr-ink); --pr-accent: var(--pr-ink);
    --pr-line: #9c9c9c; --pr-hair: #cfcfcf; --pr-muted: #3f3f3f;
  }
  #print-sheet table { border-collapse: collapse; }
  #print-sheet { box-sizing: border-box; }
  #print-sheet { width: 190mm !important; padding: 0 !important; background: transparent !important; box-shadow: none !important; min-height: 0 !important; }
  .bill-copy {
    box-sizing: border-box;
    min-height: ${HALF_A4_MM}mm;
    background: #fff;
    padding: 6mm 6mm 5mm;
    border: 0.5px solid var(--pr-hair);
    border-radius: 2px;
    color: var(--pr-ink);
  }
  .print-stage .bill-copy { box-shadow: 0 8px 40px rgba(0,0,0,.12); }
  .print-stage .bill-copy + .bill-copy { margin-top: 8mm; }
  /* -label and -title are the same thing under two names, both live in the
     markup; aliasing beats leaving half the patient block unstyled. */
  .invoice-section-title, .invoice-section-label { font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--pr-ink); }
  .invoice-meta-label, .invoice-meta-title { font-size: 8px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--pr-muted); }
  .invoice-meta-value { font-size: 10px; font-weight: 650; color: var(--pr-ink); }
  /* THE PATIENT BLOCK IS SET THE WAY THE LAB REPORT SETS ITS IDENTITY BLOCK:
     "Label : value" on one line, colons aligned down each column, label in
     sentence case rather than the tracked uppercase used for the bill's own
     meta. Same row, a shade under the report's own size - the report is a full
     A4 at 12px and this is half an A4, so the block sits at 10.5px: the largest
     the patient's name reads at without crowding the item table beneath it,
     which is the part of the sheet the bill exists to carry. */
  .invoice-id-label { font-size: 10.5px; font-weight: 500; color: var(--pr-ink); line-height: 3.9mm; }
  .invoice-id-value { font-size: 10.5px; font-weight: 700; color: var(--pr-ink); line-height: 3.9mm; }
  /* The patient block was a tint. A tint is a background too - same driver, same
     disappearing act - so it is a ruled box now. */
  .invoice-soft { background: #fff; border: .5px solid var(--pr-hair); }
  .invoice-table th {
    font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
    color: var(--pr-ink); background: #fff;
    border-top: .8px solid var(--pr-ink); border-bottom: .8px solid var(--pr-ink);
  }
  .invoice-table td { border-bottom: .4px solid var(--pr-hair); }
  /* The grand total, ruled the way a ledger rules one: a line above, a double
     line below. Reads as the last word on the page without a drop of fill. */
  .total-band td { background: #fff; color: var(--pr-ink); border-top: 1px solid var(--pr-ink); border-bottom: 3px double var(--pr-ink); }
  .invoice-status { border: .6px solid var(--pr-ink); color: var(--pr-ink); background: #fff; }
  .invoice-divider { border-top: .7px solid var(--pr-ink); }
  @media print {
    @page { size: A4 portrait; margin: 9mm 10mm; }
    #print-sheet { width: auto !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
    .print-stage .bill-copy { box-shadow: none !important; }
    .print-stage .bill-copy + .bill-copy { margin-top: 0 !important; }
    .cut-line { display: none !important; }
    /* The cut line marks the FOLD, and the fold is only ever between the first
       and second half-sheet of one physical A4 - never above a half-sheet that
       starts a fresh page. It used to be a general-sibling rule, which was
       right while a bill was at most two copies on one sheet and wrong the
       moment a long bill runs to three or four half-sheets: the third would
       print a cut line across the top of page two, where there is nothing to
       cut. The half a sheet sits on is counted in the render, because in print
       the cut markers are display:none and nth-child can no longer see it. */
    .bill-copy.lower-half { border-top: 1px dashed #999999; }
    .bill-copy { height: ${HALF_A4_MM}mm; break-inside: avoid; page-break-inside: avoid; }
    /* No print-color-adjust override any more: nothing on the sheet depends on
       a background being printed, so there is nothing left to force. */
  }
`;


export interface Invoice {
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
 * ONE HALF-SHEET OF A BILL: which slice of the items it carries, where it sits
 * in the run, and whether it is the lower half of a physical A4.
 *
 * A short bill is one of these and reads exactly as it did before this existed.
 * A long one is several, and everything that must not be duplicated across them
 * - the totals, the signature line, the footer note - is gated on `page` being
 * the last.
 */
interface SheetCtx {
  /** Items on this sheet: `inv.items[start … end)`. */
  start: number; end: number;
  /** 0-based sheet within this copy, and how many sheets the copy runs to. */
  page: number; pages: number;
  /** Second half of a physical A4 - the one edge that is a real fold. */
  lowerHalf: boolean;
  /** Measured only on the first copy; the others are the same bill. */
  ref?: (el: HTMLDivElement | null) => void;
}

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
        margin: 0, background: "transparent", lineColor: "#111111",
      });
    } catch { /* non-encodable receipt - barcode simply omitted */ }
  }, [value]);
  return <svg ref={ref} className="h-[24px] w-[104px]" aria-label={`Barcode ${value}`} />;
}
const money = (v: string | number) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const GENDER: Record<string, string> = { MALE: "M", FEMALE: "F", OTHER: "O" };

/**
 * One "Label : value" line of the patient block, colon-aligned down its column.
 *
 * The counterpart of IdRow in lab-report-sheet, and deliberately the same shape:
 * the two documents are handed across the same counter, often for the same
 * visit, and a patient holding both should be reading one hospital's paper
 * rather than two departments' house styles.
 *
 * THE COLON HAS A COLUMN OF ITS OWN, unheaded, between label and value. Left
 * inside the label's cell it would ride at the end of the text and step left and
 * right down the block as the labels change length; in the value's cell it would
 * move with the wrapping. Its own track is what makes the colons line up.
 */
function InvoiceIdRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <span className="invoice-id-label">{k}</span>
      <span className="invoice-id-label">:</span>
      <span className={`invoice-id-value ${mono ? "font-mono tracking-tight" : ""}`}>{v || "-"}</span>
    </>
  );
}

/**
 * The Jeeva bill - one Bill-of-Supply layout used by every portal.
 *
 * A5, text masthead (no letterhead image), and it paginates onto a second sheet
 * when a stay has more lines than fit. "staff" reads the staff endpoint;
 * "portal" reads the patient-scoped one.
 */
/**
 * FETCH ONE BILL AND PRINT IT. The wrapper every /print/invoice/[id] route uses.
 *
 * The document itself is `InvoiceDoc` below, which takes an already-loaded
 * invoice. They are split because a stay's bills are also printed TOGETHER -
 * one job, one paper tray, every counter's invoice in the run - and that page
 * has several invoices in hand at once and no route parameter to fetch by.
 */
export function InvoiceSheet({ source = "staff" }: { source?: "staff" | "portal" } = {}) {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const path = source === "portal" ? `/portal/invoice/${invoiceId}` : `/billing/invoice/${invoiceId}`;
    api.get<{ invoice: Invoice }>(path)
      .then((r) => setInv(r.invoice))
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the bill."));
  }, [invoiceId, source]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!inv) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the bill…</div>;
  return <InvoiceDoc inv={inv} />;
}

/** The stylesheet one invoice needs, so a page printing SEVERAL can emit it once. */
export const INVOICE_SHEET_CSS = INVOICE_PRINT_CSS + BILL_MONO_CSS;

/**
 * One invoice, rendered. Takes the bill already loaded - see InvoiceSheet.
 *
 * `embedded` drops the page furniture: the print-stage wrapper, the stylesheet
 * and the toolbar. A page printing a whole stay's bills supplies those once for
 * the run, and repeating them per invoice would emit the same stylesheet six
 * times and stack six toolbars down the screen.
 */
export function InvoiceDoc({ inv, embedded }: { inv: Invoice; embedded?: boolean }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

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

  /**
   * ── A BILL LONGER THAN ITS PAPER RUNS ON TO THE NEXT SHEET ──
   *
   * The half-sheet is a fixed 138.5mm whatever the bill contains - that is what
   * makes the fold land in the right place - and a pharmacy bill is the one that
   * outgrows it. Twenty-odd lines of medicine, each with a batch number, is an
   * ordinary discharge; the sheet held roughly a dozen. Everything past that did
   * not wrap, or scroll, or print small: it printed UNDERNEATH the totals block
   * and off the bottom edge of the half-sheet, and the bill still footed to the
   * right number. So the sheet the patient was handed showed a Net Payable it
   * had no lines to justify, and the pharmacy's own copy was missing exactly the
   * items anybody would later query.
   *
   * `pageStarts[k]` is the index of the first item on sheet k, so `[0]` is
   * everything on one sheet and `[0, 12]` is items 0-11 then 12 onwards.
   *
   * MEASURED, NOT ESTIMATED. A row's height depends on how the medicine's name
   * wraps in its column, and a name like "Amoxycillin + Clavulanic Acid 625mg"
   * takes two lines where a lab test takes one - so a fixed rows-per-page count
   * is wrong for the exact bills that need this. Each sheet is measured against
   * the paper it is standing on, sheds what hangs over, and the arithmetic that
   * decides where the break lands lives in @/lib/lab-pagination, tested there
   * without a DOM. Breaks only ever move EARLIER, so this settles in one pass
   * per new sheet instead of two sheets trading a row back and forth.
   */
  const sheetsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [pageStarts, setPageStarts] = useState<number[]>([0]);

  // A different bill is a different packing. Reset DURING render, not from an
  // effect - an effect would run after the packing below had already asked for
  // its first break, and the two updates would cancel.
  const layoutKey = `${inv.id}|${inv.items.length}`;
  const [packed, setPacked] = useState(layoutKey);
  if (packed !== layoutKey) { setPacked(layoutKey); setPageStarts([0]); }

  // On layout rather than on paint, so the sheets settle before anything is
  // shown - and before the desk can hit Print on a half-packed bill.
  useLayoutEffect(() => {
    const sheets = sheetsRef.current.slice(0, pageStarts.length).filter(Boolean) as HTMLDivElement[];
    if (sheets.length !== pageStarts.length) return;

    for (let k = 0; k < sheets.length; k++) {
      const sheet = sheets[k];
      // On screen the half-sheet's height is a min-height, so whatever the sheet
      // stands taller than that is exactly what would be lost off the bottom in
      // print, where the same measurement is a hard height.
      const paper = parseFloat(getComputedStyle(sheet).minHeight);
      if (!Number.isFinite(paper) || paper <= 0) continue;
      // 1px of slack: browsers round page geometry in device pixels, and chasing
      // that last rounding error would re-page every bill in the building.
      const over = sheet.offsetHeight - paper;
      if (over <= 1) continue;

      const rows = Array.from(sheet.querySelectorAll<HTMLElement>("[data-bill-row]"));
      // One line that overflows a sheet on its own cannot be helped by moving
      // it - it would overflow the next sheet identically. Leave it be.
      if (rows.length <= 1) continue;

      const keep = rowsThatFit(rows.map((el) => el.offsetHeight), over);
      const next = repack(pageStarts, k, keep, inv.items.length);
      // Identity means the packing has nothing left to give here - fall through
      // rather than scheduling a render that changes nothing.
      if (next !== pageStarts) { setPageStarts(next); return; }
    }
  });

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
      <span className="shrink-0 whitespace-nowrap text-[7px] font-bold uppercase tracking-[0.06em] text-[#3f3f3f]">{k}</span>
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
   * What the first `n` items of the bill come to.
   *
   * The carried-forward / brought-forward figures on a bill that runs to several
   * sheets. Summed from the item amounts rather than from the subtotal, because
   * these are running totals of LINES: the discount and the GST apply to the
   * bill as a whole and belong only in the totals block on the last sheet.
   */
  const runningTo = (n: number) => inv.items.slice(0, n).reduce((s, it) => s + Number(it.amount), 0);

  /**
   * ONE COPY OF THE BILL, filling exactly half an A4.
   *
   * A COLUMN, NOT A STACK. The half-sheet is a fixed 138.5mm tall whatever the
   * bill contains, so the pieces are laid out as a flex column: the letterhead
   * sits at the top edge, the totals sit on the bottom edge, and a three-line
   * lab bill and a fifteen-line stay bill both come out looking like the same
   * document rather than one of them trailing off into half a page of white.
   *
   * THE SLACK IS TAKEN BY A MARGIN, NOT BY THE TABLE, and the difference is the
   * whole reason a long bill used to lose its tail. The item table sat in a
   * `flex-1 min-h-0` box: `flex-1` bases it at zero and `min-h-0` waives the
   * automatic minimum, so a table too tall for the sheet did not push the sheet
   * taller - it hung out of a box that never grew, printing over the totals and
   * off the paper. Nothing in the layout could tell that anything was wrong,
   * which is why nothing ever paged it. `mt-auto` on the settlement block pins
   * the totals to the bottom edge exactly as before, while leaving the sheet
   * free to stand taller than the paper when it has to - and standing taller is
   * precisely the signal the packing loop above measures.
   */
  const renderCopy = (copy: CopyKind, sheet: SheetCtx) => (
    <div
      ref={sheet.ref}
      className={`bill-copy flex flex-col gap-[5px]${sheet.lowerHalf ? " lower-half" : ""}`}
    >
      {/* Professional hospital invoice masthead */}
      <div className="flex items-start justify-between gap-5 border-b-[1.2px] pb-[5px]" style={{ borderColor: "var(--pr-ink)" }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {inv.hospital?.logoDataUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={inv.hospital.logoDataUrl} alt="Hospital logo" className="h-[28px] w-[28px] shrink-0 object-contain" />
            )}
            <div>
              <div className="text-[14px] font-extrabold uppercase leading-none tracking-tight" style={{ color: "var(--pr-ink)" }}>
                {hospitalName}
              </div>
              <div className="mt-[2px] text-[6.5px] font-medium leading-snug text-[#3f3f3f]">{hospitalAddr}</div>
              <div className="mt-[1px] flex flex-wrap gap-x-3 text-[6.5px] font-semibold text-[#3f3f3f]">
                {inv.hospital?.gstin && <span>GSTIN: <span className="font-mono">{inv.hospital.gstin}</span></span>}
                <span>Phone: <span className="font-mono">{hospitalPhone}</span></span>
              </div>
            </div>
          </div>
        </div>
        <div className="w-[118px] shrink-0 text-right">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.08em]" style={{ color: "var(--pr-ink)" }}>
            {gstApplies ? "Tax Invoice" : "Bill of Supply"}
          </div>
          <div className="mt-[2px] inline-block border px-2 py-[2px] text-[6px] font-bold uppercase tracking-[0.08em] invoice-status">
            {copy.formal} · {copy.plain}
          </div>
          <div className="mt-[3px] grid grid-cols-[38px_1fr] gap-x-2 gap-y-[1px] text-right">
            <span className="invoice-meta-label">Bill No</span><span className="invoice-meta-value font-mono">{inv.receiptNo}</span>
            <span className="invoice-meta-label">Date</span><span className="invoice-meta-value">{created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}{" "}{created.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
            <span className="invoice-meta-label">Dept</span><span className="invoice-meta-value">{SOURCE_LABEL[inv.source] ?? inv.source}</span>
            {/* Only on a bill that actually runs to more than one sheet. "Page
                1 of 1" on the ninety-odd percent that don't is a line that
                answers a question nobody was asking, on the part of the sheet
                where the bill number lives. */}
            {sheet.pages > 1 && (
              <>
                <span className="invoice-meta-label">Page</span>
                <span className="invoice-meta-value font-mono">{sheet.page + 1} of {sheet.pages}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Patient / visit information */}
      <div className="invoice-soft rounded-[2px] px-[5px] py-[4px]">
        <div className="invoice-section-label mb-[3px]">
          Patient & Visit Details
        </div>

        {/* Two colon-aligned columns, as on the lab report. The fields were
            previously stacked - label above value, five of them across a row -
            which reads as a form to be filled rather than a record already
            written, and gave the address a single truncated line to live on. */}
        <div className="grid grid-cols-2 gap-x-6">
          <div className="grid grid-cols-[72px_6px_1fr] items-baseline">
            <InvoiceIdRow k="Patient Name" v={inv.patient.fullName} />
            <InvoiceIdRow k="Age / Sex" v={ageSex} />
            <InvoiceIdRow k="UHID" v={inv.patient.displayId} mono />
          </div>
          <div className="grid grid-cols-[72px_6px_1fr] items-baseline">
            <InvoiceIdRow k="Mobile" v={inv.patient.phone} mono />
            <InvoiceIdRow k="Address" v={inv.patient.address || "-"} />
          </div>
        </div>
      </div>

      {/* Billing particulars */}
      <div>
        <div className="mb-[3px] flex items-baseline justify-between gap-3">
          <div className="invoice-section-title">Billing Particulars</div>
          {/* A continuation sheet says what it follows and what the lines before
              it came to. Half-sheets get separated - they are cut apart with
              scissors - and one that turns up on its own should still be
              readable as part of a bill rather than as a bill missing a total. */}
          {sheet.page > 0 && (
            <div className="shrink-0 text-[7px] font-bold uppercase tracking-[0.06em] text-[#3f3f3f]">
              Brought forward from page {sheet.page} · <span className="font-mono">{money(runningTo(sheet.start))}</span>
            </div>
          )}
        </div>
        <table className="invoice-table w-full text-[8px]">
          <thead>
            <tr className="text-left">
              <th className="w-[18px] px-1 py-[4px] text-center">#</th>
              <th className="px-1.5 py-[4px]">Description</th>
              {/* GATED TOGETHER WITH ITS CELL BELOW, and they must stay that
                  way. The header was conditional and the body cell was not, so
                  on every bill with no batch on it - a lab bill, an OP consult,
                  a discharge bill; everything except pharmacy - the row carried
                  one more cell than the header did. Each value printed under
                  the heading of the column to its left (S.PROFILE under QTY,
                  the qty under RATE, the rate under GST) and the AMOUNT fell
                  off the end of the ruled table into an eighth column that had
                  no heading at all. The bill added up and every figure on it
                  was against the wrong word. */}
              {showBatch && <th className="w-[58px] px-1 py-[4px]">Batch</th>}
              <th className="w-[45px] px-1 py-[4px]">HSN/SAC</th>
              <th className="w-[27px] px-1 py-[4px] text-right">Qty</th>
              <th className="w-[56px] px-1 py-[4px] text-right">Rate</th>
              <th className="w-[32px] px-1 py-[4px] text-right">GST</th>
              <th className="w-[70px] px-1.5 py-[4px] text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.slice(sheet.start, sheet.end).map((it, i) => (
              /* `data-bill-row` is what the packing loop measures. It marks the
                 rows that may be MOVED to another sheet - so it goes on the item
                 rows and on nothing else, or the loop would try to shed a
                 heading onto page two. */
              <tr key={sheet.start + i} data-bill-row className="align-top">
                {/* The serial number counts through the WHOLE bill, not through
                    the sheet: item 14 is item 14 whichever half-sheet it landed
                    on, which is how a question about it gets answered at the
                    counter three weeks later. */}
                <td className="px-1 py-[3px] text-center font-mono text-[7px] text-[#3f3f3f]">{sheet.start + i + 1}</td>
                <td className="px-1.5 py-[3px] font-medium">{billItemName(it.description)}</td>
                {showBatch && <td className="px-1 py-[3px] font-mono text-[7px] text-[#3f3f3f]">{billItemBatch(it.description) ?? "—"}</td>}
                <td className="px-1 py-[3px] font-mono text-[7px] text-[#3f3f3f]">{it.hsnSac ?? "—"}</td>
                <td className="px-1 py-[3px] text-right font-mono">{it.qty}</td>
                <td className="px-1 py-[3px] text-right font-mono">{money(it.unitPrice)}</td>
                <td className="px-1 py-[3px] text-right font-mono text-[7px] text-[#3f3f3f]">{Number(it.gstRatePct) ? `${it.gstRatePct}%` : "—"}</td>
                <td className="px-1.5 py-[3px] text-right font-mono font-bold">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── THE END OF THE BILL, ON THE SHEET THAT IS THE END OF THE BILL ──
          The totals, the amount in words, the e-invoice QR, the signature line
          and the footer note all print ONCE, on the last sheet. A Net Payable
          repeated at the foot of every half-sheet of a four-sheet bill is four
          documents each claiming to be the whole bill - and the one somebody
          pays against is whichever they happen to be holding. Earlier sheets
          get a carried-forward line instead, which says the opposite: this is
          not the end, and here is what the lines above came to. */}
      {sheet.page === sheet.pages - 1 ? (
        <>
          {/* Settlement + totals */}
          <div className="invoice-divider mt-auto pt-[5px]">
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
                  <div className="mt-[4px] flex items-center gap-2 border-t border-[#cfcfcf] pt-[3px]">
                    {qrDataUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={qrDataUrl} alt="Signed e-invoice QR code" className="h-[36px] w-[36px] shrink-0" />
                    )}
                    <div className="min-w-0 font-mono text-[5.8px] leading-tight text-[#333333]">
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
                <div className="mt-[3px] flex justify-between text-[6px] text-[#3f3f3f]">
                  <span>Payment status</span>
                  <span className="font-bold uppercase" style={{ color: "var(--pr-ink)" }}>
                    {inv.payer === "INSURANCE" ? "CASHLESS" : Number(inv.balanceDue) > 0 ? "BALANCE DUE" : "PAID"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-4 border-t border-[#cfcfcf] pt-[3px]">
            <div className="min-w-0 flex-1 text-[5.8px] leading-snug text-[#4a4a4a]">
              {inv.hospital?.invoiceFooterNote ? <span className="whitespace-pre-line">{inv.hospital.invoiceFooterNote}</span> : "This is a computer-generated invoice. Please retain it for your records."}
            </div>
            {copy === COPY_OFFICE ? (
              <div className="w-[95px] text-center">
                <div className="border-t border-[#111111]" />
                <div className="mt-[1px] text-[6px] font-bold uppercase tracking-wide text-[#3f3f3f]">Authorised Signatory</div>
              </div>
            ) : (
              <div className="text-right text-[5.8px] text-[#555555]">Computer-generated<br />No signature required</div>
            )}
          </div>
        </>
      ) : (
        /* Not the end. The one thing this foot must do is stop the sheet from
           being mistaken for a complete bill, so it says where the rest is
           before it says what the total so far is. */
        <div className="invoice-divider mt-auto flex items-baseline justify-between gap-4 pt-[5px] text-[7.5px] font-bold uppercase tracking-[0.06em]">
          <span>Continued on page {sheet.page + 2} of {sheet.pages} →</span>
          <span className="font-mono">Carried forward · {money(runningTo(sheet.end))}</span>
        </div>
      )}
    </div>
  );

  /**
   * THE RUN: every copy of the bill, each one however many half-sheets it takes.
   *
   * Copies are the OUTER loop and sheets the inner, so the patient's copy comes
   * off the tray as a complete bill before the hospital's starts - pages 1, 2,
   * 3, then 1, 2, 3 again. Interleaved the other way the desk would be sorting
   * two half-collated bills by hand at the counter.
   *
   * Only the first copy is measured. The others are the same items at the same
   * widths, so they break in the same places; measuring all of them would have
   * several sheets racing to repack one shared list of page starts.
   */
  const slices = pageSlices(pageStarts, inv.items.length);
  // Drop refs to sheets that no longer exist, so a bill that shrinks from three
  // sheets to two doesn't keep measuring a detached third.
  sheetsRef.current.length = slices.length;

  const body = (
    <div id={embedded ? undefined : "print-sheet"}>
        {copies.map((copy, c) => slices.map(({ start, end }, p) => {
          // Where this sheet lands in the run - which is what says whether it is
          // the top or the bottom half of a physical A4.
          const nth = c * slices.length + p;
          return (
            <Fragment key={`${c}-${p}`}>
              {/* The fold, drawn. "Half of A4" measured by eye is how one copy
                  loses its last line - and on a lab bill the two halves are two
                  different documents, so the cut has to be findable without
                  holding the sheet up to the light. */}
              {nth > 0 && <div className="cut-line my-[2mm]">cut here</div>}
              {renderCopy(copy, {
                start, end, page: p, pages: slices.length,
                lowerHalf: nth % 2 === 1,
                ref: c === 0 ? (el) => { sheetsRef.current[p] = el; } : undefined,
              })}
            </Fragment>
          );
        }))}
    </div>
  );

  if (embedded) return body;
  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: INVOICE_SHEET_CSS }} />
      {/* The sheet count is on the toolbar because it is the one thing about
          this bill the desk needs to know BEFORE printing: a four-sheet bill is
          two sheets of A4 to cut, not one, and finding that out from the tray is
          how the second half gets left behind. */}
      <PrintToolbar
        title={`Bill · ${inv.receiptNo} · ${inv.patient.fullName}${copies.length > 1 ? " · 2 copies" : ""}${slices.length > 1 ? ` · ${slices.length} sheets` : ""}`}
      />
      {body}
    </div>
  );
}

function Trow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <tr>
      <td className={`py-0.5 text-[9.5px] ${accent ? "font-semibold text-[var(--pr-ink)]" : "text-[#3a3a3a]"}`}>{k}</td>
      <td className={`py-0.5 text-right font-mono ${accent ? "font-semibold text-[var(--pr-ink)]" : ""}`}>{v}</td>
    </tr>
  );
}

/**
 * The grand total - the one figure the patient pays.
 *
 * It used to be reversed out of a filled black band, on the reasoning that the
 * one reversed element on an otherwise uniform page is findable in a second.
 * True on screen. On paper it was the opposite: the band is a background, the
 * desk's driver prints backgrounds off, and white text on no band is white text
 * on white paper - the single most important number on the bill was the one that
 * came out blank.
 *
 * Rules instead: a line above, a double line below, the figure in ink and a
 * size larger than anything near it. That is how a ledger has marked a total for
 * two centuries, it needs no driver setting to survive, and it photocopies -
 * which is what a patient's insurer usually receives.
 */
function TotalRow({ k, v }: { k: string; v: string }) {
  return (
    <tr className="total-band">
      <td className="py-[5px] pl-1.5 text-[9px] font-extrabold uppercase tracking-wide">{k}</td>
      <td className="py-[5px] pr-1.5 text-right font-mono text-[12px] font-extrabold">{v}</td>
    </tr>
  );
}