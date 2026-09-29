"use client";

/**
 * FORGOTTEN BILLS - pharmacy and lab bills raised while the patient was in the
 * bed, but billed to them as an OP instead of to the stay.
 *
 * It happens whenever a stay is entered late: the counter looked for a live
 * admission, found none, and billed the person. Those bills then sit outside
 * the detailed bill and the claim until somebody notices. This lists them on
 * the stay sheet and puts the ticked ones on the stay - the bill itself does
 * not change (amount, receipt number, payments), only which stay it is on.
 *
 * SHARED BY RECEPTION AND THE INSURANCE DESK, like PatientHistoryPanel, for
 * the same reason: both desks work the same stay off the same sheet.
 *
 * Bills on the stay's own record (and same-name records on the same mobile)
 * are found automatically. A bill on some other card - a second registration
 * with a different phone - is added by typing its receipt number, so the desk
 * names it on purpose; it shows which record it is on before anything moves.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";
import { ForgottenBillDialog } from "@/components/portal/ipd/forgotten-bill-dialog";

interface UnlinkedBill {
  id: string; receiptNo: string; source: "PHARMACY" | "LAB"; status: string;
  createdAt: string; billDate: string | null;
  total: string; paid: string; due: string;
  patient: { displayId: string; fullName: string };
  otherRecord: boolean;
  items: string[]; itemCount: number;
}

const money = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
/** The pharmacy line carries its batch story; the name is enough here. */
const short = (d: string) => d.split(" · ")[0];

export function ForgottenBillsPanel({
  admissionId, ipNumber, admittedAt, dischargedAt, onLinked, reloadToken = 0,
}: {
  admissionId: string;
  ipNumber: string;
  admittedAt: string;
  dischargedAt: string | null;
  /** Called after bills move onto the stay, so the sheet can reload its totals. */
  onLinked: () => void;
  reloadToken?: number;
}) {
  const [bills, setBills] = useState<UnlinkedBill[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState("");
  const [finding, setFinding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** The "raise a NEW bill" form - for things never billed at all. */
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { bills: found } = await api.get<{ bills: UnlinkedBill[] }>(`/ipd/admissions/${admissionId}/unlinked-bills`);
      setBills(found);
      // The stay's own record is ticked; there is no other kind in this list.
      setPicked(new Set(found.filter((b) => !b.otherRecord).map((b) => b.id)));
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't look for forgotten bills."); }
    finally { setLoading(false); }
  }, [admissionId]);
  useEffect(() => { load(); }, [load, reloadToken]);

  async function find() {
    const r = receipt.trim().toUpperCase();
    if (!r) return;
    if (bills.some((b) => b.receiptNo === r)) { setErr(`${r} is already in the list below.`); return; }
    setFinding(true); setErr(null);
    try {
      const { bills: found } = await api.get<{ bills: UnlinkedBill[] }>(`/ipd/admissions/${admissionId}/unlinked-bills?receipt=${encodeURIComponent(r)}`);
      setBills((p) => [...p, ...found]);
      // Named on purpose, so it starts ticked - its record is shown right beside it.
      setPicked((p) => new Set([...p, ...found.map((b) => b.id)]));
      setReceipt("");
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't find that bill."); }
    finally { setFinding(false); }
  }

  async function link() {
    setBusy(true); setErr(null);
    try {
      const { linked } = await api.post<{ linked: number }>(`/ipd/admissions/${admissionId}/link-bills`, { invoiceIds: [...picked] });
      setFlash(`${linked} bill${linked === 1 ? "" : "s"} added to ${ipNumber}. They now show on the detailed bill.`);
      setConfirming(false);
      await load();
      onLinked();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Couldn't add the bills.");
      setConfirming(false);
    } finally { setBusy(false); }
  }

  const chosen = bills.filter((b) => picked.has(b.id));
  const chosenTotal = chosen.reduce((s, b) => s + Number(b.total), 0);
  const chosenDue = chosen.reduce((s, b) => s + Number(b.due), 0);
  const others = chosen.filter((b) => b.otherRecord);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <section data-rise className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] px-5 py-3.5">
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--p-ink)]">
            Forgotten bills
            {bills.length > 0 && <span className="rounded-full bg-[var(--p-amber-soft)] px-2 py-0.5 text-[11px] font-bold text-[#8a6414]">{bills.length}</span>}
          </h3>
          <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
            Raise a new pharmacy or lab bill for something never billed, or add a bill that went out as OP during this stay.
          </p>
        </div>
        <button type="button" onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--p-teal-deep)]">
          <Icon name="plus" size={14} /> Add a forgotten bill
        </button>
        {/* A bill on another card (a second registration, another phone) -
            found by its receipt number, never guessed. */}
        <div className="flex items-center gap-2">
          <input value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="Receipt no. e.g. JMH20261047"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find(); } }}
            className="w-52 rounded-lg border border-[var(--p-border)] bg-white px-3 py-1.5 font-mono text-[12.5px] outline-none focus:border-[var(--p-teal)]" />
          <button type="button" onClick={() => void find()} disabled={finding || !receipt.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--p-text)] hover:border-[var(--p-teal)] disabled:opacity-45">
            {finding ? <Spinner size={13} /> : <Icon name="search" size={13} />} Find
          </button>
        </div>
      </div>

      {flash && (
        <div className="flex items-start justify-between gap-3 border-b border-[var(--p-border)] bg-[var(--p-teal-soft)] px-5 py-2.5 text-[12.5px] text-[var(--p-teal-deep)]">
          <span>{flash}</span><button onClick={() => setFlash(null)} aria-label="Dismiss"><Icon name="x" size={13} /></button>
        </div>
      )}
      {err && (
        <div className="flex items-start justify-between gap-3 border-b border-[var(--p-border)] bg-[var(--p-rose-soft)] px-5 py-2.5 text-[12.5px] text-[var(--p-rose)]">
          <span>{err}</span><button onClick={() => setErr(null)} aria-label="Dismiss"><Icon name="x" size={13} /></button>
        </div>
      )}

      {loading ? (
        <p className="flex items-center justify-center gap-2 px-5 py-6 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Looking for bills…</p>
      ) : bills.length === 0 ? (
        <p className="px-5 py-5 text-center text-[12.5px] text-[var(--p-muted)]">
          No OP pharmacy or lab bills went out during this stay. A bill on another record can be added by its receipt number above.
        </p>
      ) : (
        <>
          <div className="max-h-80 divide-y divide-[var(--p-border)] overflow-y-auto overscroll-contain">
            {bills.map((b) => (
              <label key={b.id} className={`flex cursor-pointer items-start gap-3 px-5 py-3 ${picked.has(b.id) ? "bg-[var(--p-amber-soft)]/40" : ""}`}>
                <input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)} className="mt-1 h-4 w-4 accent-[var(--p-teal)]" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-[var(--p-ink)]">{b.source === "PHARMACY" ? "Pharmacy" : "Laboratory"}</span>
                    <span className="font-mono text-[12px] text-[var(--p-muted)]">{b.receiptNo}</span>
                    <span className="text-[12px] text-[var(--p-muted)]">{when(b.billDate ?? b.createdAt)}</span>
                    {b.otherRecord && (
                      <span className="rounded bg-[var(--p-amber-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#8a6414]">
                        On {b.patient.displayId} · {b.patient.fullName}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--p-muted)]">
                    {b.items.map(short).join(", ")}{b.itemCount > b.items.length ? ` +${b.itemCount - b.items.length} more` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[13.5px] font-semibold text-[var(--p-ink)]">₹{money(b.total)}</span>
                  <span className={`block text-[11px] ${Number(b.due) > 0 ? "text-[#8a6414]" : "text-[var(--p-muted)]"}`}>
                    {Number(b.due) > 0 ? `₹${money(b.due)} due` : "paid at counter"}
                  </span>
                </span>
                <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                  className="shrink-0 rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                  Bill
                </a>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
            <span className="text-[12.5px] text-[var(--p-muted)]">
              {chosen.length} of {bills.length} ticked · ₹{money(chosenTotal)}
            </span>
            <button type="button" onClick={() => setConfirming(true)} disabled={chosen.length === 0 || busy}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--p-teal-deep)] disabled:opacity-45">
              <Icon name="plus" size={14} /> Add {chosen.length || ""} to {ipNumber}
            </button>
          </div>
        </>
      )}

      {adding && (
        <ForgottenBillDialog admissionId={admissionId} ipNumber={ipNumber} admittedAt={admittedAt} dischargedAt={dischargedAt}
          onCreated={onLinked} onClose={() => setAdding(false)} />
      )}

      {confirming && (
        <div className="modal-veil" role="dialog" aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setConfirming(false); }}>
          <div className="surface w-full max-w-md bg-white">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Add {chosen.length} bill{chosen.length === 1 ? "" : "s"} to {ipNumber}?</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">₹{money(chosenTotal)} moves onto this stay&apos;s detailed bill.</p>
            </div>
            <div className="space-y-2.5 px-5 py-4 text-[12.5px] leading-relaxed text-[var(--p-text)]">
              <p>Nothing on the bills changes - not the amounts, the receipt numbers or the payments. Only the stay they belong to.</p>
              {chosenDue > 0.009 && (
                <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[#8a6414]">
                  ₹{money(chosenDue)} on them is still unpaid, and will show as due on the stay.
                </p>
              )}
              {others.length > 0 && (
                <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[#8a6414]">
                  {others.length} {others.length === 1 ? "is" : "are"} on another record ({[...new Set(others.map((b) => `${b.patient.displayId} ${b.patient.fullName}`))].join(", ")}).
                  Only add {others.length === 1 ? "it" : "them"} if this is the same patient.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Cancel</button>
              <button type="button" onClick={() => void link()} disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--p-teal-deep)] disabled:opacity-50">
                {busy ? <><Spinner /> Adding…</> : <>Yes, add to {ipNumber}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
