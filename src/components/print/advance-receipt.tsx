"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { bedLabel } from "@/lib/beds";
import { PrintToolbar, type HospitalInfo } from "@/components/print/stationery";
import {
  INVOICE_SHEET_CSS, BillLetterhead, InvoiceIdRow, MetaInline, Trow, TotalRow,
} from "@/components/print/invoice-sheet";

/**
 * The IPD advance slip - what the family walks away holding.
 *
 * THE SAME DOCUMENT AS A LAB OR PHARMACY BILL, in every respect except what it
 * is allowed to claim. Same letterhead, same meta strip, same patient block,
 * same ruled particulars table, same totals block on the right, same stylesheet
 * (INVOICE_SHEET_CSS) - so a family handed a deposit slip at admission and a
 * pharmacy bill on the ward is in no doubt the two came off the same counter.
 * Families ask for "a proper bill" for a deposit and they are right to: they
 * have handed over real money, and a slip that looks unlike every other piece
 * of paper the hospital issues does not read as a document anybody would accept
 * back at discharge.
 *
 * WHAT IT MUST NOT BORROW is the tax wording. A deposit is money the hospital
 * HOLDS; it is not a supply, so no GST split, no HSN, no tax-invoice heading, no
 * e-invoice QR. The masthead says "Advance Receipt" where a bill says "Tax
 * Invoice", and the band lower down says so in as many words - because a family
 * handed a piece of paper with a big number on it will otherwise read it as
 * their final bill and be shocked at discharge.
 *
 * AND ITS TOTAL IS ITS OWN AMOUNT. See the totals block.
 */

interface Data {
  hospital: HospitalInfo | null;
  advance: { id: string; receiptNo: string | null; amount: string; mode: string; reference: string | null; takenAt: string; receivedBy: string };
  admission: {
    ipNumber: string; ward: string; bedNo: string; admittedAt: string;
    doctorName: string; doctorRegNo: string | null;
  };
  patient: { displayId: string; fullName: string; phone: string; age: number | null; gender: string | null; address: string | null };
  /** Held against the stay AS OF THIS RECEIPT. A note on this slip, never its
   *  total - see the totals block below. */
  totalAdvance: string;
  /** `totalAdvance` less this receipt. Sent by the server rather than derived
   *  here: deriving it by subtraction is what made a LATER deposit print as
   *  "held earlier" on an earlier slip. */
  priorAdvance?: string;
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
        margin: 0, background: "transparent", lineColor: "#111111",
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
  // What was already held when this slip was written. Falls back to the old
  // subtraction only for a payload from before the server sent it.
  const priorHeld = Math.max(0, Number(
    d.priorAdvance ?? (Math.round((Number(d.totalAdvance) - amount) * 100) / 100),
  ));

  const hospitalName = d.hospital?.legalName ?? "Jeeva Multispeciality Hospital";
  const hospitalAddr = d.hospital
    ? `${d.hospital.addressLine}, ${d.hospital.city}, ${d.hospital.state} – ${d.hospital.pincode}`
    : "# 1-8-81, Sai Nagar, Beside Swimming Pool, Balasamudram, Hanamkonda, Telangana – 506 001";

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: INVOICE_SHEET_CSS }} />
      <PrintToolbar title={`Advance · ${d.advance.receiptNo ?? d.admission.ipNumber} · ${d.patient.fullName}`} />

      <div id="print-sheet">
        {/* THE BILL'S SHEET, not just its blocks. BILL_MONO_CSS strips the page
            container back to a transparent 190mm column and hands the white
            ground, the 6mm margins and the half-A4 height to `.bill-copy`.
            Without this wrapper the slip would print edge-to-edge on nothing,
            at whatever height its content happened to reach - and a deposit
            receipt half the depth of the bill beside it in the same file is
            exactly the mismatch this change exists to remove. */}
        <div className="bill-copy flex flex-col gap-[5px]">
          {/* The bill's letterhead, with the one word that changes. "Advance
              Receipt", never "Tax Invoice" - see the note at the top of the file. */}
          <BillLetterhead
            name={hospitalName}
            address={hospitalAddr}
            gstin={d.hospital?.gstin ?? null}
            phone={d.hospital?.phone ?? "9704691308"}
            logoDataUrl={d.hospital?.logoDataUrl ?? null}
            title="Advance Receipt"
            chip="Original · Patient copy"
          />

          {/* The bill's meta strip: one line, right-aligned, under the letterhead.
              Pre-receipt rows print an honest blank rather than a made-up number. */}
          <div className="flex flex-wrap items-baseline justify-end gap-x-4 py-1">
            <MetaInline k="Receipt No" v={d.advance.receiptNo ?? "Not numbered"} mono />
            <MetaInline k="IP No" v={d.admission.ipNumber} mono />
            <MetaInline k="Date" v={dateTime(d.advance.takenAt)} />
          </div>

          {/* Patient / visit information - the bill's block, with the ward added.
              A deposit is held against a bed, and the bed is what the family and
              the discharge counter both look for first. */}
          <div className="invoice-soft rounded-[2px] px-[5px] py-[4px]">
            <div className="invoice-section-label mb-[3px]">Patient &amp; Admission Details</div>
            <div className="grid grid-cols-2 gap-x-6">
              <div className="grid grid-cols-[72px_6px_1fr] items-baseline">
                <InvoiceIdRow k="Patient Name" v={d.patient.fullName} />
                <InvoiceIdRow k="Age / Sex" v={ageSex} />
                <InvoiceIdRow k="UHID" v={d.patient.displayId} mono />
              </div>
              <div className="grid grid-cols-[72px_6px_1fr] items-baseline">
                <InvoiceIdRow k="Mobile" v={d.patient.phone} mono />
                <InvoiceIdRow k="Ward / Bed" v={bedLabel(d.admission.ward, d.admission.bedNo)} />
                <InvoiceIdRow k="Address" v={d.patient.address || "-"} />
              </div>
            </div>
          </div>

          {/* ── PARTICULARS, in the bill's ruled table ────────────────────────
              One line, because a deposit is one thing. The columns a bill uses for
              HSN and GST are absent rather than blank: an empty tax column on a
              document that carries no tax invites the reading it exists to
              prevent. */}
          <div className="mt-[5px]">
            <div className="invoice-section-title mb-[3px]">Advance Particulars</div>
            <table className="invoice-table w-full text-[9.5px]">
              <thead>
                <tr className="text-left">
                  <th className="w-[34px] px-1 py-[5px] text-center">S.No</th>
                  <th className="px-1.5 py-[5px]">Description</th>
                  <th className="w-[74px] px-1 py-[5px]">Mode</th>
                  <th className="w-[88px] px-1.5 py-[5px] text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="align-top">
                  <td className="px-1 py-[5px] text-center font-mono text-[9px]">1</td>
                  <td className="px-1.5 py-[5px] text-[11px] font-medium">
                    Advance received towards inpatient treatment
                    <div className="mt-[1px] text-[8px] font-normal text-[#3f3f3f]">
                      Under {d.admission.doctorName}
                      {d.admission.doctorRegNo?.trim() && ` (Reg. No. ${d.admission.doctorRegNo.trim()})`}
                      {" · "}admitted {dateTime(d.admission.admittedAt)}
                      {d.advance.reference ? ` · ref ${d.advance.reference}` : ""}
                    </div>
                  </td>
                  <td className="px-1 py-[5px] text-[10px]">{MODE_LABEL[d.advance.mode] ?? d.advance.mode}</td>
                  <td className="px-1.5 py-[5px] text-right font-mono text-[10px] font-bold">{money(amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Totals, where the bill puts them.

              THIS RECEIPT TOTALS ITS OWN AMOUNT. It used to total the whole stay's
              deposits, so a family that paid ₹8,000 and later ₹20,000 held two
              slips both headlining ₹28,000 - and on the same page the amount in
              words said something different. The running figure is real and worth
              printing, but it is a note below, not this document's value. */}
          <div className="mt-[6px] grid grid-cols-[1fr_200px] gap-x-6">
            <div className="self-end">
              <div className="invoice-section-label mb-[2px]">Amount in words</div>
              <p className="text-[9.5px] font-semibold" style={{ color: "var(--pr-ink)" }}>{amountInWords(amount)}</p>
              <div className="mt-[5px] flex flex-wrap items-baseline gap-x-4">
                <MetaInline k="Received by" v={d.advance.receivedBy} />
              </div>
            </div>
            <div>
              <table className="w-full text-[9px]">
                <tbody>
                  <Trow k="Advance received" v={money(amount)} />
                  <TotalRow k="Total" v={money(amount)} />
                </tbody>
              </table>
              <div className="mt-[3px] flex justify-between text-[6px] text-[#3f3f3f]">
                <span>Payment status</span>
                <span className="font-bold uppercase" style={{ color: "var(--pr-ink)" }}>RECEIVED</span>
              </div>
            </div>
          </div>

          {/* The band that stops this slip being mistaken for the final bill. */}
          <div className="invoice-soft mt-[6px] rounded-[2px] px-[5px] py-[4px] text-[7.5px] leading-relaxed">
            <div className="invoice-section-label mb-[2px]">This is not a bill</div>
            <p className="text-[#3f3f3f]">
              The amount above is a deposit held against this admission. It is deducted in full from the final
              bill raised at discharge. If the treatment costs less than the advance, the difference is refunded -
              it is not retained by the hospital. Please produce this receipt at the billing counter on discharge.
            </p>
            {/* Only when an earlier deposit exists. Prose, outside the totals, so
                it can inform the discharge counter without ever being read as what
                was paid for THIS slip. */}
            {priorHeld > 0 && (
              <p className="mt-[3px] text-[#3f3f3f]">
                <b>Earlier deposits on this admission:</b> {money(priorHeld)}. Including this receipt,{" "}
                {money(d.totalAdvance)} is held against {d.admission.ipNumber}. Each deposit has its own
                receipt - please bring all of them.
              </p>
            )}
          </div>

          {/* The bill's foot, plus the barcode this document is looked up by. */}
          <div className="mt-[6px] flex items-end justify-between gap-4 border-t border-[#cfcfcf] pt-[3px]">
            <div className="min-w-0 flex-1">
              <p className="text-[5.8px] leading-snug text-[#4a4a4a]">
                Computer-generated receipt for {d.admission.ipNumber}. Please retain it for your records.
              </p>
              <svg ref={barcodeRef} className="mt-[3px] h-[26px] w-[120px]" aria-label={`Barcode ${d.advance.receiptNo ?? ""}`} />
            </div>
            <div className="w-[95px] text-center">
              <div className="border-t border-[#111111]" />
              <div className="mt-[1px] text-[6px] font-bold uppercase tracking-wide text-[#3f3f3f]">Cashier / Front desk</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
