"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { PRINT_CSS, PrintToolbar, BillHead, FooterBand, type HospitalInfo } from "@/components/print/stationery";

interface DayCloseData {
  hospital: HospitalInfo | null;
  date: string;
  till: string | null;
  tillLabel: string;
  modes: { mode: string; collected: number; refunded: number; net: number; count: number }[];
  totals: { collected: number; refunded: number; net: number };
  cashInHand: number;
  bills: number;
  refundCount: number;
  byCounter: { name: string; count: number; amount: number }[];
  gst?: {
    subtotal: number;
    discount: number;
    taxable: number;
    cgst: number;
    sgst: number;
    totalTax: number;
    total: number;
  };
}

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

const PHARMACY_DAY_CLOSE_MONO_CSS = `
  .print-stage {
    --pr-ink: #111111;
    --pr-primary: var(--pr-ink);
    --pr-accent: var(--pr-ink);
    --pr-line: #9c9c9c;
    --pr-hair: #cfcfcf;
    --pr-muted: #3f3f3f;
    --pr-neg: var(--pr-ink);
    --pr-warn: var(--pr-ink);
  }
  #print-sheet {
    font-family: var(--font-mono, ui-monospace), "IBM Plex Mono", Consolas, monospace !important;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    color: var(--pr-ink);
  }
  #print-sheet * {
    font-family: var(--font-mono, ui-monospace), "IBM Plex Mono", Consolas, monospace !important;
  }
  #print-sheet .font-extrabold,
  #print-sheet .font-bold,
  #print-sheet .font-semibold { font-weight: 500 !important; }
  #print-sheet .font-mono { font-family: inherit !important; font-weight: 500; }
  #print-sheet [class~="text-[#3c4a45]"],
  #print-sheet [class~="text-[#57655f]"],
  #print-sheet [class~="text-[#5a6a66]"],
  #print-sheet [class~="text-[#6b7772]"],
  #print-sheet [class~="text-[#8b9691]"] { color: var(--pr-muted) !important; }
  #print-sheet [class~="text-[#8a3b2e]"] { color: var(--pr-ink) !important; }
  #print-sheet .gap-x-10 { column-gap: 24px; }
  #print-sheet thead { break-inside: avoid; break-after: avoid; }
  #print-sheet tr { break-inside: avoid; }
`;

export function PharmacyDayCloseSheet() {
  return (
    <Suspense fallback={<div className="p-10 text-center font-mono text-[14px] text-[#5a6a66]">Preparing pharmacy statement…</div>}>
      <PharmacyDayCloseSheetInner />
    </Suspense>
  );
}

function PharmacyDayCloseSheetInner() {
  const params = useSearchParams();
  const date = params.get("date") ?? "";
  const [d, setD] = useState<DayCloseData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (date) q.set("date", date);
    const qs = q.toString();
    api.get<DayCloseData>(`/pharmacy/day-close${qs ? `?${qs}` : ""}`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load pharmacy day close."));
  }, [date]);

  if (error) return <div className="p-10 text-center font-mono text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!d) return <div className="p-10 text-center font-mono text-[14px] text-[#5a6a66]">Preparing pharmacy statement…</div>;

  const hospital = d.hospital;

  const Row = ({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: "rose" | "primary" }) => (
    <div className={`flex items-baseline justify-between gap-4 py-[3px] ${strong ? "font-bold" : ""}`}>
      <span className={strong ? "text-[11px]" : "text-[10.5px] text-[#3c4a45]"}>{k}</span>
      <span className="font-mono text-[11px]" style={tone ? { color: tone === "rose" ? "var(--pr-neg)" : "var(--pr-primary)" } : undefined}>{v}</span>
    </div>
  );

  const Th = ({ children, right, w }: { children: React.ReactNode; right?: boolean; w?: string }) => (
    <th className={`border-y-2 py-1.5 pr-2 text-[9px] font-bold uppercase tracking-wider ${right ? "text-right" : "text-left"}`}
      style={{ borderColor: "var(--pr-primary)", color: "var(--pr-primary)", width: w }}>{children}</th>
  );

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS + PHARMACY_DAY_CLOSE_MONO_CSS }} />
      <PrintToolbar title={`Pharmacy Day Close · ${prettyDate(d.date)}`} />

      <div id="print-sheet">
        <BillHead hospital={hospital} />

        <div className="rule mt-2 flex items-end justify-between pb-1">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.08em]" style={{ color: "var(--pr-primary)" }}>
              Pharmacy Day Close &amp; GST Statement
            </p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#57655f]">
              Daily collection summary, tender modes &amp; GST filing reconciliation
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] font-bold">{prettyDate(d.date)}</p>
            <p className="mt-0.5 text-[9px] uppercase tracking-wide text-[#57655f]">Till: {d.tillLabel}</p>
          </div>
        </div>

        {/* CASH IN HAND - The main number the counter drawer is physically counted against */}
        <div className="mt-3.5 border-y-2 py-2.5" style={{ borderColor: "var(--pr-primary)" }}>
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-wide text-[#3c4a45]">Cash that should be in pharmacy drawer</p>
              <p className="mt-0.5 text-[8.5px] text-[#57655f]">Cash collected from medicine sales less cash refunds given. UPI and card payments do not enter the drawer.</p>
            </div>
            <p className="shrink-0 font-mono text-[20px] font-extrabold" style={{ color: "var(--pr-primary)" }}>{money(d.cashInHand)}</p>
          </div>
          <p className="mt-1 text-[8.5px] font-bold uppercase tracking-wide text-[#3c4a45]">
            Rupees <span className="font-semibold normal-case text-[9.5px] text-[var(--pr-ink)]">{amountInWords(d.cashInHand)}</span>
          </p>
        </div>

        {/* SUMMARY HEADS */}
        <div className="mt-3.5 grid grid-cols-2 gap-x-10">
          <div>
            <p className="rule pb-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>Collections summary</p>
            <div className="mt-1">
              <Row k="Gross Collected" v={money(d.totals.collected)} />
              <Row k="Refunds Deducted" v={d.totals.refunded > 0 ? `−${money(d.totals.refunded)}` : "₹0.00"} tone={d.totals.refunded > 0 ? "rose" : undefined} />
              <div className="rule" />
              <Row k="Net Revenue Collected" v={money(d.totals.net)} strong tone="primary" />
            </div>
          </div>
          <div>
            <p className="rule pb-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>Dispensing metrics</p>
            <div className="mt-1">
              <Row k="Pharmacy Bills Raised" v={String(d.bills)} />
              <Row k="Refunds Processed" v={String(d.refundCount)} />
              <Row k="Active Counter Staff" v={String(d.byCounter.length)} />
            </div>
          </div>
        </div>

        {/* BY PAYMENT MODE */}
        <p className="mt-4 text-[9.5px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>Collections by payment mode</p>
        <table className="mt-1 w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <Th w="22%">Payment Mode</Th>
              <Th right w="16%">Transactions</Th>
              <Th right w="20%">Collected</Th>
              <Th right w="20%">Refunded</Th>
              <Th right w="22%">Net Collected</Th>
            </tr>
          </thead>
          <tbody>
            {d.modes.map((m) => (
              <tr key={m.mode} className={m.collected === 0 && m.refunded === 0 ? "text-[#8b9691]" : ""}>
                <td className="rule py-[4px] pr-2 font-semibold">{m.mode}</td>
                <td className="rule py-[4px] pr-2 text-right font-mono">{m.count}</td>
                <td className="rule py-[4px] pr-2 text-right font-mono">{money(m.collected)}</td>
                <td className="rule py-[4px] pr-2 text-right font-mono">{m.refunded > 0 ? `−${money(m.refunded)}` : "—"}</td>
                <td className="rule py-[4px] text-right font-mono font-bold">{money(m.net)}</td>
              </tr>
            ))}
            <tr style={{ color: "var(--pr-primary)" }}>
              <td className="py-[5px] pr-2 text-[9.5px] font-bold uppercase tracking-wider">Total</td>
              <td className="py-[5px] pr-2 text-right font-mono font-bold">{d.modes.reduce((s, m) => s + m.count, 0)}</td>
              <td className="py-[5px] pr-2 text-right font-mono font-bold">{money(d.totals.collected)}</td>
              <td className="py-[5px] pr-2 text-right font-mono font-bold">{d.totals.refunded > 0 ? `−${money(d.totals.refunded)}` : "—"}</td>
              <td className="py-[5px] text-right font-mono font-bold">{money(d.totals.net)}</td>
            </tr>
          </tbody>
        </table>

        {/* GST & SALES TURNOVER SUMMARY - Perfect for CA & GST filing */}
        <p className="mt-4 text-[9.5px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>
          GST sales &amp; tax reconciliation (for GSTR filing)
        </p>
        <p className="mt-0.5 text-[8.5px] text-[#57655f]">
          Computed from closed pharmacy tax invoices issued for {prettyDate(d.date)}. State code: {hospital?.stateCode ?? "36"}.
        </p>
        <div className="mt-1.5 border border-[#9c9c9c] p-2.5">
          <div className="grid grid-cols-2 gap-x-8 text-[10px]">
            <div className="space-y-1">
              <div className="flex justify-between py-0.5">
                <span className="text-[#3c4a45]">Gross Medicine Sales (Subtotal)</span>
                <span className="font-mono font-semibold">{money(d.gst?.subtotal ?? d.totals.collected)}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[#3c4a45]">Discounts Allowed</span>
                <span className="font-mono">{d.gst?.discount ? `−${money(d.gst.discount)}` : "₹0.00"}</span>
              </div>
              <div className="rule my-0.5" />
              <div className="flex justify-between py-0.5 font-bold">
                <span style={{ color: "var(--pr-primary)" }}>Taxable Turnover</span>
                <span className="font-mono">{money(d.gst?.taxable ?? d.totals.net)}</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between py-0.5">
                <span className="text-[#3c4a45]">Central GST (CGST)</span>
                <span className="font-mono">{money(d.gst?.cgst ?? 0)}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[#3c4a45]">State GST (SGST)</span>
                <span className="font-mono">{money(d.gst?.sgst ?? 0)}</span>
              </div>
              <div className="rule my-0.5" />
              <div className="flex justify-between py-0.5 font-bold">
                <span style={{ color: "var(--pr-primary)" }}>Total GST Collected</span>
                <span className="font-mono">{money(d.gst?.totalTax ?? 0)}</span>
              </div>
            </div>
          </div>
          <div className="rule mt-2 pt-1 flex items-baseline justify-between text-[10.5px]">
            <span className="font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>Total Invoice Value (Taxable + GST)</span>
            <span className="font-mono font-extrabold text-[12px]">{money(d.gst?.total ?? d.totals.net)}</span>
          </div>
        </div>

        {/* BY COUNTER / PHARMACIST */}
        <p className="mt-4 text-[9.5px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>Collections by counter staff</p>
        {d.byCounter.length === 0 ? (
          <p className="mt-1 text-[10px] text-[#57655f]">No payments recorded on this day.</p>
        ) : (
          <table className="mt-1 w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <Th w="55%">Pharmacist / Dispenser</Th>
                <Th right w="20%">Transactions</Th>
                <Th right w="25%">Amount Collected</Th>
              </tr>
            </thead>
            <tbody>
              {d.byCounter.map((c) => (
                <tr key={c.name}>
                  <td className="rule py-[4px] pr-2 font-medium">{c.name}</td>
                  <td className="rule py-[4px] pr-2 text-right font-mono">{c.count}</td>
                  <td className="rule py-[4px] text-right font-mono font-semibold">{money(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* HANDOVER SIGNATURES */}
        <div className="mt-8 flex items-end justify-between gap-8">
          <div className="text-center">
            <div className="w-[180px] border-b" style={{ borderColor: "var(--pr-ink)" }} />
            <div className="mt-1 text-[9.5px] font-semibold">Counted &amp; Handed over by</div>
            <div className="text-[8.5px] text-[#57655f]">Pharmacist on duty</div>
          </div>
          <div className="text-center">
            <div className="w-[180px] border-b" style={{ borderColor: "var(--pr-ink)" }} />
            <div className="mt-1 text-[9.5px] font-semibold">Verified &amp; Received by</div>
            <div className="text-[8.5px] text-[#57655f]">Accounts / Admin</div>
          </div>
        </div>

        <p className="mt-3 text-[8px] text-[#6b7772]">
          Generated on {new Date().toLocaleString("en-IN")}. Certified figures computed from the pharmacy settlement ledger for {prettyDate(d.date)}. Retain physical copy for GSTR-1, GSTR-3B and annual GST audit reconciliation.
        </p>

        <FooterBand hospital={hospital} />
      </div>
    </div>
  );
}
