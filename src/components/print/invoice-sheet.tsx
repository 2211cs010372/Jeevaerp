"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { INVOICE_PRINT_CSS, PrintToolbar, BillHead, type HospitalInfo } from "@/components/print/stationery";

interface Invoice {
  id: string; receiptNo: string; source: string; status: string; createdAt: string;
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
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const path = source === "portal" ? `/portal/invoice/${invoiceId}` : `/billing/invoice/${invoiceId}`;
    api.get<{ invoice: Invoice }>(path)
      .then((r) => setInv(r.invoice))
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the bill."));
  }, [invoiceId, source]);

  useEffect(() => {
    if (!inv || !barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, inv.receiptNo, { format: "CODE128", displayValue: false, height: 26, width: 1.1, margin: 0, background: "transparent", lineColor: "#17211e" });
    } catch { /* non-encodable receipt - barcode simply omitted */ }
  }, [inv]);

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

  const created = new Date(inv.createdAt);
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

  const Meta = ({ k, v }: { k: string; v: string }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="shrink-0 whitespace-nowrap text-[8px] font-bold uppercase tracking-wide text-[#57655f]">{k}</span>
      <span className="truncate font-mono text-[10px] font-medium text-[var(--pr-ink)]">{v}</span>
    </div>
  );

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: INVOICE_PRINT_CSS }} />
      <PrintToolbar title={`Bill · ${inv.receiptNo} · ${inv.patient.fullName}`} />

      <div id="print-sheet">
        {/* text masthead - name · GSTIN · address · phone (no letterhead image) */}
        <BillHead hospital={inv.hospital} />

        {/* title + barcode row */}
        <div className="keep-together rule mt-1 flex items-start justify-between gap-4 pb-0.5">
          <div className="flex items-center justify-center gap-3" >
            <p className="text-[9px] font-extrabold uppercase tracking-[0.05em]" style={{ color: "var(--pr-primary)" }}>
              {gstApplies ? "Tax Invoice" : "Bill of Supply"}
              <span className="ml-1 text-[9px] font-semibold text-[#57655f]">(Original)</span>
            </p>
            <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-[#57655f]">
              {SOURCE_LABEL[inv.source] ?? inv.source}
            </p>
          </div>
          <div className="flex flex-col items-end">
            <svg ref={barcodeRef} className="h-[26px] w-[120px]" aria-label={`Barcode ${inv.receiptNo}`} />
          </div>
        </div>

        {/* bill meta */}
        <div className="keep-together mt-2 grid grid-cols-3 gap-x-6 gap-y-0.5">
          <Meta k="Bill No" v={inv.receiptNo} />
          <Meta k="UHID" v={inv.patient.displayId} />
          <Meta k="Bill Date" v={created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />
        </div>

        {/* patient / payor block */}
        <div className="keep-together  mt-2 grid grid-cols-[2fr_2fr] gap-x-6 py-1.5">
          <div className="space-y-0.5">
            <Meta k="Patient" v={inv.patient.fullName} />
            <Meta k="Address" v={inv.patient.address || "-"} />
          </div>
          <div className="space-y-0.5">
            <Meta k="Age/Sex" v={ageSex} />
            <Meta k="Phone" v={inv.patient.phone} />
          </div>
        </div>

        {/* Billed To - only on a B2B bill. A GST-registered recipient has to be
            named on the invoice with their GSTIN for them to claim input credit;
            without this block the bill is useless to them. */}
        {inv.buyer && (
          <div className="keep-together border-t border-[var(--pr-line)] mt-1 grid grid-cols-[2fr_2fr] gap-x-6 py-1.5">
            <div className="space-y-0.5">
              <Meta k="Billed To" v={inv.buyer.legalName} />
              <Meta k="Address" v={inv.buyer.address || "-"} />
            </div>
            <div className="space-y-0.5">
              <Meta k="Buyer GSTIN" v={inv.buyer.gstin} />
              <Meta k="State Code" v={inv.buyer.stateCode || "-"} />
            </div>
          </div>
        )}

        {/* line items - repeats its header and paginates onto a second A5 if long */}
        <table className="mt-2 w-full border-collapse text-[10px]">
          <thead>
            <tr className="text-left text-[8px] uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>
              <th className="w-[22px] border-y-2 py-1 pr-1 font-bold" style={{ borderColor: "var(--pr-primary)" }}>#</th>
              <th className="border-y-2 py-1 pr-2 font-bold" style={{ borderColor: "var(--pr-primary)" }}>Service / Item</th>
              <th className="w-[54px] border-y-2 py-1 pr-1 font-bold" style={{ borderColor: "var(--pr-primary)" }}>HSN/SAC</th>
              <th className="w-[30px] border-y-2 py-1 pr-1 text-right font-bold" style={{ borderColor: "var(--pr-primary)" }}>Qty</th>
              <th className="w-[64px] border-y-2 py-1 pr-1 text-right font-bold" style={{ borderColor: "var(--pr-primary)" }}>Price</th>
              <th className="w-[38px] border-y-2 py-1 pr-1 text-right font-bold" style={{ borderColor: "var(--pr-primary)" }}>GST%</th>
              <th className="w-[74px] border-y-2 py-1 text-right font-bold" style={{ borderColor: "var(--pr-primary)" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={i} className="align-top">
                <td className="rule py-[4px] pr-1 font-mono text-[9px] text-[#57655f]">{i + 1}</td>
                <td className="rule py-[4px] text-[9px] pr-2">{it.description}</td>
                <td className="rule py-[4px] pr-1 font-mono text-[9px]">{it.hsnSac ?? "-"}</td>
                <td className="rule py-[4px] pr-1 text-right font-mono">{it.qty}</td>
                <td className="rule py-[4px] pr-1 text-right font-mono">{money(it.unitPrice)}</td>
                <td className="rule py-[4px] pr-1 text-right font-mono">{Number(it.gstRatePct) ? `${it.gstRatePct}%` : "Exempt"}</td>
                <td className="rule py-[4px] text-right font-mono">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* totals + words - kept whole so the money summary never splits across the fold */}
        <div className="keep-together mt-2.5 flex items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <p className="text-[8px] font-bold uppercase tracking-wide text-[#3c4a45]">Amount payable (in words)</p>
            <p className="mt-0.5 text-[11px] font-black italic" style={{ color: "var(--pr-primary)" }}>{amountInWords(netPayable)}</p>
            {/* HOW THIS BILL SETTLES.
                On a cashless bill this line is the whole point: the family is
                handed a printed bill for a sum they are not being asked for, and
                without it in black and white the desk gets the argument. */}
            {inv.payer === "INSURANCE" ? (
              <p className="mt-1.5 text-[9.5px] text-[#4a5652]">
                <span className="font-semibold">Billed to insurer:</span>{" "}
                {inv.payerName || "Insurer / TPA"}
                {" — "}cashless. Not payable at the counter.
                {inv.payments.length > 0 && <> Received here: {payMode}.</>}
              </p>
            ) : inv.payments.length > 0 ? (
              <p className="mt-1.5 text-[9.5px] text-[#4a5652]"><span className="font-semibold">Paid by:</span> {payMode}</p>
            ) : null}
            <p className="mt-1.5 text-[7.5px] leading-relaxed text-[#6b7772]">
              Healthcare services (consultation &amp; diagnostics) are GST-exempt; lines marked Exempt carry 0%.
              Medicines and taxable services show CGST + SGST split equally (intra-state, Telangana – 36).
              Computer-generated bill; no signature required.
            </p>
          </div>
          <table className="w-[210px] text-[10px]">
            <tbody>
              <Trow k="Sub-total" v={money(inv.subtotal)} />
              {Number(inv.discountAmount) > 0 && <Trow k={`Discount (${discPct}%)`} v={`− ${money(inv.discountAmount)}`} />}
              {/* Only worth a line when a discount makes it differ from the sub-total;
                  otherwise GST is plainly charged on the sub-total above. */}
              {gstApplies && Number(inv.discountAmount) > 0 && <Trow k="Taxable value" v={money(inv.taxableAmount)} />}
              {gstApplies && <Trow k="CGST" v={money(inv.cgstAmount)} />}
              {gstApplies && <Trow k="SGST" v={money(inv.sgstAmount)} />}
              {isIpd && advance > 0 ? (
                <>
                  {/* IP bill: total including GST, then the deposit credited off it */}
                  <Trow k="Total (incl. GST)" v={money(total)} />
                  <Trow k="Less: Advance paid at admission" v={`− ${money(advance)}`} accent />
                  <TotalRow k="Net Payable" v={money(netPayable)} />
                </>
              ) : (
                /* Every other desk: subtotal + GST is the whole story */
                <TotalRow k="Net Payable" v={money(total)} />
              )}
            </tbody>
          </table>
        </div>
        {/* e-Invoice registration.
            Printed only when the government actually issued an IRN. The QR is
            what a tax officer scans, so it sits next to the IRN it belongs to
            rather than being tucked in a corner. */}
        {inv.eInvoice && (
          <div className="keep-together border-t border-[var(--pr-line)] mt-2.5 flex items-start justify-between gap-4 pt-1.5">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-[8px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>
                e-Invoice
              </p>
              <p className="break-all font-mono text-[7.5px] leading-snug text-[var(--pr-ink)]">
                <span className="font-bold">IRN </span>{inv.eInvoice.irn}
              </p>
              <p className="font-mono text-[8px] text-[#4a5652]">
                <span className="font-bold">Ack </span>{inv.eInvoice.ackNo ?? "-"}
                {inv.eInvoice.ackDt && (
                  <> · {new Date(inv.eInvoice.ackDt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</>
                )}
              </p>
            </div>
            {qrDataUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- a data: URI
                 for print; next/image would defer it past window.print(). */
              <img src={qrDataUrl} alt="Signed e-invoice QR code" className="h-[76px] w-[76px] shrink-0" />
            )}
          </div>
        )}

        {/* Whatever the hospital wants on every bill - terms, refund policy, a
            helpline. Set under Admin → Settings; absent by default so nothing
            appears unless somebody chose to put it there. */}
        {inv.hospital?.invoiceFooterNote && (
          <p className="mt-3 whitespace-pre-line border-t border-[var(--pr-line)] pt-1.5 text-[8px] leading-relaxed text-[#4a5652]">
            {inv.hospital.invoiceFooterNote}
          </p>
        )}

        {/* footer - printed timestamp only, no website / URL */}
        <p className={`${inv.hospital?.invoiceFooterNote ? "mt-1.5" : "mt-4 border-t border-[var(--pr-line)] pt-1.5"} text-center text-[7.5px] text-[#6b7772]`}>
          {(inv.hospital?.legalName ?? "Jeeva Multispeciality Hospital")} · Printed{" "}
          {new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

function Trow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <tr>
      <td className={`py-0.5 text-[9.5px] ${accent ? "font-semibold text-[#0b6f5f]" : "text-[#4a5652]"}`}>{k}</td>
      <td className={`py-0.5 text-right font-mono ${accent ? "font-semibold text-[#0b6f5f]" : ""}`}>{v}</td>
    </tr>
  );
}

/** The bold, ruled grand-total row - the one figure the patient pays. */
function TotalRow({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td className="border-y-2 py-1 text-[9.5px] font-extrabold uppercase tracking-wide" style={{ borderColor: "var(--pr-primary)", color: "var(--pr-primary)" }}>{k}</td>
      <td className="border-y-2 py-1 text-right font-mono text-[12px] font-bold" style={{ borderColor: "var(--pr-primary)" }}>{v}</td>
    </tr>
  );
}
