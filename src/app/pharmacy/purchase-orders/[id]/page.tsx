"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import {
  ErrorNote, Flash, GhostButton, Modal, PROC_CSS, Tag, dmy, dmyFromISO, fld, inr, poStatus,
} from "@/components/portal/pharmacy/procurement-ui";
import { api, ApiClientError } from "@/lib/api-client";

interface Item {
  id: string; medicineId: string; name: string; unit: string; hsnCode: string | null;
  qtyOrdered: number; qtyReceived: number; qtyPending: number;
  unitCost: string; gstRatePct: string; freeQty: number; lineValue: string;
}
interface Detail {
  id: string; poNumber: string; status: string;
  expectedDate: string | null; notes: string | null; cancelReason: string | null;
  subtotal: string; taxAmount: string; totalAmount: string;
  createdAt: string; sentAt: string | null; closedAt: string | null; cancelledAt: string | null;
  createdByName: string;
  supplier: { id: string; name: string; phone: string | null; email: string | null; gstin: string | null; drugLicenseNo: string | null; address: string | null; paymentTermDays: number };
  items: Item[];
  receipts: { id: string; grnNumber: string; invoiceNo: string | null; receivedValue: string; createdAt: string; receivedByName: string }[];
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [po, setPo] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"CANCEL" | "SHORT" | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ order: Detail }>(`/pharmacy/purchase-orders/${id}`);
      setPo(r.order); setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load that order.");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function send() {
    setBusy(true); setError(null);
    try {
      await api.post(`/pharmacy/purchase-orders/${id}/send`);
      setFlash("Order sent. Its lines are frozen from here - receive against it when the delivery arrives.");
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not send the order.");
    } finally { setBusy(false); }
  }

  async function act() {
    if (!confirm || reason.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      const path = confirm === "CANCEL" ? "cancel" : "close-short";
      await api.post(`/pharmacy/purchase-orders/${id}/${path}`, { reason });
      setFlash(confirm === "CANCEL" ? "Order cancelled." : "Order closed short - the outstanding units will show up on the reorder list again.");
      setConfirm(null); setReason("");
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "That didn't work.");
    } finally { setBusy(false); }
  }

  if (loading) {
    return <PortalScroll><div className="flex items-center justify-center gap-2 py-24 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading order…</div></PortalScroll>;
  }
  if (!po) {
    return <PortalScroll><style>{PROC_CSS}</style>{error && <ErrorNote text={error} />}</PortalScroll>;
  }

  const st = poStatus(po.status);
  const isOpen = po.status === "SENT" || po.status === "PARTIALLY_RECEIVED";
  const overdue = isOpen && !!po.expectedDate && new Date(po.expectedDate + "T00:00:00") < new Date(new Date().toDateString());
  const totalOrdered = po.items.reduce((s, i) => s + i.qtyOrdered, 0);
  const totalReceived = po.items.reduce((s, i) => s + Math.min(i.qtyReceived, i.qtyOrdered), 0);

  return (
    <PortalScroll>
      <style>{PROC_CSS}</style>

      <div data-rise className="mb-4">
        <Link href="/purchase-orders" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--p-muted)] transition-colors hover:text-[var(--p-blue)]">
          <span className="rotate-180"><Icon name="chevron" size={13} /></span> All purchase orders
        </Link>
      </div>

      <div data-rise className="surface dotgrid mb-5 flex flex-wrap items-start justify-between gap-4 px-6 py-5">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif-p text-[22px] font-semibold tracking-[-0.02em] text-[var(--p-ink)]">{po.poNumber}</h1>
            <Tag tone={st.tone}>{st.label}</Tag>
            {overdue && <Tag tone="bad">Overdue</Tag>}
          </div>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">
            {po.supplier.name} · raised {dmyFromISO(po.createdAt)} by {po.createdByName}
            {po.sentAt && <> · sent {dmyFromISO(po.sentAt)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {po.status === "DRAFT" && (
            <PrimaryButton onClick={send} disabled={busy}>
              {busy ? <><Spinner /> Sending…</> : <><Icon name="truck" size={15} /> Send to supplier</>}
            </PrimaryButton>
          )}
          {isOpen && (
            <>
              <button onClick={() => router.push(`/receive?po=${po.id}`)}
                className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white">
                <Icon name="inbox" size={15} /> Receive delivery
              </button>
              <GhostButton onClick={() => { setConfirm("SHORT"); setReason(""); }}>Close short</GhostButton>
            </>
          )}
          {(po.status === "DRAFT" || po.status === "SENT") && totalReceived === 0 && (
            <GhostButton tone="danger" onClick={() => { setConfirm("CANCEL"); setReason(""); }}>Cancel</GhostButton>
          )}
        </div>
      </div>

      {flash && <Flash text={flash} onClose={() => setFlash(null)} />}
      {error && <ErrorNote text={error} />}

      {po.status === "DRAFT" && (
        <div data-rise className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--p-blue)]/25 bg-[var(--p-blue-soft)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--p-blue-deep)]">
          <span className="mt-0.5 shrink-0"><Icon name="alert" size={14} /></span>
          <span>This is still a draft - the supplier hasn&apos;t seen it, and nothing can be received against it. <b>Send</b> it when you&apos;ve placed the order.</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        {/* ── Lines ─────────────────────────────────────────────────────────── */}
        <div className="space-y-5">
          <section data-rise className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-3.5">
              <h3 className="text-[13.5px] font-semibold text-[var(--p-ink)]">Ordered</h3>
              <span className="num text-[12px] text-[var(--p-muted)]">{totalReceived} of {totalOrdered} units delivered</span>
            </div>
            <div className="overflow-x-auto">
              <table className="ptable">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th className="r">Ordered</th>
                    <th className="r">Delivered</th>
                    <th className="r">Still due</th>
                    <th className="r">Rate</th>
                    <th className="r">GST</th>
                    <th className="r">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {po.items.map((it, i) => (
                    <tr key={it.id} className="prow" style={{ ["--d" as string]: `${Math.min(i, 12) * 18}ms` }}>
                      <td>
                        <div className="font-semibold">{it.name}</div>
                        <div className="text-[11px] text-[var(--p-muted)]">
                          in {it.unit}s{it.hsnCode && <> · HSN <span className="num">{it.hsnCode}</span></>}
                          {it.freeQty > 0 && <> · <span className="font-semibold text-[var(--p-cyan-deep)]">+{it.freeQty} free agreed</span></>}
                        </div>
                      </td>
                      <td className="r num">{it.qtyOrdered}</td>
                      <td className="r num font-semibold">{it.qtyReceived}</td>
                      <td className={`r num font-semibold ${it.qtyPending > 0 ? "text-[var(--p-amber)]" : "text-[var(--p-muted)]"}`}>
                        {it.qtyPending > 0 ? it.qtyPending : "-"}
                      </td>
                      <td className="r num">{inr(it.unitCost, 2)}</td>
                      <td className="r num text-[var(--p-muted)]">{Number(it.gstRatePct)}%</td>
                      <td className="r num font-semibold">{inr(it.lineValue, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-end gap-1 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3.5 text-[13px]">
              <div className="flex gap-8"><span className="text-[var(--p-muted)]">Subtotal</span><span className="num w-[110px] text-right">{inr(po.subtotal, 2)}</span></div>
              <div className="flex gap-8"><span className="text-[var(--p-muted)]">GST</span><span className="num w-[110px] text-right">{inr(po.taxAmount, 2)}</span></div>
              <div className="flex gap-8 pt-1 font-bold"><span>Order value</span><span className="num w-[110px] text-right text-[15px]">{inr(po.totalAmount, 2)}</span></div>
            </div>
          </section>

          {/* ── Deliveries against this order ──────────────────────────────── */}
          <section data-rise className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-3.5">
              <h3 className="text-[13.5px] font-semibold text-[var(--p-ink)]">Deliveries</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Every goods receipt booked against this order.</p>
            </div>
            {!po.receipts.length ? (
              <p className="px-5 py-8 text-center text-[12.5px] text-[var(--p-muted)]">Nothing delivered yet.</p>
            ) : (
              <div className="divide-y divide-[var(--p-border)]">
                {po.receipts.map((g) => (
                  <Link key={g.id} href={`/receive?grn=${g.id}`} className="prow flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
                    <span className="doc">{g.grnNumber}</span>
                    <span className="text-[12px] text-[var(--p-muted)]">
                      {dmyFromISO(g.createdAt)} · booked by {g.receivedByName}
                      {g.invoiceNo && <> · their invoice <span className="num">{g.invoiceNo}</span></>}
                    </span>
                    <span className="num ml-auto text-[13px] font-semibold text-[var(--p-ink)]">{inr(g.receivedValue, 2)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Supplier card ─────────────────────────────────────────────────── */}
        <aside className="space-y-4">
          <section data-rise className="surface px-5 py-4">
            <h3 className="mb-3 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--p-muted)]">Supplier</h3>
            <div className="text-[14px] font-semibold text-[var(--p-ink)]">{po.supplier.name}</div>
            <dl className="mt-3 space-y-2 text-[12.5px]">
              {po.supplier.phone && <div className="flex justify-between gap-3"><dt className="text-[var(--p-muted)]">Phone</dt><dd className="num">{po.supplier.phone}</dd></div>}
              {po.supplier.gstin && <div className="flex justify-between gap-3"><dt className="text-[var(--p-muted)]">GSTIN</dt><dd className="num">{po.supplier.gstin}</dd></div>}
              {po.supplier.drugLicenseNo && <div className="flex justify-between gap-3"><dt className="text-[var(--p-muted)]">Licence</dt><dd className="num">{po.supplier.drugLicenseNo}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-[var(--p-muted)]">Terms</dt><dd className="num">{po.supplier.paymentTermDays} days</dd></div>
            </dl>
            {po.supplier.address && <p className="mt-3 border-t border-[var(--p-border)] pt-3 text-[12px] leading-relaxed text-[var(--p-muted)]">{po.supplier.address}</p>}
            <Link href="/suppliers" className="mt-3 inline-block text-[12px] font-semibold text-[var(--p-blue)]">All suppliers →</Link>
          </section>

          <section data-rise className="surface px-5 py-4">
            <h3 className="mb-3 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--p-muted)]">Timeline</h3>
            <dl className="space-y-2 text-[12.5px]">
              <div className="flex justify-between gap-3"><dt className="text-[var(--p-muted)]">Raised</dt><dd className="num">{dmyFromISO(po.createdAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[var(--p-muted)]">Sent</dt><dd className="num">{po.sentAt ? dmyFromISO(po.sentAt) : "-"}</dd></div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--p-muted)]">Expected</dt>
                <dd className={`num ${overdue ? "font-semibold text-[var(--p-rose)]" : ""}`}>{po.expectedDate ? dmy(po.expectedDate) : "-"}</dd>
              </div>
              <div className="flex justify-between gap-3"><dt className="text-[var(--p-muted)]">Closed</dt><dd className="num">{po.closedAt ? dmyFromISO(po.closedAt) : "-"}</dd></div>
            </dl>
          </section>

          {(po.notes || po.cancelReason) && (
            <section data-rise className="surface px-5 py-4">
              <h3 className="mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--p-muted)]">Notes</h3>
              {po.notes && <p className="text-[12.5px] leading-relaxed text-[var(--p-text)]">{po.notes}</p>}
              {po.cancelReason && (
                <p className="mt-2 rounded-lg bg-[var(--p-rose-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--p-rose)]">{po.cancelReason}</p>
              )}
            </section>
          )}
        </aside>
      </div>

      {confirm && (
        <Modal
          title={confirm === "CANCEL" ? "Cancel this order" : "Close it short"}
          sub={confirm === "CANCEL"
            ? "Nothing has been delivered, so nothing on the shelf changes."
            : "Accept that the rest is never coming. The undelivered units go back onto the reorder list."}
          busy={busy}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <GhostButton onClick={() => setConfirm(null)} disabled={busy}>Back</GhostButton>
              <button onClick={act} disabled={busy || reason.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40">
                {busy ? <><Spinner /> Working…</> : confirm === "CANCEL" ? "Cancel order" : "Close short"}
              </button>
            </>
          }
        >
          <div className="p-6">
            <Field label="Why?">
              <textarea className={`${fld} min-h-[80px]`} value={reason} autoFocus
                onChange={(e) => setReason(e.target.value)}
                placeholder={confirm === "CANCEL" ? "e.g. Ordered from another distributor at a better rate" : "e.g. Distributor confirmed the balance is out of stock indefinitely"} />
            </Field>
            <p className="mt-3 rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[11.5px] leading-relaxed text-[#8a6414]">
              Recorded against your name. {confirm === "SHORT" && "Leaving a short order open is worse - the reorder engine keeps subtracting stock that will never arrive, and the medicine quietly runs out."}
            </p>
          </div>
        </Modal>
      )}
    </PortalScroll>
  );
}
