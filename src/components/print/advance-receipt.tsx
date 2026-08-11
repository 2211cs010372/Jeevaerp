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
      <style dangerouslySetInnerHTML={{ __html: INVOICE_PRINT_CSS }} />
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

        {/* the money - one figure, deliberately unmissable */}
        <div className="keep-together mt-2 border-y-2 py-2" style={{ borderColor: "var(--pr-primary)" }}>
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[8px] font-bold uppercase tracking-wide text-[#3c4a45]">Advance received towards inpatient treatment</p>
              <p className="mt-0.5 text-[9px] text-[#57655f]">
                Under {d.admission.doctorName} · admitted {dateTime(d.admission.admittedAt)}
              </p>
            </div>
            <p className="shrink-0 font-mono text-[17px] font-extrabold" style={{ color: "var(--pr-primary)" }}>
              {money(amount)}
            </p>
          </div>
          <p className="mt-1.5 text-[8px] font-bold uppercase tracking-wide text-[#3c4a45]">
            Rupees <span className="font-semibold normal-case text-[9.5px] text-[var(--pr-ink)]">{amountInWords(amount)}</span>
          </p>
        </div>

        <div className="keep-together mt-2 grid grid-cols-3 gap-x-6 gap-y-0.5">
          <Meta k="Paid by" v={MODE_LABEL[d.advance.mode] ?? d.advance.mode} />
          <Meta k="Reference" v={d.advance.reference || "-"} />
          <Meta k="Received by" v={d.advance.receivedBy} />
        </div>

        {priorHeld > 0 && (
          <div className="keep-together mt-2 rule-strong pb-1">
            <div className="flex items-baseline justify-between text-[9.5px]">
              <span className="font-semibold text-[#3c4a45]">Advance held earlier on this admission</span>
              <span className="font-mono">{money(priorHeld)}</span>
            </div>
            <div className="flex items-baseline justify-between text-[9.5px] font-bold" style={{ color: "var(--pr-primary)" }}>
              <span>Total advance now held</span>
              <span className="font-mono">{money(d.totalAdvance)}</span>
            </div>
          </div>
        )}

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
