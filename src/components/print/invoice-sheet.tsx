"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { billPageStarts } from "@/lib/bill-pagination";
// Turning page starts into slices is the same job here as on a lab report - "no
// item is on two sheets, and none is on no sheet" - and it is already tested
// there, so the bill borrows it rather than keeping a second copy of an
// invariant that has to hold in both places.
import { pageSlices } from "@/lib/lab-pagination";
// BillHead is deliberately NOT used here. It is a full-width centred masthead,
// and this sheet sets the hospital beside the patient instead - a layout the IPD
// advance slip now shares, via BillLetterhead below. BillHead stays in
// stationery for the day-close, running-tab and detailed-bill sheets.
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
 * A SHORT LAB BILL THEREFORE NEEDS NO PAGE BREAK. Both its copies live on one
 * sheet - patient above the cut, hospital below it - which is one sheet of paper
 * per lab bill instead of two. A lab bill of eight items or more leaves this
 * stationery for the full sheet; see FULL_SHEET_FROM below for what that costs.
 *
 * Nothing is edge-to-edge: the @page margin reserves the border no printer can
 * reach, so there is nothing for a driver to clip or to shrink to fit.
 */
const HALF_A4_MM = 138.5;

/**
 * ── AND A LONG PHARMACY BILL TAKES THE WHOLE SHEET ──
 *
 * Half an A4 is the right paper for what the counter mostly hands over: a
 * consultation, a lab bill, four items of medicine. It is the wrong paper for a
 * discharge, where the pharmacy window prints twenty or thirty lines - each one
 * a medicine, a batch, a rate and a GST rate - and the bill arrives as a stack
 * of half-sheets that have to be kept together, cut apart, and read across.
 *
 * So past a threshold the bill stops being a half-sheet document and becomes a
 * full one. EIGHT ITEMS is where that turns over: seven is comfortably inside
 * what a half-sheet holds, and by eight the bill is already spilling onto a
 * second half - at which point it is using a whole A4 anyway, and using it as
 * two loose halves instead of one page.
 *
 * PHARMACY AND LAB. Consultations are three lines. Inpatient stays have their
 * own A4 document already (detailed-bill-sheet). Those two are the counters
 * whose bills actually run long.
 *
 * ── THE LAB BILL'S PAPER, WHICH IS NOT THE PHARMACY'S ──
 *
 * A lab bill prints TWICE - patient above the cut, hospital below it - so on a
 * half-sheet BOTH copies live on one A4. That pairing is the whole reason this
 * stationery exists, and it is why the lab was left out of this rule at first.
 *
 * It still holds for a SHORT lab bill, and those are almost all of them: of 561
 * lab bills on this hospital's own data, 538 carry seven items or fewer and are
 * untouched by the threshold. The 23 that carry eight or more are the ones this
 * is for, and there the arithmetic changes sides:
 *
 *   half-sheet, fits one half   2 copies x 1 half = 1 A4
 *   half-sheet, spills to two   2 copies x 2 halves = 2 A4
 *   full sheet                  2 copies x 1 page  = 2 A4
 *
 * So a long lab bill that was already spilling costs the same paper either way,
 * and buys a page per copy instead of two loose halves that have to be cut
 * apart and read across. One that was NOT yet spilling costs a second A4.
 *
 * WHICH OF THOSE APPLIES AT EXACTLY EIGHT IS NOT SETTLED HERE. Row height is
 * measured in the browser and lab names are short single lines where a
 * medicine's wrap to two, so a lab half-sheet holds more rows than a pharmacy
 * one. Eight is the number the hospital asked for; if these bills turn out to
 * have been fitting on one half, this constant is where to raise it.
 *
 * 278mm, not the 279mm the page's content box measures: browsers round page
 * geometry in device pixels, and a box exactly as tall as the printable area
 * rounds UP often enough to push a blank sheet out between every page.
 */
const FULL_A4_MM = 278;

/** Counters whose bills run long enough to outgrow a half-sheet. */
const FULL_SHEET_SOURCES = new Set(["PHARMACY", "LAB"]);

/** Item count from which a bill takes a whole sheet rather than half of one. */
export const FULL_SHEET_FROM = 8;

/** Does this bill want a whole sheet rather than half of one? */
export const wantsFullSheet = (inv: { source: string; items: unknown[] }) =>
  FULL_SHEET_SOURCES.has(inv.source) && inv.items.length >= FULL_SHEET_FROM;

/**
 * The name the pharmacy counter bills under - see the note at `hospitalName`.
 *
 * A literal rather than a HospitalConfig column on purpose, for now: it is a
 * display name on one counter's bill, not a second GST supplier, and adding a
 * column means a migration against the live database the hospital is billing on
 * this afternoon. The moment the pharmacy has its own GSTIN it has to become
 * that column, and this constant is where that change starts.
 */
const PHARMACY_TRADING_NAME = "Jeeva Pharmacy";

/**
 * The shipped mark, for a hospital that has never uploaded one under Settings.
 *
 * The same artwork that is printed into the letterhead image every OPD case
 * sheet carries, so a bill with no configured logo is not a bill with a
 * placeholder on it - it is the right logo, served out of the repo instead of
 * out of the database.
 */
const HOSPITAL_MARK = "/images/JEEVA%20LOGO%20ICON.png";

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
  /**
   * FIXED, SO A COLUMN IS THE SAME WIDTH ON EVERY SHEET OF THE BILL.
   *
   * Under the default auto layout a table's columns are sized from the rows it
   * actually holds, so each sheet of a paginated bill got its own column widths
   * - the description column wide on the sheet whose medicines happen to have
   * short names, narrow on the next. Two things came out of that, and the
   * second is the serious one:
   *
   *   * The columns visibly stepped left and right from sheet to sheet, on a
   *     document that is meant to read as one table continued.
   *   * The PACKING measured the wrong heights. It measures rows on a probe
   *     that holds the whole bill, and those rows were then re-laid out on a
   *     sheet holding ten of them - at different widths, so wrapping
   *     differently, so taller. A sheet packed to the paper's exact height
   *     came out ten pixels over it.
   *
   * Fixed layout takes the widths from the header cells alone, which are the
   * same on every sheet. Description carries no width and takes what is left.
   */
  .invoice-table { table-layout: fixed; }
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
  /* A long pharmacy bill's sheet - see FULL_A4_MM. Only the height changes: the
     sheet is 190mm wide either way, so nothing about the columns, the type
     sizes or the wrapping is different on a full page, and the packing measures
     whichever height is in force straight off min-height. */
  .bill-copy.full-sheet { min-height: ${FULL_A4_MM}mm; }
  .print-stage .bill-copy { box-shadow: 0 8px 40px rgba(0,0,0,.12); }
  .print-stage .bill-copy + .bill-copy { margin-top: 8mm; }
  /* -label and -title are the same thing under two names, both live in the
     markup; aliasing beats leaving half the patient block unstyled. */
  /* SET AS WRITTEN, NOT SHOUTED. These two headings label the blocks; they are
     not read, they are glanced past on the way to the block underneath. Tracked
     uppercase at 10px made them the loudest type on a sheet whose actual
     content - the patient's name, the medicine, the amount - is what has to
     carry. Sentence case at 8.5px puts them back where a label belongs, and the
     1.5px it gives up goes to the item table, which is where a pharmacy bill
     runs out of paper. The tracking comes down with the caps: .12em is what
     holds uppercase apart, and on mixed case it just loosens the word. */
  .invoice-section-title, .invoice-section-label { font-size: 8.5px; font-weight: 800; letter-spacing: .02em; text-transform: none; color: var(--pr-ink); }
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
  /* 10.5px, tracked and in caps, against a body of 11px names and 10px figures.
     The heading is not bigger than what it heads and does not need to be - caps
     and letter-spacing are what separate a label from a line of data, and they
     do it at any size. */
  .invoice-table th {
    font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
    color: var(--pr-ink); background: #fff;
    border-top: .8px solid var(--pr-ink); border-bottom: .8px solid var(--pr-ink);
  }
  /**
   * ── 1.28, BECAUSE A BILL ROW IS NOT A PARAGRAPH ──
   *
   * The rows inherited the sheet's 1.45 line-height, which is a setting for
   * PROSE - it opens paragraphs up so the eye can find the next line across a
   * long measure. A bill row is not prose. It is one short name and five
   * figures, read across once, and the leading above and below each of them was
   * buying nothing but paper: 2.4px a row, and a half-sheet's worth over eight
   * of them.
   *
   * It is what keeps the half-sheet honest right at its limit. Seven items is
   * the most one carries - by eight the bill turns over to a full sheet, see
   * wantsFullSheet - and at 1.45 a bill sized to the half-sheet was not fitting
   * on it: it packed a row short and sent its last line to a second half-sheet,
   * so the counter cut and stapled two halves to hand over a bill the design
   * says is a one-sheet bill. Tightening the leading is what closes that gap,
   * and it closes it without taking a point off anything anybody reads.
   *
   * A name too long for its column still wraps, and still wraps to a row this
   * measures - the packing reads real heights, so a bill of long names simply
   * paginates earlier, which is correct.
   */
  .invoice-table td { border-bottom: .4px solid var(--pr-hair); line-height: 1.28; }
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
    /* One per page, and no cut line: a full sheet has no fold. Two of these
       cannot share an A4 - 278mm against a 279mm printable box - so
       break-inside:avoid puts each on a page of its own without a break rule. */
    .bill-copy.full-sheet { height: ${FULL_A4_MM}mm; border-top: 0; }
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
  /** One row per deposit slip, so a family holding two receipts can find both
   *  on the bill. Absent on older payloads - the merged line is the fallback. */
  advanceLines?: { receiptNo: string | null; mode: string; amount: string; at: string }[];
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
  /** A whole A4 rather than half of one - see FULL_A4_MM. */
  fullSheet: boolean;
  /** Second half of a physical A4 - the one edge that is a real fold. */
  lowerHalf: boolean;
  /**
   * The probe render: the whole bill on one unbroken sheet, carrying BOTH feet
   * so each can be measured. Laid out and read before the browser paints, so it
   * never reaches a screen or a tray.
   */
  probe?: boolean;
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
export function InvoiceIdRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <span className="invoice-id-label">{k}</span>
      <span className="invoice-id-label">:</span>
      <span className={`invoice-id-value ${mono ? "font-mono tracking-tight" : ""}`}>{v || "-"}</span>
    </>
  );
}

/**
 * One "LABEL value" pair on the strip under the letterhead.
 *
 * Laid out inline rather than as a label/value grid on purpose: these read
 * ACROSS - Bill No, then Date - where the patient block below reads DOWN, and a
 * grid is what turned four of these into four stacked rows and a third of the
 * masthead. `whitespace-nowrap` on both halves is what keeps that a promise: a
 * receipt number that wraps is a receipt number back on two lines.
 */
export function MetaInline({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
      <span className="invoice-meta-label">{k}</span>
      <span className={`invoice-meta-value ${mono ? "font-mono" : ""}`}>{v}</span>
    </span>
  );
}

/**
 * THE BAND EVERY DOCUMENT FROM THIS HOSPITAL OPENS WITH.
 *
 * Shared by the bill and the IPD advance slip, because a family handed both
 * should be in no doubt they came off the same counter - and because a
 * letterhead maintained in two files is a letterhead that disagrees with itself
 * the first time an address changes.
 *
 * `title` and `chip` are the only things that differ. A bill says "Tax Invoice"
 * or "Bill of Supply"; a deposit slip says neither, and must not - it is not a
 * supply. What it says instead is its caller's business, not this component's.
 */
export function BillLetterhead({
  name, address, gstin, phone, logoDataUrl, title, chip,
}: {
  name: string; address: string; gstin: string | null; phone: string;
  logoDataUrl: string | null; title: string; chip: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b-[1.2px] pb-[4px]" style={{ borderColor: "var(--pr-ink)" }}>
      <div className="flex min-w-0 flex-1 items-center gap-[10px]">
        {/* Not next/image: a data URI has nothing for the optimiser to fetch,
            and a sheet on its way to a tray wants the bytes in the document
            rather than a second request to wait on. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoDataUrl || HOSPITAL_MARK} alt={name}
          className="h-[44px] w-[44px] shrink-0 object-contain" />
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold uppercase leading-none tracking-tight" style={{ color: "var(--pr-ink)" }}>
            {name}
          </div>
          <div className="mt-[3px] text-[7px] font-medium leading-snug text-[#3f3f3f]">{address}</div>
          <div className="mt-[1px] flex flex-wrap gap-x-3 text-[7px] font-semibold text-[#3f3f3f]">
            {gstin && <span>GSTIN: <span className="font-mono">{gstin}</span></span>}
            <span>Phone: <span className="font-mono">{phone}</span></span>
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[12px] font-extrabold uppercase tracking-[0.09em]" style={{ color: "var(--pr-ink)" }}>
          {title}
        </div>
        <div className="mt-[3px] inline-block border px-2 py-[1px] text-[6px] font-bold uppercase tracking-[0.08em] invoice-status">
          {chip}
        </div>
      </div>
    </div>
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

  // ── ?print=1: OPEN THE PRINT DIALOG ONCE THE BILL IS ON THE PAGE ──
  //
  // A counter that has just raised a bill wants paper, not a preview. Its
  // "Print bill" button opens this sheet with ?print=1, so one click still ends
  // in the print dialog - but with THIS sheet in it, not the screen the button
  // was on. Waits for the fonts and the logo, or the first print of the
  // morning comes out in a fallback face with a blank where the logo goes.
  // Read from location, not useSearchParams: that would need a Suspense
  // boundary around every print route for one flag.
  const printed = useRef(false);
  useEffect(() => {
    if (!inv || printed.current) return;
    if (new URLSearchParams(window.location.search).get("print") !== "1") return;
    // `printed` is set only when the dialog actually opens: a cancelled run
    // (React re-running the effect) must leave the next run free to print.
    let cancelled = false;
    // An e-invoiced bill draws its signed QR a moment AFTER the sheet, from a
    // dynamically loaded library - and a tax invoice printed without it is not
    // the tax invoice. So when the bill carries one, wait for that image to be
    // on the page (up to 5 s) before waiting for images to finish loading.
    const qrOnPage = () => !inv.eInvoice?.signedQrCode || !!document.querySelector('img[alt="Signed e-invoice QR code"]');
    const waitForQr = new Promise<void>((done) => {
      const started = Date.now();
      const tick = () => (qrOnPage() || Date.now() - started > 5000 ? done() : setTimeout(tick, 100));
      tick();
    });
    waitForQr.then(() => {
      const images = [...document.images].filter((img) => !img.complete)
        .map((img) => new Promise<void>((done) => { img.addEventListener("load", () => done()); img.addEventListener("error", () => done()); }));
      return Promise.all([document.fonts.ready, ...images]);
    }).then(() => setTimeout(() => {
      if (cancelled || printed.current) return;
      printed.current = true;
      window.print();
    }, 150));
    return () => { cancelled = true; };
  }, [inv]);

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

  // Half a sheet, or the whole one - see FULL_A4_MM. Decided from the bill
  // itself rather than chosen at the counter, so the same bill prints the same
  // way from the pharmacy, from reception and from the patient's own portal.
  const fullSheet = wantsFullSheet(inv);

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
   * everything on one sheet and `[0, 12]` is items 0-11 then 12 onwards. Null
   * means the bill has not been measured yet - see the probe render below.
   *
   * MEASURED, NOT ESTIMATED. A row's height depends on how the medicine's name
   * wraps in its column, and "Amoxycillin + Clavulanic Acid 625mg Tablet" takes
   * two lines where "CBP" takes one - so a fixed lines-per-sheet count is wrong
   * for exactly the bills that need this. It is measured ONCE, in a probe render
   * that lays the whole bill out on a single unbroken sheet and reads the real
   * height of every row and of both kinds of foot; the arithmetic that turns
   * those into breaks lives in @/lib/bill-pagination, tested without a DOM.
   *
   * THE PROBE IS NEVER SEEN. useLayoutEffect runs before the browser paints, and
   * the state it sets re-renders synchronously - so the first thing on screen is
   * the packed bill, not a long one snapping into sheets.
   */
  const sheetsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [pageStarts, setPageStarts] = useState<number[] | null>(null);
  const measuring = pageStarts === null;

  // A different bill is a different packing. Reset DURING render, not from an
  // effect - an effect would run after the packing below had already measured,
  // and the two updates would cancel.
  const layoutKey = `${inv.id}|${inv.items.length}`;
  const [packed, setPacked] = useState(layoutKey);
  if (packed !== layoutKey) { setPacked(layoutKey); setPageStarts(null); }

  useLayoutEffect(() => {
    if (!measuring) return;
    const sheet = sheetsRef.current[0];
    if (!sheet) return;

    const cs = getComputedStyle(sheet);
    // On screen the half-sheet's height is a min-height; in print the same
    // measurement is a hard height. That is the paper being packed against.
    const paper = parseFloat(cs.minHeight);
    const gap = parseFloat(cs.rowGap) || 0;
    const rowEls = Array.from(sheet.querySelectorAll<HTMLElement>("[data-bill-row]"));
    if (!Number.isFinite(paper) || paper <= 0 || rowEls.length === 0) { setPageStarts([0]); return; }

    /**
     * The chrome above the first item row, read as a DISTANCE rather than by
     * subtracting the parts from the sheet's height. Subtraction would have been
     * measuring the wrong thing on a short bill: the sheet is floored at the
     * paper height and its `mt-auto` opens a gap to push the totals onto the
     * bottom edge, so the leftover after subtracting rows and feet is that gap
     * plus the chrome - and a three-line bill would have been told its header
     * takes half a sheet, and split in two.
     */
    const top = sheet.getBoundingClientRect().top;
    const overhead = (rowEls[0].getBoundingClientRect().top - top) + (parseFloat(cs.paddingBottom) || 0);
    const footOf = (kind: string) =>
      Array.from(sheet.querySelectorAll<HTMLElement>(`[data-foot="${kind}"]`))
        .reduce((s, el) => s + el.getBoundingClientRect().height + gap, 0);

    /**
     * getBoundingClientRect, NOT offsetHeight, and the difference is a whole
     * line on a long bill. offsetHeight is rounded to an integer, and an item
     * row at this type size measures a fraction over 20px - so every row read
     * through offsetHeight under-reports by up to a pixel, in the same
     * direction, and thirty of them under-report by thirty. The sheet then gets
     * packed with a line more than it holds. Fractional heights simply do not
     * accumulate an error.
     */
    setPageStarts(billPageStarts(rowEls.map((el) => el.getBoundingClientRect().height), {
      paper,
      // Two pixels held back for the sub-pixel geometry of a border-collapse
      // table, where the rows' own heights and the block they add up to can
      // still disagree slightly. The direction that error must not go is "one
      // line more than the paper holds".
      overhead: overhead + 2,
      endFoot: footOf("end"),
      contFoot: footOf("cont"),
    }));
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
  const total = Number(inv.totalAmount);            // taxable + CGST + SGST, to the rupee
  // Bills are whole rupees (lib/money-round). What that added or took off
  // prints as its own line so taxable + tax + round off = the total. Bills
  // raised before the rule carry none and print as they always did.
  const roundOff = Math.round((total - Number(inv.taxableAmount) - Number(inv.cgstAmount) - Number(inv.sgstAmount)) * 100) / 100;
  const isIpd = inv.source === "IPD";
  const advance = isIpd ? Number(inv.advanceAdjusted) : 0;
  const advanceRows = isIpd ? (inv.advanceLines ?? []) : [];
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

  /**
   * ── WHOSE NAME IS ON THE BILL ──
   *
   * The pharmacy counter's bill goes out under the pharmacy's own name. It is
   * the name over the window the patient bought the medicine at, the name they
   * will come back and ask for, and the name on every paper bill that counter
   * issued before this system existed - a hospital masthead on a strip of
   * paracetamol reads like a different document than the one they were handed.
   *
   * ONLY THE NAME CHANGES. The address, the phone and above all the GSTIN are
   * still the hospital's, because those are what the bill is a tax document
   * ON BEHALF OF. If the pharmacy is ever registered as its own entity - its own
   * GSTIN, its own drug licence - then this stops being a display name and
   * becomes a second supplier, which is a HospitalConfig field and a validator,
   * not a line here. Written as a constant, in one place, so that day is a small
   * change rather than a search.
   */
  const hospitalName = (inv.source === "PHARMACY" ? PHARMACY_TRADING_NAME : inv.hospital?.legalName)
    ?? inv.hospital?.legalName ?? "Jeeva Multispeciality Hospital";
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
      className={`bill-copy flex flex-col gap-[5px]${sheet.fullSheet ? " full-sheet" : ""}${sheet.lowerHalf ? " lower-half" : ""}`}
    >
      {/* ── THE LETTERHEAD: MARK LEFT, NAME CENTRE, DOCUMENT TITLE RIGHT ──

          The same three-part band the hospital's own printed letterhead uses -
          the one at the head of every OPD case sheet - at the size the shared
          stationery sets that mark: 44px. The bill used to carry a 28px logo
          wedged against the name inside the left column, which reads as an icon
          beside a heading rather than as a letterhead, and is the first thing
          somebody handed the sheet judges it by.

          THE MARK IS ALWAYS DRAWN. It used to be gated on an admin having
          uploaded one under Settings, so a hospital that never did got a bill
          with a hole where its identity goes. The shipped mark is the same
          artwork as the printed letterhead's, so the fallback is not a
          placeholder - it is the right logo, out of the repo instead of the
          database.

          THE MASTHEAD IS ALSO WHERE THE PAPER WAS GOING. This band measured
          130px of a 523px half-sheet, because the bill number and the date each
          wrapped onto two lines inside a 118px column and Dept and Page stacked
          underneath them. Everything that is not the letterhead moves to the
          meta strip below, on one line - see there. */}
      <BillLetterhead
        name={hospitalName}
        address={hospitalAddr}
        gstin={inv.hospital?.gstin ?? null}
        phone={hospitalPhone}
        logoDataUrl={inv.hospital?.logoDataUrl ?? null}
        title={gstApplies ? "Tax Invoice" : "Bill of Supply"}
        chip={`${copy.formal} · ${copy.plain}`}
      />

      {/* ── WHICH BILL, AND WHEN - ON ONE LINE, UNDER THE LETTERHEAD ──

          A letterhead says who issued the paper; it should not also be carrying
          a four-row table of reference numbers. These sit on a strip of their
          own beneath it, right-aligned, one line - which is both where a reader
          looks for them and about a fifth of the height the stacked grid took.

          NO DEPT ON A PHARMACY BILL. "Dept: Pharmacy" under a masthead that
          already reads JEEVA PHARMACY says the same word twice. Every other
          counter's bill goes out under the hospital's name, where the
          department is the thing that line adds. */}
      <div className="flex flex-wrap items-baseline justify-end gap-x-4 py-1">
        <MetaInline k="Bill No" v={inv.receiptNo} mono />
        {inv.source !== "PHARMACY" && <MetaInline k="Dept" v={SOURCE_LABEL[inv.source] ?? inv.source} />}
        <MetaInline k="Date" v={`${created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}, ${created.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`} />
        {/* Only on a bill that actually runs to more than one sheet. "Page
            1 of 1" on the ninety-odd percent that don't is a line that answers
            a question nobody was asking, beside the bill number.

            ON THE PROBE IT IS ALWAYS DRAWN, and leaving it out was a real bug
            rather than a tidiness point. The probe is a single sheet, so
            `pages > 1` was false and its masthead came out one line SHORTER
            than every sheet it was measuring for. The packing then handed each
            real sheet that line's worth of rows too many, and a bill packed to
            the paper's exact height printed ten pixels past it. */}
        {(sheet.pages > 1 || sheet.probe) && (
          <MetaInline k="Page" v={`${sheet.page + 1} of ${sheet.pages}`} mono />
        )}
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
        {/* 9.5px is only the table's floor now - the name sets at 11px and every
            figure beside it at 10px, both declared on the cells. It is left
            here as the inherited size for anything added to a row later, and as
            the reminder that started this: the item lines are what the bill
            exists to carry, and they were once the smallest type on it, smaller
            than the address in the masthead. A bill that costs a sheet more to
            print is cheaper than one the patient brings back to the counter to
            have read out. */}
        <table className="invoice-table w-full text-[9.5px]">
          <thead>
            <tr className="text-left">
              {/* ── THE COLUMN WIDTHS ARE THE HEADINGS' WIDTHS ──
                  Under the old auto table layout a heading too wide for its
                  column simply pushed the column wider, so these numbers only
                  ever had to suit the VALUES. Fixed layout took that away:
                  HSN/SAC wanted 52px in a 37px slot and Qty 24px in 19px, and
                  a heading with nowhere to go does not wrap - it OVERFLOWS.
                  HSN/SAC ran eleven pixels into the Qty column and Qty into
                  Rate, so the labels sat closer to the wrong column than to
                  their own and the gaps along the band came out uneven. Nothing
                  about the row's height gave it away, which is why it looked
                  like spacing rather than a width that was simply too small.
                  Each width now clears its heading AND its widest value
                  (a five-figure rupee amount, an eight-digit HSN code) with a
                  few pixels to spare. Description carries no width and takes
                  whatever is left, so widening one of these narrows it. */}
              {/* "S.No", not "#". The hash is a programmer's abbreviation; the
                  column it heads is read at a counter, quoted down a phone and
                  written on a returns slip, and "S.No" is what every paper bill
                  this one replaced called it. The width goes from 18px to 34px
                  because a fixed-layout heading with nowhere to go does not
                  wrap - it overflows into the column beside it. */}
              <th className="w-[34px] px-1 py-[5px] text-center">S.No</th>
              <th className="px-1.5 py-[5px]">Description</th>
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
              {showBatch && <th className="w-[58px] px-1 py-[5px]">Batch</th>}
              <th className="w-[64px] font-semibold px-1 py-[5px]">HSN/SAC</th>
              <th className="w-[34px] font-semibold px-1 py-[5px] text-right">Qty</th>
              <th className="w-[60px] font-semibold px-1 py-[5px] text-right">Rate</th>
              <th className="w-[34px] font-semibold px-1 py-[5px] text-right">GST</th>
              <th className="w-[72px] font-semibold px-1.5 py-[5px] text-right">Amount</th>
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
                {/* ── EVERY CELL IN INK ──
                    The serial, batch, HSN and GST cells used to be #3f3f3f. A
                    mid grey is a screen colour: through a toner cartridge that
                    is two-thirds empty it renders lighter than the rule under
                    the row - so the batch number, the one thing on a pharmacy
                    bill somebody comes back to check, printed faintest of all.
                    They are ink now. Nothing on this row is set to whisper. */}
                <td className="px-1 py-[3px] text-center font-mono text-[10px] font-medium">{sheet.start + i + 1}</td>
                {/* ── THE MEDICINE'S NAME, A STEP ABOVE EVERYTHING BESIDE IT ──
                    11px semibold against the 10px the figures are set in. Every
                    other column on this row is a number that gets CHECKED - a
                    rate, a quantity, a GST slab - and those are set alike
                    because they are read alike, straight down the column. The
                    name is the one thing on the row read ACROSS, and the only
                    thing on the bill anybody looks for by eye rather than by
                    column, so it is the one thing here allowed to be bigger. */}
                <td className="px-1.5 py-[3px] text-[11px] font-semibold">{billItemName(it.description)}</td>
                {/* ── ONE SIZE FOR EVERY FIGURE ON THE ROW: 10px ──
                    The name is 11px and these are one step under it, which is
                    the whole hierarchy this row needs - a name to find the line
                    by, and figures to check it against. They used to be three
                    sizes: batch at 7.5, HSN and GST at 8.5, qty/rate/amount at
                    the table's 9.5. Nothing decided those; they accumulated. So
                    the batch number - the one thing on a pharmacy bill a
                    patient comes back to the counter holding - printed smallest
                    of all, at a size a 60-year-old reads by taking the sheet to
                    a window. */}
                {showBatch && <td className="px-1 py-[3px] font-mono text-[10px] font-medium">{billItemBatch(it.description) ?? "—"}</td>}
                <td className="px-1 py-[3px] font-mono text-[10px] font-medium">{it.hsnSac ?? "—"}</td>
                <td className="px-1 py-[3px] text-right font-mono text-[10px] font-medium">{it.qty}</td>
                <td className="px-1 py-[3px] text-right font-mono text-[10px] font-medium">{money(it.unitPrice)}</td>
                <td className="px-1 py-[3px] text-right font-mono text-[10px] font-medium">{Number(it.gstRatePct) ? `${it.gstRatePct}%` : "—"}</td>
                <td className="px-1.5 py-[3px] text-right font-mono text-[10px] font-medium">{money(it.amount)}</td>
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
      {sheet.page === sheet.pages - 1 && (
        <>
          {/* Settlement + totals */}
          <div data-foot="end" className="invoice-divider mt-auto pt-[5px]">
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
                    {Math.abs(roundOff) >= 0.01 && (
                      <Trow k="Round off" v={roundOff < 0 ? `− ${money(-roundOff)}` : money(roundOff)} />
                    )}
                    {isIpd && advance > 0 ? (
                      <>
                        <Trow k="Total incl. GST" v={money(total)} />
                        {/* A stay can take several deposits, and the family holds
                            a numbered slip for each. One merged "Less: Advance"
                            ties back to none of them, so each slip gets its own
                            line; the merged line remains for a single deposit,
                            and for older bills whose payload predates this. */}
                        {advanceRows.length > 1 ? (
                          advanceRows.map((a, i) => (
                            <Trow
                              key={i}
                              k={`Less: Advance ${a.receiptNo ?? ""}`.trim()}
                              v={`− ${money(a.amount)}`}
                              accent
                            />
                          ))
                        ) : (
                          <Trow k="Less: Advance" v={`− ${money(advance)}`} accent />
                        )}
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

          <div data-foot="end" className="flex items-end justify-between gap-4 border-t border-[#cfcfcf] pt-[3px]">
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
      )}

      {/* Not the end of the bill. The one thing this foot must do is stop the
          sheet being mistaken for a complete one, so it says where the rest is
          before it says what the lines above came to.

          On the probe it is rendered ALONGSIDE the totals rather than instead of
          them, because the packing needs the height of both feet and only gets
          one measurement pass to read them in. */}
      {(sheet.page < sheet.pages - 1 || sheet.probe) && (
        <div data-foot="cont" aria-hidden={sheet.probe}
          className="invoice-divider mt-auto flex items-baseline justify-between gap-4 pt-[5px] text-[7.5px] font-bold uppercase tracking-[0.06em]">
          <span>Continued on page {sheet.page + 2} →</span>
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
  // Until the packing has measured, the bill is one unbroken sheet - that IS the
  // probe, and it is what every row's height gets read off.
  const slices = pageStarts
    ? pageSlices(pageStarts, inv.items.length)
    : [{ start: 0, end: inv.items.length }];
  // Drop refs to sheets that no longer exist, so a bill that packs from one
  // probe sheet into four doesn't keep a detached probe around.
  sheetsRef.current.length = slices.length;

  const body = (
    <div id={embedded ? undefined : "print-sheet"}>
        {copies.map((copy, c) => slices.map(({ start, end }, p) => {
          // Where this sheet lands in the run - which is what says whether it is
          // the top or the bottom half of a physical A4. A full sheet is never
          // either: it has a page to itself and nothing is cut off it.
          const nth = c * slices.length + p;
          return (
            <Fragment key={`${c}-${p}`}>
              {/* The fold, drawn. "Half of A4" measured by eye is how one copy
                  loses its last line - and on a lab bill the two halves are two
                  different documents, so the cut has to be findable without
                  holding the sheet up to the light. */}
              {nth > 0 && !fullSheet && <div className="cut-line my-[2mm]">cut here</div>}
              {renderCopy(copy, {
                start, end, page: p, pages: slices.length,
                fullSheet,
                lowerHalf: !fullSheet && nth % 2 === 1,
                probe: measuring,
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

export function Trow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
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
export function TotalRow({ k, v }: { k: string; v: string }) {
  return (
    <tr className="total-band">
      <td className="py-[5px] pl-1.5 text-[9px] font-extrabold uppercase tracking-wide">{k}</td>
      <td className="py-[5px] pr-1.5 text-right font-mono text-[12px] font-extrabold">{v}</td>
    </tr>
  );
}
