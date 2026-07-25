"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { amountInWords } from "@/lib/amount-words";
import { PRINT_CSS, PrintToolbar, BillHead, FooterBand, type HospitalInfo } from "@/components/print/stationery";
import type { DayCloseExport } from "@/lib/export/day-close-xlsx";

/**
 * The day-close statement - the sheet a receptionist signs and hands over with
 * the drawer, and the one a manager files.
 *
 * PDF here means the same thing it means everywhere else in Jeeva: this page,
 * printed. There is no generated-PDF path in this codebase on purpose (see
 * opd-sheet.tsx) - a second renderer is a second chance for the paper to
 * disagree with the screen. "Print / Save PDF" in the toolbar produces the file.
 *
 * A4 rather than the A5 bill stationery: the refund and outstanding tables are
 * unbounded, and this has to paginate cleanly when a busy day runs long.
 */

interface Data extends DayCloseExport {
  hospital: HospitalInfo | null;
}

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

export function DayCloseSheet() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the statement…</div>}>
      <DayCloseSheetInner />
    </Suspense>
  );
}

function DayCloseSheetInner() {
  const params = useSearchParams();
  const date = params.get("date") ?? "";
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Data>(`/reception/day-close${date ? `?date=${encodeURIComponent(date)}` : ""}`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the day."));
  }, [date]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!d) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the statement…</div>;

  // A missing Hospital config falls back to the printed defaults in BillHead
  // rather than blocking the statement - the money is the point, not the crest.
  const hospital = d.hospital;

  const Row = ({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: "rose" | "primary" }) => (
    <div className={`flex items-baseline justify-between gap-4 py-[3px] ${strong ? "font-bold" : ""}`}>
      <span className={strong ? "text-[11px]" : "text-[10.5px] text-[#3c4a45]"}>{k}</span>
      <span className="font-mono text-[11px]" style={tone ? { color: tone === "rose" ? "#8a3b2e" : "var(--pr-primary)" } : undefined}>{v}</span>
    </div>
  );

  const Th = ({ children, right, w }: { children: React.ReactNode; right?: boolean; w?: string }) => (
    <th className={`border-y-2 py-1 pr-2 text-[8.5px] font-bold uppercase tracking-wide ${right ? "text-right" : "text-left"}`}
      style={{ borderColor: "var(--pr-primary)", color: "var(--pr-primary)", width: w }}>{children}</th>
  );

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <PrintToolbar title={`Day close · ${prettyDate(d.date)}`} />

      <div id="print-sheet">
        <BillHead hospital={hospital} />

        <div className="rule mt-1 flex items-end justify-between pb-1">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.06em]" style={{ color: "var(--pr-primary)" }}>
              Day close statement
            </p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#57655f]">
              Collections, refunds and dues for one calendar day
            </p>
          </div>
          <p className="font-mono text-[11px] font-bold">{prettyDate(d.date)}</p>
        </div>

        {/* CASH IN HAND - the number the drawer is counted against. It gets its
            own box because it is the only figure on this sheet anyone acts on. */}
        <div className="mt-3 border-y-2 py-2.5" style={{ borderColor: "var(--pr-primary)" }}>
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wide text-[#3c4a45]">Cash that should be in the drawer</p>
              <p className="mt-0.5 text-[8.5px] text-[#57655f]">Cash taken less cash refunded. Card and UPI refunds do not touch it.</p>
            </div>
            <p className="shrink-0 font-mono text-[19px] font-extrabold" style={{ color: "var(--pr-primary)" }}>{money(d.cashInHand)}</p>
          </div>
          <p className="mt-1 text-[8.5px] font-bold uppercase tracking-wide text-[#3c4a45]">
            Rupees <span className="font-semibold normal-case text-[9.5px] text-[var(--pr-ink)]">{amountInWords(d.cashInHand)}</span>
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-10">
          <div>
            <p className="rule pb-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>Totals</p>
            <div className="mt-1">
              <Row k="Collected" v={money(d.totals.collected)} />
              <Row k="Refunded" v={`−${money(d.totals.refunded)}`} tone="rose" />
              <div className="rule" />
              <Row k="Net collected" v={money(d.totals.net)} strong tone="primary" />
            </div>
          </div>
          <div>
            <p className="rule pb-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>The day</p>
            <div className="mt-1">
              <Row k="Bills raised" v={String(d.bills)} />
              <Row k="Refunds given" v={String(d.refundCount)} />
              <Row k="Counters active" v={String(d.byCounter.length)} />
            </div>
          </div>
        </div>

        {/* by payment type */}
        <p className="mt-4 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>By payment type</p>
        <table className="mt-1 w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <Th w="22%">Mode</Th><Th right w="14%">Payments</Th><Th right w="21%">Collected</Th>
              <Th right w="21%">Refunded</Th><Th right w="22%">Net</Th>
            </tr>
          </thead>
          <tbody>
            {d.modes.map((m) => (
              <tr key={m.mode} className={m.collected === 0 && m.refunded === 0 ? "text-[#8b9691]" : ""}>
                <td className="rule py-[4px] pr-2 font-semibold">{m.mode}</td>
                <td className="rule py-[4px] pr-2 text-right font-mono">{m.count}</td>
                <td className="rule py-[4px] pr-2 text-right font-mono">{money(m.collected)}</td>
                <td className="rule py-[4px] pr-2 text-right font-mono">{m.refunded > 0 ? `−${money(m.refunded)}` : "-"}</td>
                <td className="rule py-[4px] text-right font-mono font-bold">{money(m.net)}</td>
              </tr>
            ))}
            <tr style={{ color: "var(--pr-primary)" }}>
              <td className="py-[5px] pr-2 text-[9px] font-bold uppercase tracking-wide">Total</td>
              <td className="py-[5px] pr-2 text-right font-mono font-bold">{d.modes.reduce((s, m) => s + m.count, 0)}</td>
              <td className="py-[5px] pr-2 text-right font-mono font-bold">{money(d.totals.collected)}</td>
              <td className="py-[5px] pr-2 text-right font-mono font-bold">{d.totals.refunded > 0 ? `−${money(d.totals.refunded)}` : "-"}</td>
              <td className="py-[5px] text-right font-mono font-bold">{money(d.totals.net)}</td>
            </tr>
          </tbody>
        </table>

        {/* by counter */}
        <p className="mt-4 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>By counter</p>
        {d.byCounter.length === 0 ? (
          <p className="mt-1 text-[10px] text-[#57655f]">No payments were taken on this day.</p>
        ) : (
          <table className="mt-1 w-full border-collapse text-[10px]">
            <thead><tr><Th w="58%">Received by</Th><Th right w="18%">Transactions</Th><Th right w="24%">Amount</Th></tr></thead>
            <tbody>
              {d.byCounter.map((c) => (
                <tr key={c.name}>
                  <td className="rule py-[4px] pr-2">{c.name}</td>
                  <td className="rule py-[4px] pr-2 text-right font-mono">{c.count}</td>
                  <td className="rule py-[4px] text-right font-mono font-semibold">{money(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* refunds - money that LEFT the hospital gets named, never summarised */}
        {d.refunds.length > 0 && (
          <>
            <p className="mt-4 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>Refunds given</p>
            <table className="mt-1 w-full border-collapse text-[10px]">
              <thead>
                <tr>
                  <Th w="14%">Receipt</Th><Th w="22%">Patient</Th><Th right w="14%">Amount</Th>
                  <Th w="11%">Mode</Th><Th w="25%">Reason</Th><Th w="14%">By</Th>
                </tr>
              </thead>
              <tbody>
                {d.refunds.map((r, i) => (
                  <tr key={i}>
                    <td className="rule py-[4px] pr-2 font-mono text-[9px]">{r.receiptNo}</td>
                    <td className="rule py-[4px] pr-2">{r.patient}</td>
                    <td className="rule py-[4px] pr-2 text-right font-mono" style={{ color: "#8a3b2e" }}>−{money(r.amount)}</td>
                    <td className="rule py-[4px] pr-2">{r.mode}</td>
                    <td className="rule py-[4px] pr-2 text-[9px]">{r.reason}</td>
                    <td className="rule py-[4px] text-[9px]">{r.by} <span className="text-[#8b9691]">{timeOf(r.at)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* outstanding */}
        {d.outstanding.length > 0 && (
          <>
            <p className="mt-4 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>Raised today, still due</p>
            <table className="mt-1 w-full border-collapse text-[10px]">
              <thead>
                <tr><Th w="16%">Receipt</Th><Th w="38%">Patient</Th><Th right w="15%">Bill total</Th><Th right w="15%">Paid</Th><Th right w="16%">Due</Th></tr>
              </thead>
              <tbody>
                {d.outstanding.map((o) => (
                  <tr key={o.receiptNo}>
                    <td className="rule py-[4px] pr-2 font-mono text-[9px]">{o.receiptNo}</td>
                    <td className="rule py-[4px] pr-2">{o.patient}</td>
                    <td className="rule py-[4px] pr-2 text-right font-mono">{money(o.total)}</td>
                    <td className="rule py-[4px] pr-2 text-right font-mono">{money(o.paid)}</td>
                    <td className="rule py-[4px] text-right font-mono font-bold" style={{ color: "#8a5a1a" }}>{money(o.due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* handover signatures - this sheet accompanies physical cash */}
        <div className="mt-8 flex items-end justify-between gap-8">
          <div className="text-center">
            <div className="w-[170px] border-b" style={{ borderColor: "var(--pr-ink)" }} />
            <div className="mt-1 text-[9.5px] font-semibold">Counted &amp; handed over by</div>
            <div className="text-[8.5px] text-[#57655f]">Front desk</div>
          </div>
          <div className="text-center">
            <div className="w-[170px] border-b" style={{ borderColor: "var(--pr-ink)" }} />
            <div className="mt-1 text-[9.5px] font-semibold">Received by</div>
            <div className="text-[8.5px] text-[#57655f]">Accounts / Admin</div>
          </div>
        </div>
        <p className="mt-2 text-[8px] text-[#6b7772]">
          Generated {new Date().toLocaleString("en-IN")}. Figures are computed from the payment and refund ledger for
          {" "}{prettyDate(d.date)} and change only if that day&apos;s entries are corrected.
        </p>

        <FooterBand hospital={hospital} />
      </div>
    </div>
  );
}
