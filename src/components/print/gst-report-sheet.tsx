"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { PRINT_CSS, PrintToolbar, BillHead, type HospitalInfo } from "@/components/print/stationery";

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const GST_PRINT_MONO_CSS = `
  .print-stage {
    --pr-ink: #111111;
    --pr-primary: var(--pr-ink);
    --pr-accent: var(--pr-ink);
    --pr-line: #9c9c9c;
    --pr-hair: #cfcfcf;
    --pr-muted: #3f3f3f;
  }
  #print-sheet {
    font-family: var(--font-mono, ui-monospace), "IBM Plex Mono", Consolas, monospace;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    color: var(--pr-ink);
  }
  #print-sheet .font-extrabold,
  #print-sheet .font-bold,
  #print-sheet .font-semibold { font-weight: 500 !important; }
  #print-sheet .font-mono { font-family: inherit; font-weight: 500; }
  #print-sheet thead { break-inside: avoid; break-after: avoid; }
  #print-sheet tr { break-inside: avoid; }
`;

interface GstReportData {
  mode: string;
  title: string;
  periodLabel: string;
  summary: {
    invoiceCount: number;
    totalSales: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalTaxAmount: number;
    exemptAmount: number;
    inwardTaxCredit: number;
    netGstPayable: number;
  };
  bySource: { source: string; label: string; totalAmount: number; taxableAmount: number; cgst: number; sgst: number; igst: number; exemptAmount: number; invoiceCount: number }[];
  bySlab: { rate: number; taxableAmount: number; cgst: number; sgst: number; igst: number; totalTax: number; invoiceCount: number }[];
  b2bInvoices?: { receiptNo: string; date: string; buyerGstin: string; buyerLegalName: string; taxableAmount: number; cgstAmount: number; sgstAmount: number; igstAmount: number; totalAmount: number }[];
  dailyRows?: { date: string; invoiceCount: number; totalAmount: number; taxableAmount: number; cgstAmount: number; sgstAmount: number; igstAmount: number; exemptAmount: number }[];
  monthlyRows?: { year: number; month: number; monthName: string; invoiceCount: number; totalSales: number; taxableAmount: number; cgstAmount: number; sgstAmount: number; igstAmount: number; totalTaxAmount: number; exemptAmount: number; inwardTaxCredit: number; netGstPayable: number }[];
}

export function GstReportSheet() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing GST Filing Statement…</div>}>
      <GstReportSheetInner />
    </Suspense>
  );
}

function GstReportSheetInner() {
  const params = useSearchParams();
  const mode = params.get("mode") || "monthly";
  const date = params.get("date") || "";
  const month = params.get("month") || "";
  const year = params.get("year") || "";
  const fy = params.get("fy") !== "false";

  const [data, setData] = useState<GstReportData | null>(null);
  const [hospital, setHospital] = useState<HospitalInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    q.set("mode", mode);
    if (date) q.set("date", date);
    if (month) q.set("month", month);
    if (year) q.set("year", year);
    q.set("fy", String(fy));

    api.get<any>(`/admin/gst?${q.toString()}`)
      .then((res) => {
        let period = "";
        let title = "GST Filing & Tax Summary Statement";

        if (mode === "daily") {
          period = `Date: ${res.date}`;
          title = "Daily GST Summary Report";
        } else if (mode === "yearly") {
          period = `Period: ${res.yearLabel}`;
          title = "Annual GST Filing Summary";
        } else {
          period = `Period: ${res.monthName} ${res.year} (${res.startDate} to ${res.endDate})`;
          title = "Monthly GST Filing Statement (GSTR-1 & 3B)";
        }

        const summary = res.summary || {
          invoiceCount: res.invoiceCount || 0,
          totalSales: res.totalSales || 0,
          taxableAmount: res.taxableAmount || 0,
          cgstAmount: res.cgstAmount || 0,
          sgstAmount: res.sgstAmount || 0,
          igstAmount: res.igstAmount || 0,
          totalTaxAmount: res.totalTaxAmount || 0,
          exemptAmount: res.exemptAmount || 0,
          inwardTaxCredit: res.inwardPurchase?.gstAmount || 0,
          netGstPayable: Math.max(0, (res.totalTaxAmount || 0) - (res.inwardPurchase?.gstAmount || 0)),
        };

        setData({
          mode,
          title,
          periodLabel: period,
          summary,
          bySource: res.bySource || [],
          bySlab: res.bySlab || [],
          b2bInvoices: res.b2bInvoices,
          dailyRows: res.dailyRows,
          monthlyRows: res.monthlyRows,
        });
      })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load GST report data."));

    api.get<{ hospital: HospitalInfo }>("/config/hospital")
      .then((r) => setHospital(r.hospital))
      .catch(() => setHospital(null));
  }, [mode, date, month, year, fy]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!data) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Generating GST Tax Sheet…</div>;

  const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
    <div className={`flex items-baseline justify-between gap-4 py-[3px] ${strong ? "font-bold" : ""}`}>
      <span className={strong ? "text-[11px]" : "text-[10.5px] text-[#3c4a45]"}>{k}</span>
      <span className="font-mono text-[11px]">{v}</span>
    </div>
  );

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS + GST_PRINT_MONO_CSS }} />
      <PrintToolbar title={`GST Statement · ${data.periodLabel}`} />

      <div id="print-sheet">
        <BillHead hospital={hospital} />

        <div className="rule mt-1 flex items-end justify-between pb-1">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.06em]">
              {data.title}
            </p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#57655f]">
              Official Hospital Tax Return &amp; Filing Summary
            </p>
          </div>
          <p className="font-mono text-[11px] font-bold">{data.periodLabel}</p>
        </div>

        {/* Net GST Payable Box */}
        <div className="mt-3 border-y-2 py-2.5" style={{ borderColor: "var(--pr-primary)" }}>
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wide text-[#3c4a45]">Net GST Liability / Payable</p>
              <p className="mt-0.5 text-[8.5px] text-[#57655f]">Outward Tax Collected less Input Tax Credit (ITC) on purchases.</p>
            </div>
            <p className="shrink-0 font-mono text-[19px] font-extrabold">{money(data.summary.netGstPayable)}</p>
          </div>
          <p className="mt-1 text-[8.5px] font-bold uppercase tracking-wide text-[#3c4a45]">
            Rupees <span className="font-semibold normal-case text-[9.5px] text-[var(--pr-ink)]">{amountInWords(data.summary.netGstPayable)}</span>
          </p>
        </div>

        {/* Summary Grid */}
        <div className="mt-3 grid grid-cols-2 gap-x-10">
          <div>
            <p className="rule pb-0.5 text-[9px] font-bold uppercase tracking-wide">Outward Tax Summary</p>
            <div className="mt-1">
              <Row k="Total Billed Revenue" v={money(data.summary.totalSales)} />
              <Row k="Taxable Supplies Value" v={money(data.summary.taxableAmount)} />
              <Row k="CGST Amount" v={money(data.summary.cgstAmount)} />
              <Row k="SGST Amount" v={money(data.summary.sgstAmount)} />
              <div className="rule" />
              <Row k="Total Output GST" v={money(data.summary.totalTaxAmount)} strong />
            </div>
          </div>
          <div>
            <p className="rule pb-0.5 text-[9px] font-bold uppercase tracking-wide">Exempt &amp; Inward Credit</p>
            <div className="mt-1">
              <Row k="Exempt Healthcare Sales" v={money(data.summary.exemptAmount)} />
              <Row k="Input Tax Credit (ITC)" v={money(data.summary.inwardTaxCredit)} />
              <Row k="Total Invoices Issued" v={String(data.summary.invoiceCount)} />
            </div>
          </div>
        </div>

        {/* Source Breakdown Table */}
        <p className="mt-4 text-[9px] font-bold uppercase tracking-wide">Outward Revenue &amp; GST by Department</p>
        <table className="mt-1 w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="border-y-2 py-1 text-left text-[8.5px] font-bold uppercase tracking-wide">Department</th>
              <th className="border-y-2 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide">Invoices</th>
              <th className="border-y-2 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide">Total Sales</th>
              <th className="border-y-2 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide">Taxable</th>
              <th className="border-y-2 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide">CGST</th>
              <th className="border-y-2 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide">SGST</th>
              <th className="border-y-2 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide">Total GST</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-300 font-mono">
            {data.bySource.map((s) => (
              <tr key={s.source}>
                <td className="py-1 font-sans text-[10.5px]">{s.label}</td>
                <td className="py-1 text-right">{s.invoiceCount}</td>
                <td className="py-1 text-right">{money(s.totalAmount)}</td>
                <td className="py-1 text-right">{money(s.taxableAmount)}</td>
                <td className="py-1 text-right">{money(s.cgst)}</td>
                <td className="py-1 text-right">{money(s.sgst)}</td>
                <td className="py-1 text-right font-bold">{money(s.cgst + s.sgst + s.igst)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* B2B Invoices if monthly */}
        {data.b2bInvoices && data.b2bInvoices.length > 0 && (
          <>
            <p className="mt-4 text-[9px] font-bold uppercase tracking-wide">B2B Registered Sales (GSTR-1 Section 4A)</p>
            <table className="mt-1 w-full border-collapse text-[9.5px]">
              <thead>
                <tr>
                  <th className="border-y-2 py-1 text-left text-[8.5px] font-bold uppercase tracking-wide">Bill No</th>
                  <th className="border-y-2 py-1 text-left text-[8.5px] font-bold uppercase tracking-wide">Date</th>
                  <th className="border-y-2 py-1 text-left text-[8.5px] font-bold uppercase tracking-wide">Buyer GSTIN</th>
                  <th className="border-y-2 py-1 text-left text-[8.5px] font-bold uppercase tracking-wide">Buyer Name</th>
                  <th className="border-y-2 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide">Taxable</th>
                  <th className="border-y-2 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide">GST</th>
                  <th className="border-y-2 py-1 text-right text-[8.5px] font-bold uppercase tracking-wide">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-300 font-mono">
                {data.b2bInvoices.map((b) => (
                  <tr key={b.receiptNo}>
                    <td className="py-1 font-bold">{b.receiptNo}</td>
                    <td className="py-1">{b.date}</td>
                    <td className="py-1 font-bold">{b.buyerGstin}</td>
                    <td className="py-1 font-sans">{b.buyerLegalName}</td>
                    <td className="py-1 text-right">{money(b.taxableAmount)}</td>
                    <td className="py-1 text-right">{money(b.cgstAmount + b.sgstAmount + b.igstAmount)}</td>
                    <td className="py-1 text-right font-bold">{money(b.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mt-auto pt-6 text-[8.5px] text-[#57655f] border-t mt-6 flex justify-between">
          <span>Jeeva HMS · Official GST Tax Report</span>
          <span>Printed on {new Date().toLocaleString("en-IN")}</span>
        </div>
      </div>
    </div>
  );
}
