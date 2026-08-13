"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { Icon } from "@/components/portal/ui/icons";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { EditBillDialog } from "@/components/portal/billing/edit-bill-dialog";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";

interface Bill {
  id: string; receiptNo: string; source: string; status: string;
  totalAmount: string; amountPaid: string; refunded: string; refundable: string;
  paymentModes: string[];
  /** SELF_PAY or INSURANCE - see the PayerType enum. */
  payer: string;
  payerName: string | null;
  createdAt: string; patient: { displayId: string; fullName: string };
}

const inr2 = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const SOURCES = ["CONSULTATION", "LAB", "PHARMACY", "IPD", "OTHER"] as const;
const SRC_LABEL: Record<string, string> = { CONSULTATION: "Consultation", LAB: "Lab", PHARMACY: "Pharmacy", IPD: "Inpatient", OTHER: "Other" };
const SRC_COLOR: Record<string, string> = { CONSULTATION: "#0b5f55", LAB: "#2f6df6", PHARMACY: "#c77d33", IPD: "#7c5cbf", OTHER: "#94a3b8" };

// Payment-type buckets to filter by. INSURANCE sits alongside the tender types
// because it is the answer to the same question - how did this bill settle -
// and because "show me everything with the TPAs" is a question the owner asks.
const PAY_FILTERS = ["ALL", "CASH", "UPI", "CARD", "SPLIT", "INSURANCE", "UNPAID"] as const;

function billChip(status: string) {
  const map: Record<string, string> = {
    PAID: "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]",
    PARTIALLY_PAID: "bg-[#fdf0dd] text-[#8a5a1a]",
    PENDING: "bg-[var(--p-border)]/40 text-[var(--p-muted)]",
    REFUNDED: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]",
    CANCELLED: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]",
  };
  const label: Record<string, string> = { PARTIALLY_PAID: "Part paid" };
  return <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${map[status] ?? "bg-[var(--p-border)]/40 text-[var(--p-muted)]"}`}>{label[status] ?? status[0] + status.slice(1).toLowerCase()}</span>;
}

function modeChip(m: string) {
  const c: Record<string, string> = {
    CASH: "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]",
    UPI: "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]",
    CARD: "bg-[#efe9fb] text-[#5b3fa0]",
    NETBANKING: "bg-[#e7effb] text-[#2f6df6]",
    OTHER: "bg-[var(--p-border)]/40 text-[var(--p-muted)]",
  };
  const label: Record<string, string> = { NETBANKING: "Netbank", UPI: "UPI" };
  return <span key={m} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${c[m] ?? "bg-[var(--p-border)]/40 text-[var(--p-muted)]"}`}>{label[m] ?? m[0] + m.slice(1).toLowerCase()}</span>;
}

export default function AdminBillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"ALL" | (typeof SOURCES)[number]>("ALL");
  const [pay, setPay] = useState<(typeof PAY_FILTERS)[number]>("ALL");
  const [q, setQ] = useState("");
  /**
   * The bill open for correction.
   *
   * No useBillEditing() check here, unlike reception and the insurance room.
   * HospitalConfig.billEditingEnabled gates the COUNTER DESKS; an admin who
   * could not correct a bill would have no way to fix the mistake that switch
   * exists to prevent. The server agrees - see EDIT_GATED_ROLES.
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<{ invoices: Bill[] }>("/admin/bills");
    setBills(r.invoices);
  }, []);

  useEffect(() => { load().catch(() => {}).finally(() => setLoading(false)); }, [load]);

  // Bills are raised at four counters. This is the one screen that sees all of
  // them, so it is the one that most needs to not be stale.
  useLive([TOPICS.ADMIN], load, {
    events: [EVENTS.INVOICE_RAISED, EVENTS.PAYMENT_TAKEN],
    // Not while a bill is open for correction - a list that reloads under an
    // open dialog takes a half-typed amendment with it.
    enabled: !editingId,
  });

  const matchPay = (b: Bill) => {
    if (pay === "ALL") return true;
    if (pay === "INSURANCE") return b.payer === "INSURANCE";
    // Every tender bucket below is about money at a counter, so a cashless bill
    // belongs in none of them - including UNPAID, which means "somebody still
    // owes us at the desk" and is exactly what an insurance bill is not.
    if (b.payer === "INSURANCE") return false;
    if (pay === "UNPAID") return b.paymentModes.length === 0;
    if (pay === "SPLIT") return b.paymentModes.length > 1;
    return b.paymentModes.length === 1 && b.paymentModes[0] === pay;
  };

  const shown = useMemo(() => bills.filter((b) => {
    if (source !== "ALL" && b.source !== source) return false;
    if (!matchPay(b)) return false;
    if (q.trim()) {
      const t = q.toLowerCase();
      return b.receiptNo.toLowerCase().includes(t) || b.patient.fullName.toLowerCase().includes(t) || b.patient.displayId.toLowerCase().includes(t);
    }
    return true;
  }), [bills, source, pay, q]);

  const totals = useMemo(() => {
    const billed = shown.reduce((s, b) => s + Number(b.totalAmount), 0);
    const collected = shown.reduce((s, b) => s + Number(b.amountPaid), 0);
    return { billed, collected, count: shown.length };
  }, [shown]);

  const dt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-teal)]">Admin console</p>
        <h1 className="mt-1 font-serif-p text-[24px] font-semibold text-[var(--p-ink)]">All bills</h1>
        <p className="mt-1 text-[13px] text-[var(--p-muted)]">Every invoice across reception, lab, pharmacy and inpatient - with how each was paid.</p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--p-border)] bg-white px-3 py-2">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt no, patient or UHID" className="w-full bg-transparent text-[13px] text-[var(--p-ink)] outline-none" />
          {q && <button onClick={() => setQ("")} className="text-[12px] text-[var(--p-muted)]">clear</button>}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading bills…</div>
      ) : (
        <>
          {/* filters */}
          <div data-rise className="mb-4 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {(["ALL", ...SOURCES] as const).map((s) => (
                <button key={s} onClick={() => setSource(s)}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${source === s ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white" : "border-[var(--p-border)] text-[var(--p-muted)]"}`}>
                  {s === "ALL" ? "All sources" : SRC_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PAY_FILTERS.map((p) => (
                <button key={p} onClick={() => setPay(p)}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${pay === p ? "border-[var(--p-cyan-deep)] bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]" : "border-[var(--p-border)] text-[var(--p-muted)]"}`}>
                  {p === "ALL" ? "Any payment" : p[0] + p.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {/* summary */}
          <div data-rise className="mb-4 grid grid-cols-3 gap-4">
            <div className="surface px-5 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Bills</div><div className="mt-0.5 font-mono text-[19px] font-bold text-[var(--p-ink)]">{totals.count}</div></div>
            <div className="surface px-5 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Billed</div><div className="mt-0.5 font-mono text-[19px] font-bold text-[var(--p-ink)]">{inr0(totals.billed)}</div></div>
            <div className="surface px-5 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Collected</div><div className="mt-0.5 font-mono text-[19px] font-bold text-[var(--p-teal)]">{inr0(totals.collected)}</div></div>
          </div>

          {/* list */}
          <section data-rise className="surface overflow-hidden">
            <div className="divide-y divide-[var(--p-border)]">
              {shown.length === 0 ? (
                <p className="px-6 py-12 text-center text-[13px] text-[var(--p-muted)]">No bills match.</p>
              ) : shown.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3.5">
                  <div className="min-w-[150px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-medium text-[var(--p-ink)]">{b.receiptNo}</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `${SRC_COLOR[b.source] ?? "#94a3b8"}18`, color: SRC_COLOR[b.source] ?? "#94a3b8" }}>{SRC_LABEL[b.source] ?? b.source}</span>
                    </div>
                    <div className="text-[12px] text-[var(--p-muted)]">{b.patient.fullName} · <span className="font-mono">{b.patient.displayId}</span></div>
                  </div>
                  <div className="min-w-[70px] text-[12px] text-[var(--p-muted)]">{dt(b.createdAt)}</div>
                  <div className="min-w-[150px]">
                    <div className="flex flex-wrap gap-1">
                      {/* "unpaid" is only true of a bill somebody could have paid.
                          A cashless bill names its insurer instead - it has no
                          tender because none was ever going to be taken here. */}
                      {b.payer === "INSURANCE" ? (
                        <span className="rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--p-blue-deep)]">
                          Insurance{b.payerName ? ` · ${b.payerName}` : ""}
                        </span>
                      ) : b.paymentModes.length > 0 ? b.paymentModes.map(modeChip) : (
                        <span className="text-[11px] text-[var(--p-muted)]">unpaid</span>
                      )}
                    </div>
                    {Number(b.refunded) > 0 && <div className="mt-0.5 text-[10px] text-[var(--p-rose)]">−{inr2(Number(b.refunded))} refunded</div>}
                  </div>
                  <div className="min-w-[130px] text-right">
                    <div className="font-mono text-[13px] text-[var(--p-ink)]">{inr2(Number(b.totalAmount))}</div>
                    {Number(b.amountPaid) !== Number(b.totalAmount) && <div className="font-mono text-[11px] text-[var(--p-muted)]">{inr2(Number(b.amountPaid))} paid</div>}
                  </div>
                  {billChip(b.status)}
                  <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer" title="View & print the bill"
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-blue)] transition-colors hover:border-[var(--p-blue)]">
                    <Icon name="printer" size={13} /> Bill
                  </a>
                  {/* Paid bills included - the counters can correct those now,
                      and an admin who could do less than a receptionist would be
                      an odd console. Only a cancelled bill is excluded, because
                      it is finished and the row already says so. The remaining
                      limits (a live IRN, never below what was collected) are
                      enforced server-side. */}
                  {b.status !== "CANCELLED" && (
                    <button onClick={() => setEditingId(b.id)}
                      title={Number(b.amountPaid) > 0
                        ? `Correct this bill — ${inr2(Number(b.amountPaid))} already collected`
                        : "Correct this bill's date, lines or amount"}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-blue)] transition-colors hover:border-[var(--p-blue)]">
                      <Icon name="file" size={13} /> Edit
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* The same dialog every other desk corrects a bill with. Blue here to sit
          with the admin console, teal at the counters - the accent is the only
          thing that differs. */}
      {editingId && (
        <EditBillDialog
          invoiceId={editingId}
          accent="blue"
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load(); }}
        />
      )}
    </PortalScroll>
  );
}
