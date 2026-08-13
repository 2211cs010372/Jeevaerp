"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pill, statusTone } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import { EditBillDialog, useBillEditing } from "@/components/portal/billing/edit-bill-dialog";

interface Inv {
  id: string; receiptNo: string; source: string; status: string;
  totalAmount: string; amountPaid: string; createdAt: string;
  /** The corrected date this bill prints, when somebody has set one. */
  billDate: string | null;
  /** Money already handed back. */
  refunded: string;
  /** The ceiling - the desk never has to work it out. */
  refundable: string;
  /** Distinct payment types on this bill: [] unpaid, ["CASH"], ["CASH","UPI"] (split). */
  paymentModes: string[];
  /** SELF_PAY or INSURANCE. On an insurance bill the modes are empty because
   *  nobody paid a counter - which is not the same as "not paid yet". */
  payer: string;
  payerName: string | null;
  patient: { displayId: string; fullName: string };
}

/** One admitted patient, every open counter bill of theirs rolled together. */
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

const SOURCE: Record<string, string> = {
  CONSULTATION: "OP consult", LAB: "Lab", PHARMACY: "Pharmacy", IPD: "Inpatient", OTHER: "Other",
};
const MODES = ["CASH", "UPI", "CARD"] as const;
const MODE_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", NETBANKING: "Net banking", OTHER: "Other" };
const payLabel = (modes: string[]) => modes.map((m) => MODE_LABEL[m] ?? m).join(" + ");
const money = (v: string) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 });
/**
 * "12 Aug" for this year, "12 Aug 25" for anything older.
 *
 * The year is dropped where it is today's, because on a list that is mostly this
 * week it is four characters of noise on every row - and shown where it is not,
 * because a bill from last August must not read as a bill from last week.
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
 * Is the balance on this bill money somebody at this desk collects?
 *
 * A cashless bill carries an open balance for its entire life - that is not a
 * debt, it is a claim, and it is settled by the insurer paying the hospital. One
 * predicate so the tab, the count and the shift's "still owed" figure can never
 * disagree about which bills are chaseable.
 */
const isCollectable = (i: Inv) => i.payer !== "INSURANCE" && i.status !== "CANCELLED";
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

type Tab = "TODAY" | "DUE" | "INSURER" | "ALL";

export default function BillingPage() {
  const [invs, setInvs] = useState<Inv[]>([]);
  const [tab, setTab] = useState<Tab>("TODAY");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [pay, setPay] = useState<Inv | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [payMode, setPayMode] = useState<(typeof MODES)[number]>("CASH");
  const [payRef, setPayRef] = useState("");
  const [voiding, setVoiding] = useState<Inv | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // ── CORRECTING A BILL ──
  // Off unless an admin has switched it on for this hospital - see
  // HospitalConfig.billEditingEnabled. The switch is enforced server-side; this
  // only decides whether the button is drawn.
  const { canEdit } = useBillEditing();
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── REFUND ── the only screen in the ERP that takes cash OUT of the hospital.
  const [refunding, setRefunding] = useState<Inv | null>(null);
  const [refAmt, setRefAmt] = useState("");
  const [refMode, setRefMode] = useState<"CASH" | "UPI" | "CARD" | "NETBANKING">("CASH");
  const [refReason, setRefReason] = useState("");
  const [refBusy, setRefBusy] = useState(false);

  async function doRefund() {
    if (!refunding) return;
    setRefBusy(true); setErr(null);
    try {
      await api.post(`/reception/invoices/${refunding.id}/refund`, {
        amount: Number(refAmt),
        mode: refMode,
        reason: refReason.trim(),
      });
      setRefunding(null); setRefAmt(""); setRefReason("");
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Could not refund.");
    } finally { setRefBusy(false); }
  }
  const [busy, setBusy] = useState(false);

  /** Inpatient dues, already grouped per patient by the service. */
  const [ipdDues, setIpdDues] = useState<IpdDue[]>([]);
  const [settle, setSettle] = useState<IpdDue | null>(null);
  const [settleAmt, setSettleAmt] = useState("");
  const [settleMode, setSettleMode] = useState<(typeof MODES)[number]>("CASH");
  const [settleRef, setSettleRef] = useState("");

  /** Take the whole debt in one payment - see settleDues for the allocation. */
  async function doSettle() {
    if (!settle) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/billing/settle-dues", {
        patientId: settle.patient.id,
        payments: [{ mode: settleMode, amount: Number(settleAmt), reference: settleRef.trim() || undefined }],
      });
      setFlash(`₹${money(settleAmt)} collected from ${settle.patient.fullName}.`);
      setSettle(null); setSettleAmt(""); setSettleRef(""); setSettleMode("CASH");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not record the payment."); }
    finally { setBusy(false); }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, d] = await Promise.all([
        api.get<{ invoices: Inv[] }>("/reception/billing"),
        api.get<{ ipdByPatient: IpdDue[] }>("/reception/dues"),
      ]);
      setInvs(r.invoices);
      setIpdDues(d.ipdByPatient);
    }
    catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't load bills."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Every till in the hospital raises bills against this list - the pharmacy
  // counter, the lab, the ward. Without this the desk chases a due that another
  // counter collected ten minutes ago.
  useLive([TOPICS.RECEPTION], load, {
    // Bills and payments only - a check-in does not change what is owed.
    events: [EVENTS.INVOICE_RAISED, EVENTS.PAYMENT_TAKEN],
    // Suspended while a bill is open for correction: reloading the list under an
    // open dialog is how a half-typed amendment disappears.
    enabled: !editingId,
  });

  const filtered = useMemo(() => {
    let rows = invs;
    if (tab === "TODAY") rows = rows.filter((i) => isToday(i.createdAt));
    // "Balance due" means money somebody at this desk has to go and collect. A
    // cashless bill has an open balance for its whole life and nobody is ever
    // asked for it - listing it here sent the desk after families who owe
    // nothing, which is the confusion the payer flag exists to prevent. They get
    // their own tab instead, so they are still findable.
    if (tab === "DUE") rows = rows.filter((i) => isCollectable(i) && due(i) > 0);
    if (tab === "INSURER") rows = rows.filter((i) => i.payer === "INSURANCE" && i.status !== "CANCELLED");
    const s = q.trim().toLowerCase();
    if (s) rows = rows.filter((i) =>
      i.receiptNo.toLowerCase().includes(s) ||
      i.patient.fullName.toLowerCase().includes(s) ||
      i.patient.displayId.toLowerCase().includes(s));
    return rows;
  }, [invs, tab, q]);

  /** What the desk hands over at end of shift. Counts only today's live money. */
  const till = useMemo(() => {
    const today = invs.filter((i) => isToday(i.createdAt) && i.status !== "CANCELLED");
    return {
      collected: today.reduce((s, i) => s + Number(i.amountPaid), 0),
      // Same rule as the DUE tab: what is owed AT THIS DESK. A cashless bill
      // raised today is not part of what the shift has to collect.
      outstanding: today.filter(isCollectable).reduce((s, i) => s + due(i), 0),
      bills: today.length,
      withInsurer: today.filter((i) => i.payer === "INSURANCE").reduce((s, i) => s + due(i), 0),
    };
  }, [invs]);

  const counts = useMemo(() => ({
    TODAY: invs.filter((i) => isToday(i.createdAt)).length,
    DUE: invs.filter((i) => isCollectable(i) && due(i) > 0).length,
    INSURER: invs.filter((i) => i.payer === "INSURANCE" && i.status !== "CANCELLED").length,
    ALL: invs.length,
  }), [invs]);

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
      setFlash(`₹${money(String(amt))} collected against ${pay.receiptNo}.`);
      setPay(null); setPayAmt(""); setPayRef(""); setPayMode("CASH");
      await load();
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
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not void the bill."); }
    finally { setBusy(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";
  const TABS: { k: Tab; label: string }[] = [
    { k: "TODAY", label: "Today" }, { k: "DUE", label: "Balance due" },
    { k: "INSURER", label: "With insurer" }, { k: "ALL", label: "All bills" },
  ];

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-5 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Billing</h1>
        <p className="mt-1 text-[14px] text-[var(--p-muted)]">
          Settle balances, reprint a receipt, void a wrong bill.
        </p>
      </div>

      {/* ── INPATIENT DUES, ONE ROW PER PATIENT ──
          A stay runs up bills at three counters and the family settles them on
          the way out, here, in ONE amount - the lab window takes no money at
          all. Listed one per invoice they were four rows deep in the list below,
          so the desk collected the one it was asked about and the rest were
          found when the discharge was refused. */}
      {ipdDues.length > 0 && (
        <section data-rise className="surface mb-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-6 py-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[#8a6414]">Inpatient dues</h2>
              <p className="mt-0.5 text-[12px] text-[#8a6414]">
                Pharmacy and lab bills for admitted patients. Collected here - a discharge is refused until they are.
              </p>
            </div>
            <div className="font-mono text-[15px] font-bold text-[#8a6414]">
              ₹{money(String(ipdDues.reduce((s, p) => s + Number(p.due), 0)))}
            </div>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {ipdDues.map((p) => (
              <div key={p.patient.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-[var(--p-ink)]">{p.patient.fullName}</span>
                    <span className="font-mono text-[11.5px] text-[var(--p-muted)]">{p.patient.displayId}</span>
                    {p.ipNumber && <span className="font-mono text-[11.5px] font-semibold text-[var(--p-teal-deep)]">{p.ipNumber}</span>}
                    {!p.stillAdmitted && (
                      <span className="rounded-full bg-[var(--p-rose-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-rose)]">Discharged — unpaid</span>
                    )}
                    {/* WHY A CASHLESS PATIENT OWES ANYTHING.
                        Without this the desk is asking a family who was
                        promised cashless for ₹20,000 with nothing on screen to
                        explain it, and the argument that follows is one the
                        receptionist cannot win. */}
                    {Number(p.insuranceCovered ?? 0) > 0 && (
                      <span title={`${p.insurerName ?? "The insurer"} covered ₹${money(p.insuranceCovered!)} of these bills. What is shown is the patient's share.`}
                        className="rounded-full bg-[var(--p-blue-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-blue-deep)]">
                        after {p.insurerName ?? "insurance"}
                      </span>
                    )}
                  </div>
                  {Number(p.insuranceCovered ?? 0) > 0 && (
                    <div className="mt-1 text-[11.5px] text-[var(--p-muted)]">
                      {p.insurerName ?? "Insurer"} covered ₹{money(p.insuranceCovered!)} — this is the patient&apos;s share.
                    </div>
                  )}
                  {/* The bills stay visible - somebody always asks what it is for. */}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--p-muted)]">
                    {p.bills.map((b) => (
                      <a key={b.invoiceId} href={`/print/invoice/${b.invoiceId}`} target="_blank" rel="noreferrer"
                        className="hover:text-[var(--p-teal)] hover:underline">
                        <span className="font-mono">{b.receiptNo}</span> ₹{money(b.due)}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <div className="text-right">
                    <div className="font-mono text-[17px] font-bold text-[var(--p-amber)]">₹{money(p.due)}</div>
                    <div className="text-[11px] text-[var(--p-muted)]">{p.billCount} bill{p.billCount === 1 ? "" : "s"}</div>
                  </div>
                  <button onClick={() => setSettle(p)}
                    className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white">
                    <Icon name="rupee" size={14} /> Collect ₹{money(p.due)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* the till - what you hand over at the end of the shift */}
      <div data-rise className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="surface px-5 py-4">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Collected today</div>
          <div className="mt-1 text-[24px] font-semibold text-[var(--p-ink)]">₹{money(String(till.collected))}</div>
          <div className="mt-0.5 text-[13px] text-[var(--p-muted)]">across {till.bills} bill{till.bills === 1 ? "" : "s"}</div>
        </div>
        <div className="surface px-5 py-4">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Still owed today</div>
          <div className={`mt-1 text-[24px] font-semibold ${till.outstanding > 0 ? "text-[var(--p-rose)]" : "text-[var(--p-ink)]"}`}>
            ₹{money(String(till.outstanding))}
          </div>
          <div className="mt-0.5 text-[13px] text-[var(--p-muted)]">
            {counts.DUE > 0 ? `${counts.DUE} bill${counts.DUE === 1 ? "" : "s"} with a balance` : "everything settled"}
            {till.withInsurer > 0 && (
              <> · <span className="text-[var(--p-blue-deep)]">₹{money(String(till.withInsurer))} with insurers</span></>
            )}
          </div>
        </div>
        <div className="surface flex items-center px-5 py-4">
          <p className="text-[13px] leading-relaxed text-[var(--p-muted)]">
            These are <b className="text-[var(--p-ink)]">today&apos;s live bills only</b> - voided ones are excluded, so this
            is what should physically be in the drawer.
          </p>
        </div>
      </div>

      <div data-rise className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[14px] font-medium transition-colors ${
              tab === t.k ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white"
                : "border-[var(--p-border)] bg-white text-[var(--p-text)] hover:border-[var(--p-teal)]"}`}>
            {t.label}
            <span className={`rounded px-1.5 py-0.5 font-mono text-[12px] font-bold ${
              tab === t.k ? "bg-white/20" : t.k === "DUE" && counts.DUE > 0 ? "bg-[var(--p-rose-soft)] text-[var(--p-rose)]" : "bg-[var(--p-bg)] text-[var(--p-muted)]"}`}>
              {counts[t.k]}
            </span>
          </button>
        ))}
        <div className="surface ml-auto flex min-w-[240px] items-center gap-2 px-3.5 py-2">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Receipt or patient…" className="w-full bg-transparent text-sm outline-none" />
          {loading && <Spinner size={13} />}
        </div>
      </div>

      {flash && (
        <div data-rise className="mb-4 flex items-center justify-between rounded-lg border border-[var(--p-teal)]/30 bg-[var(--p-teal-soft)] px-4 py-3 text-[14px] font-medium text-[var(--p-teal-deep)]">
          <span className="flex items-center gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button onClick={() => setFlash(null)}>✕</button>
        </div>
      )}
      {err && <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{err}</div>}

      <section data-rise className="surface overflow-hidden">
        {filtered.length === 0 && !loading ? (
          <p className="py-16 text-center text-[14px] text-[var(--p-muted)]">
            {tab === "DUE" ? "Nothing outstanding - every bill is settled." : "No bills here."}
          </p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {filtered.map((i) => {
              const bal = due(i);
              const voided = i.status === "CANCELLED";
              return (
                <div key={i.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-[var(--p-bg)] ${voided ? "opacity-55" : ""}`}>
                  <div className="min-w-[190px] flex-1">
                    <div className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">{i.receiptNo}</div>
                    <div className="truncate text-[13px] text-[var(--p-muted)]">
                      {i.patient.fullName} · <span className="font-mono">{i.patient.displayId}</span>
                    </div>
                  </div>

                  {/* THE BILL'S DATE, on every row.
                      The date SHOWN is the one that prints - a corrected billDate
                      where there is one - so the desk reads the same date the
                      patient is holding. Where the two differ, the day it was
                      actually raised is kept in the tooltip and marked, because
                      "why is a bill from the 12th in today's list" needs an
                      answer that is one hover away rather than a mystery. */}
                  <div className="w-[104px] shrink-0 text-right">
                    <div
                      className="text-[13px] font-medium text-[var(--p-ink)]"
                      title={i.billDate
                        ? `Prints as ${billDay(i.billDate)} · actually raised ${billDay(i.createdAt)}`
                        : `Raised ${billDay(i.createdAt)}`}
                    >
                      {billDay(i.billDate ?? i.createdAt)}
                    </div>
                    <div className="text-[11px] text-[var(--p-muted)]">
                      {i.billDate ? "re-dated" : "bill date"}
                    </div>
                  </div>

                  <span className="rounded bg-[var(--p-bg)] px-2 py-1 text-[12px] font-medium text-[var(--p-muted)]">
                    {SOURCE[i.source] ?? i.source}
                  </span>

                  <div className="w-[92px] text-right">
                    <div className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money(i.totalAmount)}</div>
                    <div className="text-[11px] text-[var(--p-muted)]">total</div>
                  </div>
                  {/* An unpaid balance on a cashless bill is with the insurer, not
                      with the family. Printing it in the same red as a real debt
                      sends the desk to chase somebody who owes nothing. */}
                  <div className="w-[92px] text-right">
                    <div className={`font-mono text-[14px] font-semibold ${
                      bal > 0 && !voided && i.payer !== "INSURANCE" ? "text-[var(--p-rose)]" : "text-[var(--p-muted)]"}`}>
                      ₹{money(String(bal))}
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
                    <span
                      title={i.payerName ? `Billed to ${i.payerName}` : "Billed to an insurer"}
                      className="rounded bg-[var(--p-blue-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--p-blue-deep)]">
                      Insurance{i.payerName ? ` · ${i.payerName}` : ""}
                    </span>
                  ) : i.paymentModes.length > 0 ? (
                    <span
                      title={i.paymentModes.length > 1 ? "Split payment" : "Payment type"}
                      className={`rounded px-2 py-1 text-[11px] font-semibold ${
                        i.paymentModes.length > 1
                          ? "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"
                          : "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"}`}>
                      {payLabel(i.paymentModes)}
                    </span>
                  ) : null}

                  {Number(i.refunded) > 0 && i.status !== "REFUNDED" && (
                    <span className="rounded bg-[var(--p-amber-soft)] px-2 py-1 font-mono text-[11px] font-semibold text-[var(--p-amber)]">
                      −₹{money(i.refunded)} back
                    </span>
                  )}

                  <div className="flex items-center gap-2">
                    {/* Refund is only offered when there is money to give back.
                        A cancelled bill is the COMMON case - you void the visit,
                        then you return the fee. */}
                    {Number(i.refundable) > 0 && (
                      <button onClick={() => {
                        setRefunding(i);
                        setRefAmt(i.refundable);
                        setRefMode("CASH");
                        setRefReason("");
                      }}
                        title={`Up to ₹${money(i.refundable)} can be returned`}
                        className="rounded-lg border border-[var(--p-rose)]/40 px-3 py-1.5 text-[13px] font-semibold text-[var(--p-rose)] transition-colors hover:bg-[var(--p-rose-soft)]">
                        Refund
                      </button>
                    )}
                    {!voided && bal > 0 && (
                      <button onClick={() => { setPay(i); setPayAmt(String(bal)); setPayMode("CASH"); setPayRef(""); }}
                        className="rounded-lg bg-[var(--p-teal)] px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)]">
                        Collect ₹{money(String(bal))}
                      </button>
                    )}
                    <a href={`/print/invoice/${i.id}`} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                      Print
                    </a>
                    {/* EDIT is offered on a PAID bill too, not only an unpaid
                        one. The server is what enforces the limits that still
                        apply - it refuses a cancelled bill, a bill registered
                        under an IRN, and any correction that would drop the
                        total below the money already collected. A cancelled bill
                        is excluded here as well, because that one is obvious
                        from the row and offering it would just produce an error
                        somebody has to read. */}
                    {canEdit && !voided && (
                      <button onClick={() => setEditingId(i.id)}
                        title={Number(i.amountPaid) > 0
                          ? `Correct this bill — ₹${money(i.amountPaid)} already collected`
                          : "Correct the lines, date or amount on this bill"}
                        className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--p-teal)] transition-colors hover:border-[var(--p-teal)]">
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

      {/* COLLECT */}
      {pay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface w-full max-w-sm bg-white">
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Collect payment</h3>
              <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">
                {pay.patient.fullName} · <span className="font-mono">{pay.receiptNo}</span> · ₹{money(String(due(pay)))} outstanding
              </p>
            </div>
            <div className="space-y-4 p-6">
              <Field label="Amount (₹)">
                <input className={fld} value={payAmt} inputMode="decimal" autoFocus
                  onChange={(e) => setPayAmt(e.target.value.replace(/[^\d.]/g, ""))} />
              </Field>
              <Field label="Paid by">
                <div className="flex gap-2">
                  {MODES.map((m) => (
                    <button key={m} onClick={() => setPayMode(m)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-[14px] font-medium transition-colors ${
                        payMode === m ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white"
                          : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-teal)]"}`}>
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
                  That&apos;s more than the ₹{money(String(due(pay)))} outstanding. Check before you take the money.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => setPay(null)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
              <button onClick={collect} disabled={busy || !payAmt || Number(payAmt) <= 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Recording…</> : <><Icon name="check" size={15} /> Record ₹{payAmt || 0}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── SETTLE A PATIENT'S WHOLE DEBT ───────────
          One amount, allocated across their open bills oldest-first by
          settleDues. Paying less than the total is allowed and clears the oldest
          bills outright rather than leaving every one of them part-paid. */}
      {settle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSettle(null)}>
          <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-md bg-white">
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Collect ₹{money(settle.due)}</h3>
              <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">
                {settle.patient.fullName}
                {settle.ipNumber && <> · <span className="font-mono">{settle.ipNumber}</span></>}
                {" · "}{settle.billCount} bill{settle.billCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3 text-[12.5px] text-[var(--p-muted)]">
                {settle.bills.map((b) => (
                  <div key={b.invoiceId} className="flex justify-between gap-3 py-0.5">
                    <span className="min-w-0 truncate"><span className="font-mono">{b.receiptNo}</span> · {b.summary}</span>
                    <span className="shrink-0 font-mono text-[var(--p-ink)]">₹{money(b.due)}</span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between border-t border-[var(--p-border)] pt-1 font-semibold">
                  <span className="text-[var(--p-ink)]">Total due</span>
                  <span className="font-mono text-[var(--p-amber)]">₹{money(settle.due)}</span>
                </div>
              </div>
              <Field label="Amount (₹)">
                <input className={fld} value={settleAmt} inputMode="decimal" autoFocus
                  onChange={(e) => setSettleAmt(e.target.value.replace(/[^\d.]/g, ""))} />
              </Field>
              <Field label="Paid by">
                <div className="flex gap-2">
                  {MODES.map((m) => (
                    <button key={m} onClick={() => setSettleMode(m)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-[14px] font-medium transition-colors ${
                        settleMode === m ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white"
                          : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-teal)]"}`}>
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
            <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => setSettle(null)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
              <button onClick={doSettle} disabled={busy || !settleAmt || Number(settleAmt) <= 0 || Number(settleAmt) > Number(settle.due)}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Recording…</> : <><Icon name="check" size={15} /> Record ₹{settleAmt || 0}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VOID */}
      {/* ─────────── REFUND ───────────
          The only screen that takes cash OUT of the hospital. The ceiling is
          shown, not merely enforced: a receptionist who can SEE that only ₹500
          was ever collected will not try to hand back ₹5,000. */}
      {refunding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRefunding(null)}>
          <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-md overflow-hidden">
            <div className="border-b border-[var(--p-border)] bg-[var(--p-rose-soft)] px-5 py-4">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--p-rose)]">
                <Icon name="alert" size={16} /> Give money back
              </h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-text)]">
                <span className="font-mono font-semibold">{refunding.receiptNo}</span> · {refunding.patient.fullName}
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--p-muted)]">Collected on this bill</span>
                  <span className="font-mono font-semibold text-[var(--p-ink)]">₹{money(refunding.refundable)}</span>
                </div>
                {Number(refunding.refunded) > 0 && (
                  <div className="mt-1 flex items-center justify-between text-[12px]">
                    <span className="text-[var(--p-muted)]">Already returned</span>
                    <span className="font-mono text-[var(--p-amber)]">−₹{money(refunding.refunded)}</span>
                  </div>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--p-muted)]">
                  You cannot return more than was actually collected. Not from a voided bill,
                  not from a typo.
                </p>
              </div>

              <Field label="Amount to return">
                <div className="flex gap-2">
                  <input className={fld} value={refAmt} inputMode="decimal"
                    onChange={(e) => setRefAmt(e.target.value.replace(/[^\d.]/g, ""))} />
                  <button onClick={() => setRefAmt(refunding.refundable)}
                    className="shrink-0 rounded-lg border border-[var(--p-border)] px-3 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-teal)]">
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
                        refMode === m
                          ? "border-[var(--p-rose)] bg-[var(--p-rose)] text-white"
                          : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-rose)]"}`}>
                      {m}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--p-muted)]">
                  A UPI refund does not come out of the cash drawer - the day-close depends on this being right.
                </p>
              </Field>

              <Field label="Why? (goes on the record)">
                <input className={fld} value={refReason} onChange={(e) => setRefReason(e.target.value)}
                  placeholder="Visit cancelled · overcharged · procedure not done" />
              </Field>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
              <button onClick={() => setRefunding(null)}
                className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">
                Cancel
              </button>
              <button onClick={doRefund}
                disabled={
                  refBusy ||
                  !(Number(refAmt) > 0) ||
                  Number(refAmt) > Number(refunding.refundable) ||
                  refReason.trim().length < 3
                }
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity disabled:opacity-40">
                {refBusy ? <><Spinner /> Returning…</> : <>Return ₹{money(refAmt || "0")}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {voiding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface w-full max-w-sm bg-white">
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Void this bill?</h3>
              <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">
                <span className="font-mono">{voiding.receiptNo}</span> · ₹{money(voiding.totalAmount)} · {voiding.patient.fullName}
              </p>
            </div>
            <div className="space-y-3 p-6">
              <label className="block text-[13px] font-medium text-[var(--p-text)]">Why?</label>
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus
                placeholder="Billed the wrong patient / duplicate…" className={fld} />
              <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[12px] leading-relaxed text-[#8a6414]">
                The bill is marked <b>cancelled</b>, not deleted - the receipt number stays used, which is what GST expects.
                {Number(voiding.amountPaid) > 0 && <> This bill already took <b>₹{money(voiding.amountPaid)}</b>; voiding it does <b>not</b> hand the cash back.</>}
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => setVoiding(null)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Keep it</button>
              <button onClick={voidBill} disabled={busy || voidReason.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Voiding…</> : "Void bill"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT - shared with the insurance room, so a correction means the same
          thing whichever desk made it. */}
      {editingId && (
        <EditBillDialog
          invoiceId={editingId}
          accent="teal"
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load(); }}
        />
      )}
    </PortalScroll>
  );
}
