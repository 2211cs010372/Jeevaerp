"use client";

import { useCallback, useEffect, useState } from "react";
import { Pill, statusTone, PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import { EditBillDialog } from "@/components/portal/billing/edit-bill-dialog";

interface Row {
  id: string; receiptNo: string; source: string; status: string;
  totalAmount: string; amountPaid: string; createdAt: string;
  patient: { displayId: string; fullName: string };
}

export default function InvoicesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** The invoice open for correction, by id - the dialog fetches its own copy. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { invoices } = await api.get<{ invoices: Row[] }>("/billing/invoices?source=LAB"); setRows(invoices); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load invoices."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Suspended while an invoice is open for editing - reloading the list under
  // an open dialog is how somebody's half-typed correction disappears.
  useLive([TOPICS.LABS], load, {
    events: [EVENTS.INVOICE_RAISED, EVENTS.PAYMENT_TAKEN],
    enabled: !editingId,
  });

  async function doCancel() {
    if (!cancelling) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/billing/invoice/${cancelling.id}/cancel`, { reason });
      setCancelling(null); setReason(""); await load();
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not cancel."); }
    finally { setBusy(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";


  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Lab invoices</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--p-muted)]">
          Invoices can be corrected here, <strong>including ones already paid</strong> - the lines, the amount and the
          printed date. What can&apos;t be done is reduce a bill below the money already collected: refund the
          difference first. A cancelled invoice, or one registered with an IRN, is reissued rather than rewritten.
          Every edit is recorded with your name.
        </p>
      </div>

      {error && (
        <div data-rise className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]">
          <Icon name="alert" size={15} /> <span>{error}</span>
        </div>
      )}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading invoices…</div>
        ) : rows.length === 0 ? (
          <p className="py-20 text-center text-[13px] text-[var(--p-muted)]">No lab invoices yet.</p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 transition-colors hover:bg-[var(--p-bg)]">
                <div>
                  <div className="font-mono text-[13px] font-semibold text-[var(--p-ink)]">{r.receiptNo}</div>
                  <div className="text-[12px] text-[var(--p-muted)]">
                    {r.patient.fullName} · <span className="tabular">{r.patient.displayId}</span> · {new Date(r.createdAt).toLocaleDateString("en-IN")}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[13px] font-semibold text-[var(--p-ink)]">₹{r.totalAmount}</span>
                  <Pill tone={statusTone(r.status === "PAID" ? "Completed" : r.status === "CANCELLED" ? "Cancelled" : "Waiting")}>{r.status}</Pill>
                  <a href={`/print/invoice/${r.id}`} target="_blank" rel="noopener noreferrer" title="View & print the bill"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                    <Icon name="printer" size={13} /> Bill
                  </a>

                  {r.status !== "CANCELLED" && (
                    <>
                      <button onClick={() => setEditingId(r.id)}
                        title={Number(r.amountPaid) > 0
                          ? `Correct this invoice — ₹${r.amountPaid} already collected`
                          : "Correct the lines, date or amount on this invoice"}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                        <Icon name="file" size={13} /> Edit
                      </button>
                      <button onClick={() => { setCancelling(r); setReason(""); }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-rose)]/30 px-3 py-1.5 text-[12px] font-medium text-[var(--p-rose)] hover:bg-[var(--p-rose-soft)]">
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* EDIT - the SHARED dialog, the same one reception and the insurance
          room use. This screen used to carry its own copy of it; the copy did
          not know about the bill date, which is exactly how three
          implementations of one form drift apart. */}
      {editingId && (
        <EditBillDialog
          invoiceId={editingId}
          accent="teal"
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load(); }}
        />
      )}

      {/* CANCEL modal */}
      {cancelling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface w-full max-w-md bg-white">
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Cancel {cancelling.receiptNo}?</h3>
            </div>
            <div className="p-6">
              <p className="text-[13px] leading-relaxed text-[var(--p-muted)]">
                The invoice stays in the ledger permanently, marked CANCELLED. Any lab tests on it are released so you can bill them again on a corrected invoice.
              </p>
              <label className="mb-1.5 mt-4 block text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Reason (required)</label>
              <input className={fld} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong test billed" autoFocus />
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => setCancelling(null)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Keep it</button>
              <button onClick={doCancel} disabled={busy || reason.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? <><Spinner /> Cancelling…</> : "Cancel invoice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
