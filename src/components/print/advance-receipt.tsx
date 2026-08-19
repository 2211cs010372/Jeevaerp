"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { bedLabel } from "@/lib/beds";
import { INVOICE_PRINT_CSS, PrintToolbar, BillHead, type HospitalInfo } from "@/components/print/stationery";

/**
 * The IPD advance slip - what the family walks away holding.
 *
 * It is NOT a bill, and the layout works hard to say so. No GST split, no HSN,
 * no line items, and the words "ADVANCE / DEPOSIT RECEIPT" where the invoice
 * says "Tax Invoice". A deposit is money the hospital HOLDS; it is not a supply
 * and carries no tax. The tax document is the discharge bill, where this exact
 * amount comes back as a credit - stated on the slip in plain language, because
 * a family handed a piece of paper with a big number on it will otherwise read
 * it as their final bill and be shocked at discharge.
 *
 * Same A5 stationery and text masthead as InvoiceSheet, so the two documents
 * are recognisably from the same counter.
 */

interface Data {
  hospital: HospitalInfo | null;
  advance: { id: string; receiptNo: string | null; amount: string; mode: string; reference: string | null; takenAt: string; receivedBy: string };
  admission: { ipNumber: string; ward: string; bedNo: string; admittedAt: string; doctorName: string };
  patient: { displayId: string; fullName: string; phone: string; age: number | null; gender: string | null; address: string | null };
  totalAdvance: string;
}

/** The invoice's ruled-table look, scoped to this sheet so the two documents
 *  read as coming off the same counter without sharing a stylesheet. */
const ADV_TABLE_CSS = `
  #print-sheet .adv-section-title { font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--pr-ink); }
  #print-sheet .adv-table { border-collapse: collapse; }
  #print-sheet .adv-table th {
    border-top: .8px solid var(--pr-ink); border-bottom: .8px solid var(--pr-ink);
    font-weight: 800; text-transform: uppercase; letter-spacing: .05em; font-size: 8px; color: var(--pr-ink);
  }
  #print-sheet .adv-table td { border-bottom: .4px solid var(--pr-line); }
`;

const money = (v: string | number) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const GENDER: Record<string, string> = { MALE: "M", FEMALE: "F", OTHER: "O" };
const MODE_LABEL: Record<string, string> = {
  CASH: "Cash", UPI: "UPI", CARD: "Card", NETBANKING: "Net banking", OTHER: "Other",
};
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

export function AdvanceReceipt() {
  const { advanceId } = useParams<{ advanceId: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    api.get<Data>(`/ipd/advances/${advanceId}/print`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the receipt."));
  }, [advanceId]);

  useEffect(() => {
    if (!d?.advance.receiptNo || !barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, d.advance.receiptNo, {
        format: "CODE128", displayValue: false, height: 26, width: 1.1,
        margin: 0, background: "transparent", lineColor: "#17211e",
      });
    } catch { /* non-encodable number - barcode simply omitted */ }
  }, [d]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!d) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the receipt…</div>;

  const ageSex = [
    d.patient.age != null ? `${d.patient.age}y` : null,
    d.patient.gender ? GENDER[d.patient.gender] ?? d.patient.gender : null,
  ].filter(Boolean).join(" / ") || "-";
  const amount = Number(d.advance.amount);
  // An earlier deposit exists on this stay - show the running total so the
  // family can see the whole of what the hospital holds, not just today's slip.
  const priorHeld = Math.max(0, Math.round((Number(d.totalAdvance) - amount) * 100) / 100);

  const Meta = ({ k, v }: { k: string; v: string }) => (
    <div className="flex items-baseline gap-1.5">
      <span className="shrink-0 whitespace-nowrap text-[8px] font-bold uppercase tracking-wide text-[#57655f]">{k}</span>
      <span className="truncate font-mono text-[10px] font-medium text-[var(--pr-ink)]">{v}</span>
    </div>
  );

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: INVOICE_PRINT_CSS + ADV_TABLE_CSS }} />
      <PrintToolbar title={`Advance · ${d.advance.receiptNo ?? d.admission.ipNumber} · ${d.patient.fullName}`} />

      <div id="print-sheet">
        <BillHead hospital={d.hospital} />

        {/* title + barcode - the word ADVANCE does the heavy lifting here */}
        <div className="keep-together rule mt-1 flex items-start justify-between gap-4 pb-0.5">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.05em]" style={{ color: "var(--pr-primary)" }}>
              Advance / Deposit Receipt
              <span className="ml-1 font-semibold text-[#57655f]">(Original)</span>
            </p>
            <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-[#57655f]">
              Inpatient admission · not a tax invoice
            </p>
          </div>
          <svg ref={barcodeRef} className="h-[26px] w-[120px]" aria-label={`Barcode ${d.advance.receiptNo ?? ""}`} />
        </div>

        <div className="keep-together mt-2 grid grid-cols-3 gap-x-6 gap-y-0.5">
          {/* Pre-receipt rows print an honest blank rather than a made-up number. */}
          <Meta k="Receipt No" v={d.advance.receiptNo ?? "Not numbered"} />
          <Meta k="IP No" v={d.admission.ipNumber} />
          <Meta k="Received" v={dateTime(d.advance.takenAt)} />
        </div>

        <div className="keep-together mt-2 grid grid-cols-[2fr_2fr] gap-x-6 py-1.5">
          <div className="space-y-0.5">
            <Meta k="Patient" v={d.patient.fullName} />
            <Meta k="UHID" v={d.patient.displayId} />
            <Meta k="Address" v={d.patient.address || "-"} />
          </div>
          <div className="space-y-0.5">
            <Meta k="Age/Sex" v={ageSex} />
            <Meta k="Phone" v={d.patient.phone} />
            <Meta k="Ward / Bed" v={bedLabel(d.admission.ward, d.admission.bedNo)} />
          </div>
        </div>

        {/* ── PARTICULARS, laid out as a bill ──────────────────────────────
            Families ask for "a proper bill" for a deposit, and they are right
            to: they have handed over real money and a highlighted band with one
            number on it does not read as a document anybody would accept back.
            So this takes the invoice's shape - a ruled particulars table and a
            totals block in the same place on the page.

            What it does NOT take is the invoice's TITLE. A deposit is money the
            hospital holds, not a supply, so it carries no GST and there is no
            HSN, no CGST/SGST split and no "Tax Invoice" anywhere on it. Dressing
            a deposit as a tax invoice would be a false tax document, and the
            family would be holding two invoices for one treatment. The layout
            is the bill's; the wording stays honest. */}
        <div className="keep-together mt-2.5">
          <div className="adv-section-title mb-[3px]">Particulars</div>
          <table className="adv-table w-full text-[9px]">
            <thead>
              <tr className="text-left">
                <th className="w-[20px] px-1 py-[4px] text-center">#</th>
                <th className="px-1.5 py-[4px]">Description</th>
                <th className="w-[70px] px-1 py-[4px]">Mode</th>
                <th className="w-[80px] px-1.5 py-[4px] text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="align-top">
                <td className="px-1 py-[4px] text-center font-mono text-[8px] text-[#3f3f3f]">1</td>
                <td className="px-1.5 py-[4px] font-medium">
                  Advance received towards inpatient treatment
                  <div className="mt-[1px] text-[8px] font-normal text-[#57655f]">
                    Under {d.admission.doctorName} · admitted {dateTime(d.admission.admittedAt)}
                    {d.advance.reference ? ` · ref ${d.advance.reference}` : ""}
                  </div>
                </td>
                <td className="px-1 py-[4px] font-mono text-[8px] text-[#3f3f3f]">
                  {MODE_LABEL[d.advance.mode] ?? d.advance.mode}
                </td>
                <td className="px-1.5 py-[4px] text-right font-mono font-bold">{money(amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Totals, right-aligned where a bill puts them. */}
        <div className="keep-together mt-2 grid grid-cols-[1fr_190px] gap-x-6">
          <div className="self-end">
            <p className="text-[8px] font-bold uppercase tracking-wide text-[#3c4a45]">Rupees</p>
            <p className="text-[9.5px] font-semibold text-[var(--pr-ink)]">{amountInWords(amount)}</p>
            <div className="mt-1.5 space-y-0.5">
              <Meta k="Received by" v={d.advance.receivedBy} />
            </div>
          </div>
          <table className="w-full text-[9px]">
            <tbody>
              <tr>
                <td className="py-[2px] text-[#3c4a45]">This receipt</td>
                <td className="py-[2px] text-right font-mono">{money(amount)}</td>
              </tr>
              {priorHeld > 0 && (
                <tr>
                  <td className="py-[2px] text-[#3c4a45]">Advance held earlier</td>
                  <td className="py-[2px] text-right font-mono">{money(priorHeld)}</td>
                </tr>
              )}
              <tr className="border-t-2" style={{ borderColor: "var(--pr-primary)" }}>
                <td className="pt-[3px] text-[9.5px] font-extrabold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>
                  Total advance held
                </td>
                <td className="pt-[3px] text-right font-mono text-[12px] font-extrabold" style={{ color: "var(--pr-primary)" }}>
                  {money(d.totalAdvance)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* The sentence that stops this slip being mistaken for the final bill. */}
        <div className="keep-together mt-3 rounded-sm border px-2.5 py-2 text-[9px] leading-relaxed" style={{ borderColor: "var(--pr-line)" }}>
          <p className="font-bold uppercase tracking-wide text-[#3c4a45]">This is not a bill</p>
          <p className="mt-0.5 text-[#3c4a45]">
            The amount above is a deposit held against this admission. It is deducted in full from the final
            bill raised at discharge. If the treatment costs less than the advance, the difference is refunded -
            it is not retained by the hospital. Please produce this receipt at the billing counter on discharge.
          </p>
        </div>

        <div className="keep-together mt-6 flex items-end justify-between">
          <p className="text-[8px] text-[#6b7772]">
            Computer-generated receipt for {d.admission.ipNumber}. Valid without signature.
          </p>
          <div className="text-center">
            <div className="mx-auto w-[150px] border-b" style={{ borderColor: "var(--pr-ink)" }} />
            <div className="mt-1 text-[9px] font-semibold">Cashier / Front desk</div>
            <div className="text-[8px] text-[#57655f]">{d.hospital?.legalName ?? "Jeeva Multispeciality Hospital"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
