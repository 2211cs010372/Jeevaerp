"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { PrintToolbar } from "@/components/print/stationery";
import { InvoiceDoc, INVOICE_SHEET_CSS, type Invoice } from "@/components/print/invoice-sheet";

/**
 * EVERY BILL ON ONE STAY, PRINTED AS A RUN.
 *
 * A stay is billed by three counters on three documents - the ward's IPD
 * invoice, the pharmacy's, the lab's - and "give me the bills" means all of
 * them. Doing that one at a time meant reading a receipt number off a screen,
 * opening it, printing, going back, six times; that is where one gets missed,
 * and a missed pharmacy bill is a query from the insurer three weeks later.
 *
 * EACH ONE IS STILL ITS OWN INVOICE. This is not a summary and not a combined
 * bill - every sheet in the run is the same tax document the counter would have
 * printed on its own, with its own number, its own GST and its own copies. Only
 * the paper handling is shared: one stylesheet, one toolbar, one page break
 * between bills so nothing runs into the next.
 */

interface Data {
  invoices: Invoice[];
  hospital: { legalName: string } | null;
}

const SOURCE_LABEL: Record<string, string> = {
  CONSULTATION: "OP Consultation", LAB: "Laboratory", PHARMACY: "Pharmacy",
  IPD: "Inpatient / Bed charges", OTHER: "Services",
};

export function StayInvoicesSheet() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Data>(`/ipd/admissions/${admissionId}/invoices`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the bills."));
  }, [admissionId]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!d) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the bills…</div>;
  if (!d.invoices.length) {
    return (
      <div className="p-10 text-center text-[14px] text-[#5a6a66]">
        No bills have been raised against this stay yet.
      </div>
    );
  }

  const total = d.invoices.reduce((s, i) => s + Number(i.totalAmount), 0);

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: INVOICE_SHEET_CSS + RUN_CSS }} />
      <PrintToolbar title={`All bills · ${d.invoices.length} · ${d.invoices[0].patient.fullName}`} />

      {/* ── THE RUN SHEET ── what is in the stack, so whoever picks it up off
          the tray can check nothing is missing before it is handed over. It is
          screen-and-paper both: on paper it is the cover page of the bundle. */}
      <div id="print-sheet">
        <div className="run-index">
          <div className="text-[12px] font-bold uppercase tracking-wide">Bills in this run</div>
          <table className="mt-1.5 w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-t border-[#333]">
                <th className="w-[8%] pb-[3px] text-left text-[9px] font-bold uppercase">#</th>
                <th className="w-[30%] pb-[3px] text-left text-[9px] font-bold uppercase">Invoice No</th>
                <th className="w-[26%] pb-[3px] text-left text-[9px] font-bold uppercase">Date &amp; time</th>
                <th className="w-[20%] pb-[3px] text-left text-[9px] font-bold uppercase">Counter</th>
                <th className="w-[16%] pb-[3px] text-right text-[9px] font-bold uppercase">Amount(₹)</th>
              </tr>
            </thead>
            <tbody>
              {d.invoices.map((inv, i) => (
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

        {d.invoices.map((inv) => (
          <Fragment key={inv.id}>
            {/* A hard break per bill. Two invoices sharing a sheet is how the
                second one gets handed over as page two of the first. */}
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
/** dd-mm-yyyy h:mm AM/PM, matching the IP final bill. Two bills raised on one
 *  day are told apart by the clock, not by their position in the list. */
const fmt = (iso: string) => {
  const x = new Date(iso);
  const h = x.getHours();
  const date = `${String(x.getDate()).padStart(2, "0")}-${String(x.getMonth() + 1).padStart(2, "0")}-${x.getFullYear()}`;
  return `${date} ${h % 12 === 0 ? 12 : h % 12}:${String(x.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
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
