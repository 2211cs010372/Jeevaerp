"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pill, statusTone } from "@/components/portal/ui/primitives";
import PortalDatePicker from "@/components/portal/ui/datepicker";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import {
  ErrorNote, Flash, GhostButton, Modal, PROC_CSS, PageHead, StatStrip, fld,
} from "@/components/portal/pharmacy/procurement-ui";
import { EditBillDialog } from "@/components/portal/billing/edit-bill-dialog";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import { bedLabel } from "@/lib/beds";

/**
 * THE PHARMACY'S BILL BOOK.
 *
 * The counter raises bills all day and could only ever look at the unpaid ones -
 * a settled sale disappeared off every pharmacy screen the moment it was paid
 * for. Every question that starts "the patient is back with yesterday's strip"
 * needed somebody at reception to look it up and read the receipt number down
 * the phone.
 *
 * This is that screen, narrowed to this counter. The narrowing is enforced by
 * the API route rather than by a filter here: `/pharmacy/billing` pins
 * source=PHARMACY server-side, so a pharmacist is never one edited URL away from
 * voiding an OP consultation receipt.
 */

interface Inv {
  id: string; receiptNo: string; source: string; status: string;
  totalAmount: string; amountPaid: string; createdAt: string;
  /** The corrected date this bill prints, when somebody has set one. */
  billDate: string | null;
  /** Money already handed back. */
  refunded: string;
  /** The ceiling - the counter never has to work it out. */
  refundable: string;
  /** Distinct payment types on this bill: [] unpaid, ["CASH"], ["CASH","UPI"] (split). */
  paymentModes: string[];
  /** SELF_PAY or INSURANCE. On a cashless bill the modes are empty because
   *  nobody paid a counter - which is not the same as "not paid yet". */
  payer: string;
  payerName: string | null;
  patient: { displayId: string; fullName: string };
}

/** One admitted patient, every open pharmacy bill of theirs rolled together. */
interface IpdDue {
  patient: { id: string; displayId: string; fullName: string; phone: string | null };
  ipNumber: string | null; ward: string | null; bedNo: string | null;
  stillAdmitted: boolean;
  bills: { invoiceId: string; receiptNo: string; due: string; createdAt: string; summary: string }[];
  billCount: number; due: string; oldestAt: string;
  /** What the insurer agreed to take off these bills. > 0 means the amount owed
   *  is the family's SHARE after a claim, not the whole bill. */
  insuranceCovered?: string;
  insurerName?: string | null;
}

const MODES = ["CASH", "UPI", "CARD"] as const;
const MODE_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", NETBANKING: "Net banking", OTHER: "Other" };
const payLabel = (modes: string[]) => modes.map((m) => MODE_LABEL[m] ?? m).join(" + ");
const money = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "12 Aug" for this year, "12 Aug 25" for anything older. The year is dropped
 * where it is today's - four characters of noise on every row of a list that is
 * mostly this week - and shown where it is not, because a bill from last August
 * must not read as a bill from last week.
 */
const billDay = (iso: string) => {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", ...(sameYear ? {} : { year: "2-digit" }),
  });
};
const due = (i: Inv) => Math.max(0, Number(i.totalAmount) - Number(i.amountPaid));
/**
 * Is the balance on this bill money somebody at this counter collects?
 *
 * A cashless bill carries an open balance for its entire life - that is not a
 * debt, it is a claim, and it is settled by the insurer paying the hospital. One
 * predicate, so the tab, the count and the shift's "still owed" figure can never
 * disagree about which bills are chaseable.
 */
const isCollectable = (i: Inv) => i.payer !== "INSURANCE" && i.status !== "CANCELLED";
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

type Tab = "TODAY" | "DUE" | "INSURER" | "ALL" | "DATE";

export default function PharmacyBillsPage() {
  const [invs, setInvs] = useState<Inv[]>([]);
  const [ipdDues, setIpdDues] = useState<IpdDue[]>([]);
  const [tab, setTab] = useState<Tab>("TODAY");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The day the counter asked for. Empty until they pick one - see the DATE tab. */
  const [onDate, setOnDate] = useState("");

  /**
   * ── THE SHIFT'S OWN FIGURES, WHICH ARE NOT THE LIST'S FIGURES ──
   *
   * The strip at the top of this screen says "Collected today" and "Still owed
   * today", and it is drawn whatever tab the desk is on. It used to read those
   * off `invs` - the list below it - and that is only the same thing while the
   * list is the working queue.
   *
   * The moment the day filter narrows `invs` to some Tuesday last month, none
   * of those bills is today's, so the strip totalled nothing: a desk that
   * looked up an old receipt watched the shift's takings drop to ₹0 across 0
   * bills. Nothing on the page said the number had changed meaning; it simply
   * read zero, which on a till summary is a heart-stopping thing to read.
   *
   * So the un-dated fetch is kept here, separately, and the strip is computed
   * off THAT. The screen always loads un-dated first - `onDate` starts empty -
   * so this is populated before any day can be picked, and a dated fetch leaves
   * it alone rather than overwriting it with somebody else's Tuesday.
   */
  const [queue, setQueue] = useState<Inv[]>([]);

  // ── COLLECT against one bill ──
  const [pay, setPay] = useState<Inv | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [payMode, setPayMode] = useState<(typeof MODES)[number]>("CASH");
  const [payRef, setPayRef] = useState("");

  // ── SETTLE a ward patient's whole pharmacy debt in one payment ──
  const [settle, setSettle] = useState<IpdDue | null>(null);
  const [settleAmt, setSettleAmt] = useState("");
  const [settleMode, setSettleMode] = useState<(typeof MODES)[number]>("CASH");
  const [settleRef, setSettleRef] = useState("");

  const [voiding, setVoiding] = useState<Inv | null>(null);
  const [voidReason, setVoidReason] = useState("");

  /**
   * A bill open for correction.
   *
   * PHARMACIST is not one of the roles HospitalConfig.billEditingEnabled gates
   * (that switch covers reception and the insurance desk), so there is no
   * useBillEditing() check here - the same arrangement the dues screen and the
   * lab counter have.
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── REFUND ── the only thing on this screen that takes cash OUT of the till.
  const [refunding, setRefunding] = useState<Inv | null>(null);
  const [refAmt, setRefAmt] = useState("");
  const [refMode, setRefMode] = useState<"CASH" | "UPI" | "CARD" | "NETBANKING">("CASH");
  const [refReason, setRefReason] = useState("");

  /**
   * `onDate` is a real dependency, not decoration. The day filter is a QUERY -
   * the list is capped at the most recent hundred bills, so any day further back
   * than that comes back empty when it is filtered client-side - which means
   * picking a day has to re-fetch, and that only happens if `load` changes when
   * the day does.
   */
  /**
   * How wide a window to ask the server for - a boolean rather than `tab`, so
   * moving between Today, Balance due and With insurer (all of which filter the
   * list already in hand) does not re-query. Only "All bills" needs more.
   */
  const wide = tab === "ALL";

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [r, d] = await Promise.all([
        api.get<{ invoices: Inv[] }>(
          onDate ? `/pharmacy/billing?date=${onDate}`
            // "All bills" asks for the wide window; every other tab filters the
            // working queue this already holds. See `wide` above.
            : wide ? "/pharmacy/billing?limit=500"
            : "/pharmacy/billing"),
        api.get<{ ipdByPatient: IpdDue[] }>("/pharmacy/dues"),
      ]);
      setInvs(r.invoices);
      if (!onDate) setQueue(r.invoices);
      setIpdDues(d.ipdByPatient);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Couldn't load the bills.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [onDate, wide]);
  useEffect(() => { load(); }, [load]);

  /**
   * Reception settles ward pharmacy bills at the front desk, so a due this
   * counter is looking at can be cleared by somebody else mid-shift. Refreshing
   * quietly keeps the figures honest without blanking the screen.
   *
   * Suspended while any money dialog is open: reloading the list under somebody
   * who is counting cash is worse than being a few seconds stale, and it is how
   * a half-typed correction disappears.
   *
   * PRESCRIPTION_DISPENSED is in the list because a WALK-IN sale does not raise
   * INVOICE_RAISED - only a ward dispense does (see dispenseMedicines). Without
   * it, a bill rung up at the second till would sit invisible on this one until
   * somebody reloaded the page, which is precisely the gap this screen exists to
   * close.
   */
  useLive([TOPICS.PHARMACY], () => load(true), {
    events: [EVENTS.INVOICE_RAISED, EVENTS.PAYMENT_TAKEN, EVENTS.PRESCRIPTION_DISPENSED],
    enabled: !editingId && !pay && !settle && !voiding && !refunding,
  });

  const filtered = useMemo(() => {
    let rows = invs;
    if (tab === "TODAY") rows = rows.filter((i) => isToday(i.createdAt));
    // "Balance due" means money somebody at this counter has to go and collect.
    // A cashless bill has an open balance for its whole life and nobody is ever
    // asked for it - listing it here would send the counter after families who
    // owe nothing. They get their own tab instead, so they stay findable.
    if (tab === "DUE") rows = rows.filter((i) => isCollectable(i) && due(i) > 0);
    if (tab === "INSURER") rows = rows.filter((i) => i.payer === "INSURANCE" && i.status !== "CANCELLED");
    // On the date tab the SERVER has already narrowed to the chosen day, so
    // there is nothing left to filter - but until a day is picked the list is
    // still the ordinary working queue, and showing that under a heading that
    // says "by date" would be a hundred bills answering a question nobody asked.
    if (tab === "DATE" && !onDate) rows = [];
    const s = q.trim().toLowerCase();
    if (s) rows = rows.filter((i) =>
      i.receiptNo.toLowerCase().includes(s) ||
      i.patient.fullName.toLowerCase().includes(s) ||
      i.patient.displayId.toLowerCase().includes(s));
    return rows;
  }, [invs, tab, q, onDate]);

  /** What the counter hands over at end of shift. Today's live money only. */
  const till = useMemo(() => {
    const today = queue.filter((i) => isToday(i.createdAt) && i.status !== "CANCELLED");
    return {
      collected: today.reduce((s, i) => s + Number(i.amountPaid), 0),
      // Same rule as the DUE tab: what is owed AT THIS COUNTER. A cashless bill
      // raised today is not part of what the shift has to collect.
      outstanding: today.filter(isCollectable).reduce((s, i) => s + due(i), 0),
      bills: today.length,
      /**
       * How many bills in the working queue still carry a balance.
       *
       * The sub-line under "Still owed today", and it counts the QUEUE rather
       * than today alone - which is what it has always meant: the figure is the
       * shift's, the count is everything the desk still has to chase. It used
       * to read `counts.DUE`, which is a tab badge and therefore describes
       * whatever list is on screen - so once the day filter started working,
       * this line began describing some Tuesday last month underneath a figure
       * describing today. Two numbers on one card, counting two different days,
       * with nothing to say so.
       */
      dueBills: queue.filter((i) => isCollectable(i) && due(i) > 0).length,
      withInsurer: today.filter((i) => i.payer === "INSURANCE").reduce((s, i) => s + due(i), 0),
    };
  }, [queue]);

  const counts = useMemo(() => ({
    TODAY: invs.filter((i) => isToday(i.createdAt)).length,
    DUE: invs.filter((i) => isCollectable(i) && due(i) > 0).length,
    INSURER: invs.filter((i) => i.payer === "INSURANCE" && i.status !== "CANCELLED").length,
    ALL: invs.length,
    DATE: onDate ? invs.length : 0,
  }), [invs, onDate]);

  const wardTotal = useMemo(() => ipdDues.reduce((s, p) => s + Number(p.due), 0), [ipdDues]);

  async function collect() {
    if (!pay) return;
    const amt = Number(payAmt);
    if (!amt || amt <= 0) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/billing/payment", {
        invoiceId: pay.id, mode: payMode, amount: amt,
        reference: payRef.trim() || undefined,
      });
      setFlash(`₹${money(amt)} collected against ${pay.receiptNo}.`);
      setPay(null); setPayAmt(""); setPayRef(""); setPayMode("CASH");
      await load(true);
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not record the payment."); }
    finally { setBusy(false); }
  }

  /**
   * Take the whole debt in one payment - `settleDues` spreads it across the
   * patient's open bills oldest-first, so each invoice stays its own document.
   *
   * `source: "PHARMACY"` is what keeps this counter out of the lab's money. The
   * endpoint is shared with reception, which deliberately omits the source
   * because the front desk settles every counter at once; here it must not.
   */
  async function doSettle() {
    if (!settle) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/billing/settle-dues", {
        patientId: settle.patient.id,
        source: "PHARMACY",
        payments: [{ mode: settleMode, amount: Number(settleAmt), reference: settleRef.trim() || undefined }],
      });
      setFlash(`₹${money(settleAmt)} collected from ${settle.patient.fullName}.`);
      setSettle(null); setSettleAmt(""); setSettleRef(""); setSettleMode("CASH");
      await load(true);
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not record the payment."); }
    finally { setBusy(false); }
  }

  async function voidBill() {
    if (!voiding || voidReason.trim().length < 3) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/billing/invoice/${voiding.id}/cancel`, { reason: voidReason.trim() });
      setFlash(`${voiding.receiptNo} voided.`);
      setVoiding(null); setVoidReason("");
      await load(true);
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not void the bill."); }
    finally { setBusy(false); }
  }

  async function doRefund() {
    if (!refunding) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/pharmacy/invoices/${refunding.id}/refund`, {
        amount: Number(refAmt),
        mode: refMode,
        reason: refReason.trim(),
      });
      setFlash(`₹${money(refAmt)} returned on ${refunding.receiptNo}.`);
      setRefunding(null); setRefAmt(""); setRefReason("");
      await load(true);
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not refund."); }
    finally { setBusy(false); }
  }

  const TABS: { k: Tab; label: string }[] = [
    { k: "TODAY", label: "Today" }, { k: "DUE", label: "Balance due" },
    { k: "INSURER", label: "With insurer" }, { k: "ALL", label: "All bills" },
    { k: "DATE", label: "By date" },
  ];

  return (
    <PortalScroll>
      <style>{PROC_CSS}</style>

      <PageHead
        title="Bills"
        blurb="Every bill this counter has raised — settle a balance, reprint a receipt, correct or void a wrong one. Only pharmacy bills appear here; consultation and lab receipts are settled at the desks that raised them."
      />

      <StatStrip items={[
        {
          label: "Collected today", value: `₹${money(till.collected)}`,
          sub: `across ${till.bills} bill${till.bills === 1 ? "" : "s"} · voided excluded`,
        },
        {
          label: "Still owed today", value: `₹${money(till.outstanding)}`,
          tone: till.outstanding > 0 ? "warn" : undefined,
          sub: till.dueBills > 0
            ? `${till.dueBills} bill${till.dueBills === 1 ? "" : "s"} with a balance`
            : "everything settled",
        },
        {
          label: "On the ward", value: `₹${money(wardTotal)}`,
          tone: wardTotal > 0 ? "warn" : undefined,
          sub: `${ipdDues.length} patient${ipdDues.length === 1 ? "" : "s"} waiting on discharge`,
        },
        {
          label: "With insurers", value: `₹${money(till.withInsurer)}`,
          sub: "raised today, not the counter's to collect",
        },
      ]} />

      {/* ── WARD DUES, ONE ROW PER PATIENT ──
          A ward patient is dispensed to several times over a stay and each
          dispense is its own invoice. Listed one per bill in the queue below,
          bed 12 is four separate rows - so the counter settles the one the
          family asked about and the other three are found when the discharge is
          refused. The row is the person; the figure is everything they owe. */}
      {ipdDues.length > 0 && (
        <section data-rise className="surface mb-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-6 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[#8a6414]">
                <Icon name="alert" size={15} /> On the ward
              </h2>
              <p className="mt-0.5 text-[12px] text-[#8a6414]">
                Medicine that left this counter unpaid. A discharge is refused until it is settled.
              </p>
            </div>
            <div className="num text-[15px] font-bold text-[#8a6414]">₹{money(wardTotal)}</div>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {ipdDues.map((p) => (
              <div key={p.patient.id} className="prow flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-[var(--p-ink)]">{p.patient.fullName}</span>
                    <span className="num text-[11.5px] text-[var(--p-muted)]">{p.patient.displayId}</span>
                    {p.ipNumber && <span className="num text-[11.5px] font-semibold text-[var(--p-blue-deep)]">{p.ipNumber}</span>}
                    {!p.stillAdmitted && (
                      <span className="rounded-full bg-[var(--p-rose-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-rose)]">
                        Discharged — unpaid
                      </span>
                    )}
                    {/* WHY A CASHLESS PATIENT OWES ANYTHING. Without this the
                        counter is asking a family who was promised cashless for
                        ₹20,000 with nothing on screen to explain it, and that is
                        an argument the pharmacist cannot win. */}
                    {Number(p.insuranceCovered ?? 0) > 0 && (
                      <span
                        title={`${p.insurerName ?? "The insurer"} covered ₹${money(p.insuranceCovered!)} of these bills. What is shown is the patient's share.`}
                        className="rounded-full bg-[var(--p-blue-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-blue-deep)]">
                        after {p.insurerName ?? "insurance"}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--p-muted)]">
                    {p.ward && <>{bedLabel(p.ward, p.bedNo)} · </>}
                    {p.billCount} bill{p.billCount === 1 ? "" : "s"} · oldest {billDay(p.oldestAt)}
                  </div>
                  {/* The bills stay visible - somebody always asks what it is for. */}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--p-muted)]">
                    {p.bills.map((b) => (
                      <Link key={b.invoiceId} href={`/print/invoice/${b.invoiceId}`} target="_blank" rel="noopener noreferrer"
                        className="hover:text-[var(--p-blue)] hover:underline">
                        <span className="num">{b.receiptNo}</span> ₹{money(b.due)}
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <div className="text-right">
                    <div className="num text-[17px] font-bold text-[var(--p-amber)]">₹{money(p.due)}</div>
                    <div className="text-[11px] text-[var(--p-muted)]">total owed</div>
                  </div>
                  {/* ONE BUTTON, THE WHOLE DEBT. The family hands over one
                      amount; the allocation across their open bills happens in
                      settleDues. A button per bill is what left three of four
                      unsettled. */}
                  <button onClick={() => { setSettle(p); setSettleAmt(p.due); setSettleMode("CASH"); setSettleRef(""); }}
                    className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white">
                    <Icon name="rupee" size={14} /> Collect ₹{money(p.due)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div data-rise className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`seg ${tab === t.k ? "seg-on" : ""} ${t.k === "DUE" && counts.DUE > 0 && tab !== t.k ? "seg-warn" : ""}`}>
            {t.label}
            <span className="seg-n">{counts[t.k]}</span>
          </button>
        ))}
        {/* Shown only on its own tab. A date box sitting beside "Today" the rest
            of the time reads as a second, contradictory filter - and the counter
            cannot tell which of the two the list is obeying. */}
        {tab === "DATE" && (
          <div className="flex items-center gap-2">
            <PortalDatePicker value={onDate} onChange={setOnDate} accent="blue" placeholder="Pick a day" />
            {onDate && <GhostButton onClick={() => setOnDate("")}>Clear</GhostButton>}
          </div>
        )}
        <div className="surface ml-auto flex min-w-[240px] items-center gap-2 px-3.5 py-2">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Receipt or patient…"
            className="w-full bg-transparent text-sm outline-none" />
          {loading && <Spinner size={13} />}
        </div>
      </div>

      {flash && <Flash text={flash} onClose={() => setFlash(null)} />}
      {err && <ErrorNote text={err} />}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-[14px] text-[var(--p-muted)]">
            {tab === "DUE" ? "Nothing outstanding — every bill this counter raised is settled."
              : tab === "INSURER" ? "No cashless bills on this counter."
              : tab === "DATE" && !onDate ? "Pick a day to see the bills raised on it."
              : tab === "DATE" ? "No bills were raised on that day."
              : q.trim() ? "Nothing matches that."
              : "No bills here."}
          </p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {filtered.map((i, n) => {
              const bal = due(i);
              const voided = i.status === "CANCELLED";
              return (
                <div key={i.id} style={{ "--d": `${Math.min(n, 12) * 18}ms` } as React.CSSProperties}
                  className={`prow flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 ${voided ? "opacity-55" : ""}`}>
                  <div className="min-w-[190px] flex-1">
                    <div className="doc">{i.receiptNo}</div>
                    <div className="truncate text-[13px] text-[var(--p-muted)]">
                      {i.patient.fullName} · <span className="num">{i.patient.displayId}</span>
                    </div>
                  </div>

                  {/* THE BILL'S DATE, on every row.
                      The date SHOWN is the one that prints - a corrected billDate
                      where there is one - so the counter reads the same date the
                      patient is holding. Where the two differ, the day it was
                      actually raised is kept in the tooltip and marked, because
                      "why is a bill from the 12th in today's list" needs an
                      answer that is one hover away rather than a mystery. */}
                  <div className="w-[104px] shrink-0 text-right">
                    <div className="text-[13px] font-medium text-[var(--p-ink)]"
                      title={i.billDate
                        ? `Prints as ${billDay(i.billDate)} · actually raised ${billDay(i.createdAt)}`
                        : `Raised ${billDay(i.createdAt)}`}>
                      {billDay(i.billDate ?? i.createdAt)}
                    </div>
                    <div className="text-[11px] text-[var(--p-muted)]">{i.billDate ? "re-dated" : "bill date"}</div>
                  </div>

                  <div className="w-[92px] text-right">
                    <div className="num text-[14px] font-semibold text-[var(--p-ink)]">₹{money(i.totalAmount)}</div>
                    <div className="text-[11px] text-[var(--p-muted)]">total</div>
                  </div>
                  {/* An unpaid balance on a cashless bill is with the insurer, not
                      with the family. Printing it in the same red as a real debt
                      sends the counter to chase somebody who owes nothing. */}
                  <div className="w-[92px] text-right">
                    <div className={`num text-[14px] font-semibold ${
                      bal > 0 && !voided && i.payer !== "INSURANCE" ? "text-[var(--p-rose)]" : "text-[var(--p-muted)]"}`}>
                      ₹{money(bal)}
                    </div>
                    <div className="text-[11px] text-[var(--p-muted)]">
                      {i.payer === "INSURANCE" && bal > 0 && !voided ? "with insurer" : "due"}
                    </div>
                  </div>

                  <Pill tone={statusTone(
                    i.status === "REFUNDED" ? "Cancelled" : voided ? "Cancelled" : bal > 0 ? "Pending" : "Paid"
                  )}>
                    {i.status === "REFUNDED" ? "Refunded" : voided ? "Voided" : bal > 0 ? "Part paid" : "Paid"}
                  </Pill>

                  {/* HOW IT SETTLES - one chip, always answering the same question.
                      For a counter bill that is the tender: Cash, UPI, or both on
                      a split. For a cashless bill the answer is the insurer, and
                      it takes the same slot rather than leaving a gap that reads
                      as "nobody has paid this yet". */}
                  {i.payer === "INSURANCE" ? (
                    <span title={i.payerName ? `Billed to ${i.payerName}` : "Billed to an insurer"}
                      className="rounded bg-[var(--p-blue-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--p-blue-deep)]">
                      Insurance{i.payerName ? ` · ${i.payerName}` : ""}
                    </span>
                  ) : i.paymentModes.length > 0 ? (
                    <span title={i.paymentModes.length > 1 ? "Split payment" : "Payment type"}
                      className={`rounded px-2 py-1 text-[11px] font-semibold ${
                        i.paymentModes.length > 1
                          ? "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"
                          : "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]"}`}>
                      {payLabel(i.paymentModes)}
                    </span>
                  ) : null}

                  {Number(i.refunded) > 0 && i.status !== "REFUNDED" && (
                    <span className="num rounded bg-[var(--p-amber-soft)] px-2 py-1 text-[11px] font-semibold text-[#8a6414]">
                      −₹{money(i.refunded)} back
                    </span>
                  )}

                  <div className="flex items-center gap-2">
                    {/* Refund is only offered when there is money to give back.
                        A voided bill is the COMMON case - you void the sale,
                        then you return the cash. */}
                    {Number(i.refundable) > 0 && (
                      <button onClick={() => { setRefunding(i); setRefAmt(i.refundable); setRefMode("CASH"); setRefReason(""); }}
                        title={`Up to ₹${money(i.refundable)} can be returned`}
                        className="rounded-lg border border-[var(--p-rose)]/40 px-3 py-1.5 text-[13px] font-semibold text-[var(--p-rose)] transition-colors hover:bg-[var(--p-rose-soft)]">
                        Refund
                      </button>
                    )}
                    {!voided && bal > 0 && (
                      <button onClick={() => { setPay(i); setPayAmt(String(bal)); setPayMode("CASH"); setPayRef(""); }}
                        className="btn-primary rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white">
                        Collect ₹{money(bal)}
                      </button>
                    )}
                    <Link href={`/print/invoice/${i.id}`} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--p-blue)] transition-colors hover:border-[var(--p-blue)]">
                      Print
                    </Link>
                    {/* EDIT is offered on a PAID bill too, not only an unpaid one.
                        The server holds the limits that still apply - it refuses
                        a cancelled bill, a bill registered under an IRN, and any
                        correction that would drop the total below the money
                        already collected. A voided bill is excluded here as well:
                        that one is obvious from the row, and offering it would
                        only produce an error somebody has to read. */}
                    {!voided && (
                      <button onClick={() => setEditingId(i.id)}
                        title={Number(i.amountPaid) > 0
                          ? `Correct this bill — ₹${money(i.amountPaid)} already collected`
                          : "Correct the lines, date or amount on this bill"}
                        className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--p-blue)] transition-colors hover:border-[var(--p-blue)]">
                        Edit
                      </button>
                    )}
                    {!voided && (
                      <button onClick={() => { setVoiding(i); setVoidReason(""); }}
                        className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--p-muted)] transition-colors hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
                        Void
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─────────── COLLECT AGAINST ONE BILL ─────────── */}
      {pay && (
        <Modal
          title="Collect payment"
          sub={`${pay.patient.fullName} · ${pay.receiptNo} · ₹${money(due(pay))} outstanding`}
          busy={busy}
          onClose={() => setPay(null)}
          footer={
            <>
              <GhostButton onClick={() => setPay(null)} disabled={busy}>Cancel</GhostButton>
              <button onClick={collect} disabled={busy || !payAmt || Number(payAmt) <= 0}
                className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                {busy ? <><Spinner /> Recording…</> : <><Icon name="check" size={15} /> Record ₹{payAmt || 0}</>}
              </button>
            </>
          }
        >
          <div className="space-y-4 p-6">
            <Field label="Amount (₹)" required>
              <input className={fld} value={payAmt} inputMode="decimal" autoFocus
                onChange={(e) => setPayAmt(e.target.value.replace(/[^\d.]/g, ""))} />
            </Field>
            <Field label="Paid by">
              <div className="flex gap-2">
                {MODES.map((m) => (
                  <button key={m} onClick={() => setPayMode(m)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-[14px] font-medium transition-colors ${
                      payMode === m ? "border-[var(--p-blue)] bg-[var(--p-blue)] text-white"
                        : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-blue)]"}`}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            {payMode !== "CASH" && (
              <Field label="Reference (UPI / card ref)">
                <input className={fld} value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Optional" />
              </Field>
            )}
            {Number(payAmt) > due(pay) && (
              <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[12px] text-[#8a6414]">
                That&apos;s more than the ₹{money(due(pay))} outstanding. Check before you take the money.
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* ─────────── SETTLE A PATIENT'S WHOLE PHARMACY DEBT ───────────
          One amount, allocated across their open bills oldest-first by
          settleDues. Paying less than the total is allowed and clears the oldest
          bills outright rather than leaving every one of them part-paid, which is
          the state nobody can reconcile later. */}
      {settle && (
        <Modal
          title={`Collect ₹${money(settle.due)}`}
          sub={`${settle.patient.fullName}${settle.ipNumber ? ` · ${settle.ipNumber}` : ""} · ${settle.billCount} bill${settle.billCount === 1 ? "" : "s"}`}
          busy={busy}
          onClose={() => setSettle(null)}
          footer={
            <>
              <GhostButton onClick={() => setSettle(null)} disabled={busy}>Cancel</GhostButton>
              <button onClick={doSettle}
                disabled={busy || !settleAmt || Number(settleAmt) <= 0 || Number(settleAmt) > Number(settle.due)}
                className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                {busy ? <><Spinner /> Recording…</> : <><Icon name="check" size={15} /> Record ₹{settleAmt || 0}</>}
              </button>
            </>
          }
        >
          <div className="space-y-4 p-6">
            <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3 text-[12.5px] text-[var(--p-muted)]">
              {settle.bills.map((b) => (
                <div key={b.invoiceId} className="flex justify-between gap-3 py-0.5">
                  <span className="min-w-0 truncate"><span className="num">{b.receiptNo}</span> · {b.summary}</span>
                  <span className="num shrink-0 text-[var(--p-ink)]">₹{money(b.due)}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-[var(--p-border)] pt-1 font-semibold">
                <span className="text-[var(--p-ink)]">Total due</span>
                <span className="num text-[var(--p-amber)]">₹{money(settle.due)}</span>
              </div>
              <p className="mt-2 leading-relaxed">Paying less than the total settles the oldest bills first.</p>
            </div>
            <Field label="Amount (₹)" required>
              <input className={fld} value={settleAmt} inputMode="decimal" autoFocus
                onChange={(e) => setSettleAmt(e.target.value.replace(/[^\d.]/g, ""))} />
            </Field>
            <Field label="Paid by">
              <div className="flex gap-2">
                {MODES.map((m) => (
                  <button key={m} onClick={() => setSettleMode(m)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-[14px] font-medium transition-colors ${
                      settleMode === m ? "border-[var(--p-blue)] bg-[var(--p-blue)] text-white"
                        : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-blue)]"}`}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            {settleMode !== "CASH" && (
              <Field label="Reference (UPI / card ref)">
                <input className={fld} value={settleRef} onChange={(e) => setSettleRef(e.target.value)} placeholder="Optional" />
              </Field>
            )}
            {Number(settleAmt) > Number(settle.due) && (
              <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[12px] text-[#8a6414]">
                That&apos;s more than the ₹{money(settle.due)} outstanding.
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* ─────────── REFUND ───────────
          The only screen at this counter that takes cash OUT. The ceiling is
          shown, not merely enforced: a pharmacist who can SEE that only ₹500 was
          ever collected will not try to hand back ₹5,000. */}
      {refunding && (
        <Modal
          title="Give money back"
          sub={`${refunding.receiptNo} · ${refunding.patient.fullName}`}
          busy={busy}
          onClose={() => setRefunding(null)}
          footer={
            <>
              <GhostButton onClick={() => setRefunding(null)} disabled={busy}>Cancel</GhostButton>
              <button onClick={doRefund}
                disabled={busy || !(Number(refAmt) > 0) || Number(refAmt) > Number(refunding.refundable) || refReason.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? <><Spinner /> Returning…</> : <>Return ₹{money(refAmt || 0)}</>}
              </button>
            </>
          }
        >
          <div className="space-y-4 p-6">
            <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--p-muted)]">Collected on this bill</span>
                <span className="num font-semibold text-[var(--p-ink)]">₹{money(refunding.refundable)}</span>
              </div>
              {Number(refunding.refunded) > 0 && (
                <div className="mt-1 flex items-center justify-between text-[12px]">
                  <span className="text-[var(--p-muted)]">Already returned</span>
                  <span className="num text-[var(--p-amber)]">−₹{money(refunding.refunded)}</span>
                </div>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--p-muted)]">
                You cannot return more than was actually collected. Not from a voided bill, not from a typo.
              </p>
            </div>

            <Field label="Amount to return" required>
              <div className="flex gap-2">
                <input className={fld} value={refAmt} inputMode="decimal" autoFocus
                  onChange={(e) => setRefAmt(e.target.value.replace(/[^\d.]/g, ""))} />
                <button onClick={() => setRefAmt(refunding.refundable)}
                  className="shrink-0 rounded-lg border border-[var(--p-border)] px-3 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)]">
                  All
                </button>
              </div>
              {Number(refAmt) > Number(refunding.refundable) && (
                <p className="mt-1 text-[12px] font-semibold text-[var(--p-rose)]">
                  That&apos;s more than was ever collected (₹{money(refunding.refundable)}).
                </p>
              )}
            </Field>

            <Field label="How is it going back?">
              <div className="flex flex-wrap gap-2">
                {(["CASH", "UPI", "CARD", "NETBANKING"] as const).map((m) => (
                  <button key={m} onClick={() => setRefMode(m)}
                    className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                      refMode === m ? "border-[var(--p-rose)] bg-[var(--p-rose)] text-white"
                        : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-rose)]"}`}>
                    {m}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--p-muted)]">
                A UPI refund does not come out of the cash drawer - the day-close depends on this being right.
              </p>
            </Field>

            <Field label="Why? (goes on the record)" required>
              <input className={fld} value={refReason} onChange={(e) => setRefReason(e.target.value)}
                placeholder="Medicine returned · billed wrong · strip damaged" />
            </Field>
          </div>
        </Modal>
      )}

      {/* ─────────── VOID ─────────── */}
      {voiding && (
        <Modal
          title="Void this bill?"
          sub={`${voiding.receiptNo} · ₹${money(voiding.totalAmount)} · ${voiding.patient.fullName}`}
          busy={busy}
          onClose={() => setVoiding(null)}
          footer={
            <>
              <GhostButton onClick={() => setVoiding(null)} disabled={busy}>Keep it</GhostButton>
              <button onClick={voidBill} disabled={busy || voidReason.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? <><Spinner /> Voiding…</> : "Void bill"}
              </button>
            </>
          }
        >
          <div className="space-y-3 p-6">
            <Field label="Why?" required>
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus
                placeholder="Billed the wrong patient / duplicate…" className={fld} />
            </Field>
            <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[12px] leading-relaxed text-[#8a6414]">
              The bill is marked <b>cancelled</b>, not deleted - the receipt number stays used, which is what GST expects.
              {Number(voiding.amountPaid) > 0 && <> This bill already took <b>₹{money(voiding.amountPaid)}</b>; voiding it does <b>not</b> hand the cash back — use <b>Refund</b> for that.</>}
              {" "}It does not put the strips back on the shelf either; that is a stock return.
            </p>
          </div>
        </Modal>
      )}

      {/* EDIT - the same dialog reception, the lab and admin correct a bill with,
          so a correction means the same thing whichever counter made it. */}
      {editingId && (
        <EditBillDialog
          invoiceId={editingId}
          accent="blue"
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load(true); }}
        />
      )}
    </PortalScroll>
  );
}
