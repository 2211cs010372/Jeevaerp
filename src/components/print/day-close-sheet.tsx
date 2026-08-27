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

/**
 * The day-close statement as PAPER: mono, medium, ink.
 *
 * IBM Plex Mono is loaded at 400 and 500 only (layout.tsx), so nothing here asks
 * for 600+. The browser would synthesise a fake bold, and a synthesised bold at
 * 9px on the counter's laser printer is a smear rather than emphasis. Hierarchy
 * comes from 400 against 500, uppercase and the rules instead.
 *
 * Colour is flattened to ink for the reason the bill stationery flattened it
 * (see BILL_MONO_CSS): a tint the office printer decides to drop takes the
 * meaning with it. Refunds stay readable by their leading minus and the column
 * they sit in, not by being red.
 */
const DAY_CLOSE_MONO_CSS = `
  .print-stage {
    --pr-ink: #111111;
    --pr-primary: var(--pr-ink); --pr-accent: var(--pr-ink);
    --pr-line: #9c9c9c; --pr-hair: #cfcfcf; --pr-muted: #3f3f3f;
    /* A refund and an unpaid balance still carry meaning; on this sheet they
       carry it as ink and a leading minus, so re-inking is a one-line change. */
    --pr-neg: var(--pr-ink); --pr-warn: var(--pr-ink);
  }
  #print-sheet {
    font-family: var(--font-mono, ui-monospace), "IBM Plex Mono", Consolas, monospace;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    color: var(--pr-ink);
  }
  /* Medium, never black. Re-pointing the utilities inside the sheet keeps the
     preview and the paper identical; editing thirty call sites would not. */
  #print-sheet .font-extrabold,
  #print-sheet .font-bold,
  #print-sheet .font-semibold { font-weight: 500 !important; }
  /* The sheet is mono throughout now, so .font-mono only still carries the
     weight that makes a column of rupees scan. */
  #print-sheet .font-mono { font-family: inherit; font-weight: 500; }
  /* These greys were chosen against a screen. On paper they fade, so they all
     settle on one muted ink a 600dpi laser still resolves at 9px. Matched by
     attribute rather than as escaped class selectors: inside a template literal
     a lone backslash is swallowed before CSS ever sees it, so the escaped form
     parses as invalid and the rule drops in silence. */
  #print-sheet [class~="text-[#3c4a45]"],
  #print-sheet [class~="text-[#57655f]"],
  #print-sheet [class~="text-[#5a6a66]"],
  #print-sheet [class~="text-[#6b7772]"],
  #print-sheet [class~="text-[#8b9691]"] { color: var(--pr-muted) !important; }
  #print-sheet [class~="text-[#8a3b2e]"] { color: var(--pr-ink) !important; }
  /* Mono sets about a fifth wider than the sans this sheet was drawn in. The
     tables are percentage-width and reflow on their own; the two-column head is
     not, so its gutter gives back the width the wider face takes. */
  #print-sheet .gap-x-10 { column-gap: 24px; }
  /* A busy day runs to two sheets, and a row torn in half at the fold is a row
     somebody reads wrong. */
  #print-sheet thead { break-inside: avoid; break-after: avoid; }
  #print-sheet tr { break-inside: avoid; }
`;

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
  /**
   * Which drawer this sheet is for. The API pins everyone except an ADMIN to
   * their own till whatever they ask for, so this changes nothing for a
   * receptionist printing their own handover. It matters when an ADMIN prints:
   * the screen they clicked Print on was pinned to one counter, and a sheet
   * that quietly widened to the whole hospital would be counted against the
   * wrong drawer.
   */
  const till = params.get("till") ?? "";
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Built from what was actually asked for - an empty string must not become
    // "?date=", which the API would read as a date it cannot parse.
    const q = new URLSearchParams();
    if (date) q.set("date", date);
    if (till) q.set("till", till);
    const qs = q.toString();
    api.get<Data>(`/reception/day-close${qs ? `?${qs}` : ""}`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the day."));
  }, [date, till]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!d) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the statement…</div>;

  // A missing Hospital config falls back to the printed defaults in BillHead
  // rather than blocking the statement - the money is the point, not the crest.
  const hospital = d.hospital;

  const Row = ({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: "rose" | "primary" }) => (
    <div className={`flex items-baseline justify-between gap-4 py-[3px] ${strong ? "font-bold" : ""}`}>
      <span className={strong ? "text-[11px]" : "text-[10.5px] text-[#3c4a45]"}>{k}</span>
      <span className="font-mono text-[11px]" style={tone ? { color: tone === "rose" ? "var(--pr-neg)" : "var(--pr-primary)" } : undefined}>{v}</span>
    </div>
  );

  const Th = ({ children, right, w }: { children: React.ReactNode; right?: boolean; w?: string }) => (
    <th className={`border-y-2 py-1 pr-2 text-[8.5px] font-bold uppercase tracking-wide ${right ? "text-right" : "text-left"}`}
      style={{ borderColor: "var(--pr-primary)", color: "var(--pr-primary)", width: w }}>{children}</th>
  );

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS + DAY_CLOSE_MONO_CSS }} />
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

        {/* IPD deposits - counter money with no bill behind it yet. Named one by
            one for the same reason refunds are: a family holding two slips has
            to be able to find both, and "one merged line" is the argument at the
            counter nobody can settle. Already inside the collections above. */}
        {(d.advances?.length ?? 0) > 0 && (
          <>
            <p className="mt-4 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>
              IPD advances taken
            </p>
            <p className="mt-0.5 text-[8.5px] text-[#57655f]">
              Counted in the collections above. Money held against a stay, adjusted on the discharge bill - not earned yet.
            </p>
            <table className="mt-1 w-full border-collapse text-[10px]">
              <thead>
                <tr>
                  <Th w="16%">Receipt</Th><Th w="24%">Patient</Th><Th w="16%">IP No.</Th>
                  <Th right w="16%">Amount</Th><Th w="12%">Mode</Th><Th w="16%">By</Th>
                </tr>
              </thead>
              <tbody>
                {d.advances!.map((a, i) => (
                  <tr key={i}>
                    <td className="rule py-[4px] pr-2 font-mono text-[9px]">{a.receiptNo}</td>
                    <td className="rule py-[4px] pr-2">{a.patient}</td>
                    <td className="rule py-[4px] pr-2 font-mono text-[9px]">{a.ipNumber}</td>
                    <td className="rule py-[4px] pr-2 text-right font-mono">{money(a.amount)}</td>
                    <td className="rule py-[4px] pr-2">{a.mode}</td>
                    <td className="rule py-[4px] text-[9px]">{a.by} <span className="text-[#8b9691]">{timeOf(a.at)}</span></td>
                  </tr>
                ))}
                <tr>
                  <td className="py-[5px] pr-2 font-medium uppercase tracking-wide" colSpan={3}>Total held</td>
                  <td className="py-[5px] pr-2 text-right font-mono font-bold">{money(d.advanceTotal ?? 0)}</td>
                  <td className="py-[5px]" colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </>
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
                    <td className="rule py-[4px] pr-2 text-right font-mono" style={{ color: "var(--pr-neg)" }}>−{money(r.amount)}</td>
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
                    <td className="rule py-[4px] text-right font-mono font-bold" style={{ color: "var(--pr-warn)" }}>{money(o.due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* billed to insurers - on the sheet, outside every total on it.
            This page accompanies physical cash to whoever counts it, so the one
            thing it must never do is print a figure that looks like money and
            isn't. Hence its own table, below the totals, with the caveat in the
            heading rather than in a footnote nobody reads. */}
        {(d.insurance ?? []).length > 0 && (
          <>
            <p className="mt-4 text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--pr-primary)" }}>
              Billed to insurers - not collected, not in the totals above
            </p>
            <table className="mt-1 w-full border-collapse text-[10px]">
              <thead>
                <tr><Th w="16%">Receipt</Th><Th w="40%">Patient</Th><Th w="26%">Insurer / TPA</Th><Th right w="18%">Amount</Th></tr>
              </thead>
              <tbody>
                {(d.insurance ?? []).map((o) => (
                  <tr key={o.receiptNo}>
                    <td className="rule py-[4px] pr-2 font-mono text-[9px]">{o.receiptNo}</td>
                    <td className="rule py-[4px] pr-2">{o.patient}</td>
                    <td className="rule py-[4px] pr-2 text-[9px]">{o.insurer ?? "Not recorded"}</td>
                    <td className="rule py-[4px] text-right font-mono font-semibold">{money(o.total)}</td>
                  </tr>
                ))}
                <tr style={{ color: "var(--pr-primary)" }}>
                  <td className="py-[5px] pr-2 text-[9px] font-bold uppercase tracking-wide" colSpan={3}>With insurers</td>
                  <td className="py-[5px] text-right font-mono font-bold">{money(d.insuranceTotal ?? 0)}</td>
                </tr>
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
