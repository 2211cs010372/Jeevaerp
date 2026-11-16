"use client";

import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { PrintToolbar } from "@/components/print/stationery";
import { InvoiceDoc, INVOICE_SHEET_CSS, type Invoice } from "@/components/print/invoice-sheet";

interface Data {
  invoices: Invoice[];
  hospital: { legalName: string } | null;
}

const SOURCE_LABEL: Record<string, string> = {
  CONSULTATION: "OP Consultation", LAB: "Laboratory", PHARMACY: "Pharmacy",
  IPD: "Inpatient / Bed charges", OTHER: "Services",
};

export function StayInvoicesSheet({ filterSource }: { filterSource?: "LAB" | "PHARMACY" }) {
  const { admissionId } = useParams<{ admissionId: string }>();
  const searchParams = useSearchParams();
  const sourceParam = (filterSource ?? searchParams?.get("source")?.toUpperCase()) as "LAB" | "PHARMACY" | undefined;

  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Data>(`/ipd/admissions/${admissionId}/invoices`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the bills."));
  }, [admissionId]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!d) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the bills…</div>;

  const filteredInvoices = sourceParam
    ? d.invoices.filter((inv) => inv.source === sourceParam)
    : d.invoices;

  const filterTitle = sourceParam === "LAB" ? "Lab bills" : sourceParam === "PHARMACY" ? "Pharmacy bills" : "All bills";

  if (!filteredInvoices.length) {
    return (
      <div className="p-10 text-center text-[14px] text-[#5a6a66]">
        {sourceParam
          ? `No ${sourceParam.toLowerCase()} bills found for this stay.`
          : "No bills have been raised against this stay yet."}
      </div>
    );
  }

  const total = filteredInvoices.reduce((s, i) => s + Number(i.totalAmount), 0);

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: INVOICE_SHEET_CSS + RUN_CSS }} />
      <PrintToolbar title={`${filterTitle} · ${filteredInvoices.length} · ${filteredInvoices[0].patient.fullName}`} />

      {/* ── THE RUN SHEET ── */}
      <div id="print-sheet">
        <div className="run-index">
          <div className="text-[12px] font-bold uppercase tracking-wide">
            {sourceParam ? `${filterTitle} in this run` : "Bills in this run"}
          </div>
          <table className="mt-1.5 w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-t border-[#333]">
                <th className="w-[8%] pb-[3px] text-left text-[9px] font-bold uppercase">#</th>
                <th className="w-[30%] pb-[3px] text-left text-[9px] font-bold uppercase">Invoice No</th>
                <th className="w-[20%] pb-[3px] text-left text-[9px] font-bold uppercase">Date</th>
                <th className="w-[20%] pb-[3px] text-left text-[9px] font-bold uppercase">Counter</th>
                <th className="w-[16%] pb-[3px] text-right text-[9px] font-bold uppercase">Amount(₹)</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv, i) => (
                <tr key={inv.id}>
                  <td className="py-[3px] font-mono text-[9px]">{i + 1}</td>
                  <td className="py-[3px] font-mono text-[9px]">{inv.receiptNo}</td>
                  <td className="py-[3px] font-mono text-[9px]">{fmt(inv.billDate ?? inv.createdAt)}</td>
                  <td className="py-[3px]">{SOURCE_LABEL[inv.source] ?? inv.source}</td>
                  <td className="py-[3px] text-right font-mono">{money(inv.totalAmount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} />
                <td className="border-t border-[#333] py-[3px] text-right text-[9px] font-bold uppercase">Total</td>
                <td className="border-t border-[#333] py-[3px] text-right font-mono font-bold">{money(total)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1.5 text-[8.5px] leading-relaxed text-[#57655f]">
            Each bill below is its own tax invoice and is unchanged from the one its counter
            issued. This page is a packing list for the bundle, not a bill.
          </p>
        </div>

        {filteredInvoices.map((inv) => (
          <Fragment key={inv.id}>
            <div className="run-break" />
            <InvoiceDoc inv={inv} embedded />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const money = (v: string | number) =>
  Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** dd-mm-yyyy matching the IP final bill (timings removed as requested). */
const fmt = (iso: string) => {
  const x = new Date(iso);
  return `${String(x.getDate()).padStart(2, "0")}-${String(x.getMonth() + 1).padStart(2, "0")}-${x.getFullYear()}`;
};

const RUN_CSS = `
  .run-index { margin-bottom: 4mm; }
  .run-break { break-before: page; page-break-before: always; }
  /* The first bill follows the index on its own sheet; every later one breaks
     the same way, so the rule is one line rather than a first-child exception. */
  @media screen {
    .run-break { height: 0; border-top: 1px dashed #b9c6c1; margin: 6mm 0; }
  }
`;
