"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import JsBarcode from "jsbarcode";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { BillHead, PrintToolbar, type HospitalInfo } from "@/components/print/stationery";

/**
 * DETAILED BILL (CREDIT) - the sheet that goes to the insurer.
 *
 * This is the one document in the ERP whose reader is not in the building. A TPA
 * assessor gets it as paper or a PDF attachment, reads it once against a policy,
 * and either pays or raises a query - and every query costs the hospital weeks.
 * So the layout is not a house style choice: it copies the bill format the desk
 * already submits and the assessors already know how to read.
 *
 * Three things it does that the A5 counter invoice deliberately does not:
 *
 *   A4, NOT A5. Forty line items and five subtotals do not fit on a half-sheet,
 *   and a claim bill that runs to six cramped pages gets read less carefully.
 *
 *   GROUPED WITH SUBTOTALS. Ward, doctor visits, services, investigations and
 *   pharmacy each total on their own line, because that is the granularity a
 *   policy is written at - a room-rent cap applies to the ward subtotal, not to
 *   the bill.
 *
 *   BOTH BARCODES. IP number and bill number. The assessor's file and the
 *   hospital's file are reconciled on those two numbers, by hand, months later.
 *
 * It prints through the browser's own "Save as PDF", which is how every other
 * sheet here produces a PDF: no server-side renderer to keep alive, and what the
 * desk sees on screen is byte-for-byte what the insurer receives.
 */

interface BillLine {
  date: string | null; issueNo: string | null; code: string | null;
  description: string; batchNo: string | null; expiry: string | null;
  rate: string; qty: number; amount: string;
}
interface BillGroup { title: string; subtitle: string | null; lines: BillLine[]; total: string }
interface Data {
  hospital: (HospitalInfo & { logoDataUrl?: string | null }) | null;
  provisional: boolean;
  billNo: string;
  billedAt: string;
  patient: { fullName: string; displayId: string; age: number | null; gender: string | null; phone: string };
  admission: {
    ipNumber: string; doctor: string; department: string;
    ward: string; bedNo: string; admittedAt: string; dischargedAt: string | null;
  };
  sourceType: string;
  insurer: string | null;
  policyNo: string | null;
  groups: BillGroup[];
  gross: string; discount: string; gst: string; netBill: string; advance: string; netPayable: string;
}

const money = (v: string | number) =>
  Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GENDER: Record<string, string> = { MALE: "MALE", FEMALE: "FEMALE", OTHER: "OTHER" };
/**
 * Some doctors are stored with the honorific already on the name and some are
 * not, so prefixing unconditionally printed "Dr. Dr. Aditya Bellala" on a bill
 * going to an insurer. Add it only when it is missing.
 */
const withDr = (name: string) => (/^dr\.?\s/i.test(name.trim()) ? name.trim() : `Dr. ${name.trim()}`);
const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) : "-";
const d = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

export function DetailedBillSheet() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [b, setB] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ipBar = useRef<SVGSVGElement>(null);
  const billBar = useRef<SVGSVGElement>(null);

  useEffect(() => {
    api.get<Data>(`/insurance/admissions/${admissionId}/bill`)
      .then(setB)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the bill."));
  }, [admissionId]);

  // The two numbers the claim gets reconciled on, machine-readable. Drawn after
  // the data lands, because JsBarcode writes into a node that must already exist.
  useEffect(() => {
    if (!b) return;
    const draw = (node: SVGSVGElement | null, value: string) => {
      if (!node) return;
      try {
        JsBarcode(node, value, { format: "CODE128", width: 1.3, height: 34, displayValue: false, margin: 0 });
      } catch { /* an unencodable value must not take the whole bill down */ }
    };
    draw(ipBar.current, b.admission.ipNumber);
    draw(billBar.current, b.billNo);
  }, [b]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!b) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Loading…</div>;

  return (
    <div className="print-stage">
      <style>{CSS}</style>
      <PrintToolbar title={`Detailed bill · ${b.admission.ipNumber}`} />

      <div id="print-sheet">
        <BillHead hospital={b.hospital} />
        <div className="mt-1 text-center text-[12px] font-bold">
          Detailed Bill (Credit)
          {/* Said on the sheet, not just in the UI. A bill for a stay that is
              still running WILL be filed by somebody as if it were final. */}
          {b.provisional && (
            <span className="ml-2 rounded border border-[#8a5a1a] px-1.5 py-[1px] text-[8.5px] font-bold uppercase tracking-wide text-[#8a5a1a]">
              Provisional · stay in progress
            </span>
          )}
        </div>

        {/* ── WHO, AND WHICH BILL ── two columns inside one box, as on the form
            the desk submits today. Kept together so it never splits across a
            page: a continuation page whose header is on the previous sheet is
            the single easiest way to lose a page of a claim. */}
        <div className="keep-together mt-2 grid grid-cols-2 border border-[#333]">
          <div className="border-r border-[#333] p-1.5">
            <F k="Patient Name" v={b.patient.fullName.toUpperCase()} strong />
            <F k="Age/Gender" v={`${b.patient.age != null ? `${b.patient.age} Y` : "-"} / ${GENDER[b.patient.gender ?? ""] ?? "-"}`} />
            <F k="Mobile No" v={b.patient.phone} />
            <F k="Doctor" v={withDr(b.admission.doctor)} />
            <F k="Department" v={b.admission.department} />
            <F k="Ward/Bed No" v={`${b.admission.ward} / ${b.admission.bedNo}`} />
            <F k="Source Type" v={b.sourceType} strong />
          </div>
          <div className="p-1.5">
            <F k="IP No" v={b.admission.ipNumber} />
            <F k="MR No" v={b.patient.displayId} />
            <F k="Bill No" v={b.billNo} strong />
            <F k="Bill Date & Time" v={dt(b.billedAt)} />
            <F k="Admission Date & Time" v={dt(b.admission.admittedAt)} />
            <F k="Discharge Date & Time" v={b.admission.dischargedAt ? dt(b.admission.dischargedAt) : "-"} />
            <F k="Insurer / Policy" v={b.insurer ? `${b.insurer}${b.policyNo ? ` · ${b.policyNo}` : ""}` : "-"} />
          </div>
        </div>

        {/* ── THE LINES ── */}
        <table className="mt-2 w-full border-collapse text-[9.5px]">
          <thead>
            <tr className="border-b border-t border-[#333]">
              <Th w="9%">Date</Th>
              <Th w="10%">Issue No</Th>
              <Th w="7%">Code</Th>
              <Th w="31%">Description</Th>
              <Th w="9%">Batchno</Th>
              <Th w="8%">Expirydt</Th>
              <Th w="8%" right>Rate</Th>
              <Th w="6%" right>Qty</Th>
              <Th w="12%" right>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {/* A keyed Fragment, not a bare one: each group emits a heading, its
                lines and a subtotal as siblings, and only the wrapper can carry
                the key that keeps them associated across a re-render. */}
            {b.groups.map((g) => (
              <Fragment key={g.title}>
                <tr>
                  <td colSpan={9} className="pb-0.5 pt-2 text-[9.5px] font-bold uppercase">{g.title}</td>
                </tr>
                {g.subtitle && (
                  <tr>
                    <td colSpan={9} className="pb-0.5 pl-4 text-[9px] font-bold uppercase text-[#3c4a45]">{g.subtitle}</td>
                  </tr>
                )}
                {g.lines.map((l, i) => (
                  <tr key={`${g.title}-${i}`}>
                    <td className="py-[3px] pr-1 font-mono text-[8.5px]">{d(l.date)}</td>
                    <td className="py-[3px] pr-1 font-mono text-[8.5px]">{l.issueNo ?? ""}</td>
                    <td className="py-[3px] pr-1 font-mono text-[8.5px]">{l.code ?? ""}</td>
                    <td className="py-[3px] pr-1">{l.description}</td>
                    <td className="py-[3px] pr-1 font-mono text-[8.5px]">{l.batchNo ?? ""}</td>
                    <td className="py-[3px] pr-1 font-mono text-[8.5px]">{l.expiry ?? ""}</td>
                    <td className="py-[3px] pr-1 text-right font-mono">{money(l.rate)}</td>
                    <td className="py-[3px] pr-1 text-right font-mono">{l.qty.toFixed(2)}</td>
                    <td className="py-[3px] text-right font-mono">{money(l.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6} />
                  <td colSpan={2} className="border-t border-[#333] py-[3px] pr-1 text-right text-[9px] font-bold uppercase">
                    {g.title} Total:
                  </td>
                  <td className="border-t border-[#333] py-[3px] text-right font-mono font-bold">{money(g.total)}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>

        {/* ── THE MONEY ── kept whole, and on the right where an assessor's eye
            goes first. */}
        <div className="keep-together mt-4 flex items-start justify-between gap-8">
          <div className="min-w-0 flex-1">
            <div className="flex gap-2 text-[9.5px]">
              <span className="w-[92px] shrink-0 font-semibold">Rupees in words</span>
              <span>: <span className="font-semibold uppercase">{amountInWords(b.netPayable)}</span></span>
            </div>
            <div className="mt-6">
              <div className="w-[190px] border-b border-[#333]" />
              <div className="mt-1 text-[9px] font-bold">Patient/Attendant Signatory</div>
            </div>
          </div>

          <table className="w-[250px] text-[10px]">
            <tbody>
              <T k="Gross Total" v={money(b.gross)} />
              <T k="Less Discount" v={money(b.discount)} />
              <T k="Total GST" v={money(b.gst)} />
              <T k="Net Bill Amount" v={money(b.netBill)} rule />
              <T k="Less Advance" v={money(b.advance)} />
              <T k="Net Payable" v={money(b.netPayable)} rule strong />
            </tbody>
          </table>
        </div>

        {/* ── THE TWO NUMBERS, machine-readable ── */}
        <div className="keep-together mt-6 flex items-end justify-between gap-8">
          <div>
            <svg ref={ipBar} />
            <div className="text-[8.5px] font-semibold">( IP No )</div>
          </div>
          <div className="text-[9px]">
            <div className="flex gap-2"><span className="w-[82px] font-semibold">Bill date &amp; Time</span><span>: {dt(b.billedAt)}</span></div>
            <div className="flex gap-2"><span className="w-[82px] font-semibold">Print Date &amp; Time</span><span>: {dt(new Date().toISOString())}</span></div>
          </div>
          <div className="text-right">
            <svg ref={billBar} />
            <div className="text-[8.5px] font-semibold">( Bill No )</div>
          </div>
        </div>

        <div className="mt-4 border-t border-[#333] pt-1 text-center text-[8.5px] text-[#57655f]">
          {b.provisional
            ? "Provisional bill for pre-authorisation. The final bill is raised at discharge."
            : "Computer-generated bill. Submitted for insurance settlement."}
        </div>
      </div>
    </div>
  );
}

/** One "Label : value" row inside the header box. */
function F({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex gap-1 py-[1.5px] text-[9.5px] leading-tight">
      <span className="w-[104px] shrink-0 font-semibold">{k}</span>
      <span className="shrink-0">:</span>
      <span className={strong ? "font-bold" : ""}>{v}</span>
    </div>
  );
}

function T({ k, v, rule, strong }: { k: string; v: string; rule?: boolean; strong?: boolean }) {
  return (
    <tr className={rule ? "border-t border-[#333]" : ""}>
      <td className={`py-[3px] pr-2 ${strong ? "font-bold" : "font-semibold"}`}>{k}</td>
      <td className="py-[3px] pr-1">:</td>
      <td className={`py-[3px] text-right font-mono ${strong ? "font-bold" : ""}`}>{v}</td>
    </tr>
  );
}

function Th({ children, w, right }: { children?: React.ReactNode; w: string; right?: boolean }) {
  return (
    <th style={{ width: w }} className={`py-[3px] pr-1 text-[9px] font-bold ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

/**
 * A4, not the A5 used for counter bills - see the note at the top. `thead`
 * repeats on every printed page and no row is allowed to split, so a claim bill
 * that runs to three pages still reads as a table on each of them.
 */
const CSS = `
  .print-stage { --pr-primary: #0b5f55; --pr-ink: #17211e; --pr-line: #b9c4c0; }
  .print-stage { background: #e8e6e1; min-height: 100vh; padding: 24px 12px 64px; }

  #print-sheet {
    width: 210mm;
    margin: 0 auto;
    background: #fff;
    color: var(--pr-ink);
    box-shadow: 0 8px 40px rgba(0,0,0,.18);
    padding: 10mm 10mm;
    font-family: var(--font-sans, "Instrument Sans"), "Noto Sans Telugu", "Nirmala UI", Arial, sans-serif;
    font-size: 9.7px;
    line-height: 1.4;
  }
  #print-sheet .rule-strong { border-bottom: 2px solid var(--pr-primary); }

  @media print {
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    body * { visibility: hidden !important; }
    #print-sheet, #print-sheet * { visibility: visible !important; }
    .print-stage { background: #fff !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; }

    @page { size: A4 portrait; margin: 8mm; }

    #print-sheet {
      position: static !important;
      width: auto !important;
      margin: 0 !important;
      box-shadow: none !important;
      padding: 0 !important;
    }

    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    .keep-together { break-inside: avoid; }
  }
`;
