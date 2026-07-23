"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import {
  EmptyState, ErrorNote, Flash, GhostButton, Modal, PROC_CSS, PageHead, Tag,
  daysUntil, dmy, dmyFromISO, fld, inr,
} from "@/components/portal/pharmacy/procurement-ui";
import { effectiveUnitCost, invoiceVariance } from "@/lib/pharmacy/procurement-math";
import { api, ApiClientError } from "@/lib/api-client";

interface Supplier { id: string; name: string }
interface Med { id: string; name: string; unit: string; mrp: string | null }
interface OpenPo {
  id: string; poNumber: string; supplierId: string; supplierName: string;
  expectedDate: string | null; qtyOrdered: number; qtyReceived: number; status: string;
}
interface PoDetail {
  id: string; poNumber: string; supplier: { id: string; name: string };
  items: { id: string; medicineId: string; name: string; unit: string; qtyOrdered: number; qtyReceived: number; qtyPending: number; unitCost: string }[];
}
interface Grn {
  id: string; grnNumber: string; invoiceNo: string | null; invoiceAmount: string | null;
  receivedValue: string; variance: number | null; mismatch: boolean; createdAt: string;
  supplierName: string; poNumber: string | null; receivedByName: string; lines: number;
}
interface GrnDetail extends Grn {
  notes: string | null;
  supplier: { id: string; name: string; gstin: string | null; drugLicenseNo: string | null };
  invoiceDate: string | null;
  items: {
    id: string; name: string; unit: string; batchNo: string; expiryDate: string;
    qty: number; freeQty: number; unitCost: string; landedCost: string; mrp: string;
    lineValue: string; marginPct: number | null;
  }[];
}

/** One row on the delivery being booked in. */
interface Row {
  key: string;
  medicineId: string;
  purchaseOrderItemId?: string;
  name: string;
  unit: string;
  /** Ordered-but-undelivered, when this row came off a PO. Shown, never enforced. */
  pending?: number;
  batchNo: string;
  expiryDate: string;
  qty: string;
  freeQty: string;
  unitCost: string;
  mrp: string;
}

let rowSeq = 0;
const newRow = (over: Partial<Row> = {}): Row => ({
  key: `r${++rowSeq}`, medicineId: "", name: "", unit: "unit",
  batchNo: "", expiryDate: "", qty: "", freeQty: "", unitCost: "", mrp: "", ...over,
});

export default function ReceivePage() {
  return (
    <Suspense fallback={<PortalScroll><div className="py-24 text-center text-[13px] text-[var(--p-muted)]">Loading…</div></PortalScroll>}>
      <ReceiveInner />
    </Suspense>
  );
}

function ReceiveInner() {
  const params = useSearchParams();
  const presetPo = params.get("po");
  const presetGrn = params.get("grn");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [meds, setMeds] = useState<Med[]>([]);
  const [openPos, setOpenPos] = useState<OpenPo[]>([]);
  const [recent, setRecent] = useState<Grn[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [view, setView] = useState<GrnDetail | null>(null);

  // ── The delivery being booked ──────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, p, g] = await Promise.all([
        api.get<{ suppliers: Supplier[] }>("/pharmacy/suppliers"),
        api.get<{ medicines: Med[] }>("/pharmacy/medicines"),
        api.get<{ orders: OpenPo[] }>("/pharmacy/purchase-orders?status=OPEN"),
        api.get<{ receipts: Grn[] }>("/pharmacy/receipts?days=60"),
      ]);
      setSuppliers(s.suppliers); setMeds(m.medicines);
      setOpenPos(p.orders.filter((o) => o.status !== "DRAFT"));
      setRecent(g.receipts);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load the receiving desk.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Pull the outstanding lines off a purchase order, priced as ordered. */
  const loadPo = useCallback(async (id: string) => {
    try {
      const r = await api.get<{ order: PoDetail }>(`/pharmacy/purchase-orders/${id}`);
      setSupplierId(r.order.supplier.id);
      setPoId(id);
      const pending = r.order.items.filter((i) => i.qtyPending > 0);
      setRows(
        (pending.length ? pending : r.order.items).map((i) =>
          newRow({
            medicineId: i.medicineId,
            purchaseOrderItemId: i.id,
            name: i.name,
            unit: i.unit,
            pending: i.qtyPending,
            qty: String(i.qtyPending || i.qtyOrdered),
            unitCost: i.unitCost,
            mrp: meds.find((m) => m.id === i.medicineId)?.mrp ?? "",
          })
        )
      );
      setOpen(true);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load that order.");
    }
  }, [meds]);

  // Deep links: /receive?po=… opens the form primed, ?grn=… opens the receipt.
  useEffect(() => {
    if (presetPo && !loading && !open) loadPo(presetPo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetPo, loading]);

  useEffect(() => {
    if (presetGrn && !loading) openGrn(presetGrn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetGrn, loading]);

  async function openGrn(id: string) {
    try {
      const r = await api.get<{ receipt: GrnDetail }>(`/pharmacy/receipts/${id}`);
      setView(r.receipt);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load that receipt.");
    }
  }

  function startDirect() {
    setSupplierId(""); setPoId(""); setInvoiceNo(""); setInvoiceDate("");
    setInvoiceAmount(""); setNotes(""); setRows([newRow()]); setOpen(true);
  }

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Running value of the carton, and whether the invoice agrees with it. */
  const totals = useMemo(() => {
    let value = 0, units = 0, free = 0;
    for (const r of rows) {
      const q = Number(r.qty || 0), c = Number(r.unitCost || 0), f = Number(r.freeQty || 0);
      value += q * c; units += q; free += f;
    }
    value = Math.round(value * 100) / 100;
    const v = invoiceAmount ? invoiceVariance(Number(invoiceAmount), value) : null;
    return { value, units, free, variance: v?.variance ?? null, mismatch: v?.mismatch ?? false };
  }, [rows, invoiceAmount]);

  const valid = rows.filter((r) => r.medicineId && r.batchNo.trim() && r.expiryDate && Number(r.qty) > 0);
  const canPost = !!supplierId && valid.length > 0 && valid.length === rows.length;

  async function post() {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ receipt: { grnNumber: string; receivedValue: string; mismatch: boolean; variance: number | null } }>(
        "/pharmacy/receipts",
        {
          supplierId,
          purchaseOrderId: poId || undefined,
          invoiceNo: invoiceNo || undefined,
          invoiceDate: invoiceDate || undefined,
          invoiceAmount: invoiceAmount ? Number(invoiceAmount) : undefined,
          notes: notes || undefined,
          items: rows.map((x) => ({
            medicineId: x.medicineId,
            purchaseOrderItemId: x.purchaseOrderItemId,
            batchNo: x.batchNo,
            expiryDate: x.expiryDate,
            qty: Number(x.qty),
            freeQty: x.freeQty ? Number(x.freeQty) : undefined,
            unitCost: Number(x.unitCost || 0),
            mrp: Number(x.mrp || 0),
          })),
        }
      );
      const g = r.receipt;
      setFlash(
        g.mismatch
          ? `${g.grnNumber} posted - but their invoice and the carton differ by ${inr(Math.abs(g.variance ?? 0), 2)}. Worth a call before you pay it.`
          : `${g.grnNumber} posted. ${inr(g.receivedValue, 2)} of stock is on the shelf.`
      );
      setOpen(false); setRows([]);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not book the delivery in.");
    } finally { setBusy(false); }
  }

  return (
    <PortalScroll>
      <style>{PROC_CSS}</style>

      <PageHead
        title="Receive goods"
        blurb="Book a delivery in against its invoice. This is the only way supplier stock reaches the shelf - so every batch keeps a distributor, a rate and a document behind it."
      >
        <GhostButton onClick={startDirect}><Icon name="plus" size={14} /> Direct receipt</GhostButton>
      </PageHead>

      {flash && <Flash text={flash} onClose={() => setFlash(null)} />}
      {error && <ErrorNote text={error} />}

      {/* ── Waiting to arrive ─────────────────────────────────────────────── */}
      <section data-rise className="surface mb-5 overflow-hidden">
        <div className="border-b border-[var(--p-border)] px-5 py-3.5">
          <h3 className="text-[13.5px] font-semibold text-[var(--p-ink)]">Expected deliveries</h3>
          <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Open orders. Pick one and the outstanding lines fill themselves in.</p>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-8 text-[12.5px] text-[var(--p-muted)]"><Spinner size={14} /> Loading…</div>
        ) : !openPos.length ? (
          <p className="px-5 py-8 text-center text-[12.5px] text-[var(--p-muted)]">
            Nothing on order. Use <b>Direct receipt</b> for an emergency purchase bought without a PO.
          </p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {openPos.map((p, i) => {
              const late = p.expectedDate && daysUntil(p.expectedDate) < 0;
              return (
                <div key={p.id} className="prow flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5" style={{ ["--d" as string]: `${Math.min(i, 10) * 20}ms` }}>
                  <span className="doc">{p.poNumber}</span>
                  <span className="text-[13px] font-medium text-[var(--p-ink)]">{p.supplierName}</span>
                  <span className="num text-[12px] text-[var(--p-muted)]">
                    {p.qtyReceived}/{p.qtyOrdered} units in
                  </span>
                  {p.expectedDate && (
                    late
                      ? <Tag tone="bad">{Math.abs(daysUntil(p.expectedDate))}d late</Tag>
                      : <Tag tone="mute">due {dmy(p.expectedDate)}</Tag>
                  )}
                  <button onClick={() => loadPo(p.id)}
                    className="btn-primary ml-auto rounded-md px-3 py-1.5 text-[12px] font-semibold text-white">
                    Receive
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Booked in ─────────────────────────────────────────────────────── */}
      <section data-rise className="surface overflow-hidden">
        <div className="border-b border-[var(--p-border)] px-5 py-3.5">
          <h3 className="text-[13.5px] font-semibold text-[var(--p-ink)]">Recent deliveries</h3>
          <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Last 60 days. A receipt is never edited - it&apos;s the record of what arrived.</p>
        </div>
        {!recent.length && !loading ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-[var(--p-muted)]">Nothing received yet.</p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {recent.map((g, i) => (
              <button key={g.id} onClick={() => openGrn(g.id)}
                className="prow flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 text-left"
                style={{ ["--d" as string]: `${Math.min(i, 12) * 18}ms` }}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
                  g.mismatch ? "bg-[var(--p-amber-soft)] text-[#8a6414]" : "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"
                }`}>
                  <Icon name="box" size={16} />
                </span>
                <div className="min-w-[170px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="doc">{g.grnNumber}</span>
                    {g.poNumber && <Tag tone="mute">{g.poNumber}</Tag>}
                    {g.mismatch && <Tag tone="warn">Invoice differs</Tag>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                    {g.supplierName} · {g.lines} line{g.lines === 1 ? "" : "s"} · {dmyFromISO(g.createdAt)} · {g.receivedByName}
                    {g.invoiceNo && <> · inv <span className="num">{g.invoiceNo}</span></>}
                  </div>
                </div>
                <div className="text-right">
                  <span className="lbl">Value in</span>
                  <span className="num text-[14px] font-bold text-[var(--p-ink)]">{inr(g.receivedValue, 2)}</span>
                  {g.mismatch && g.variance !== null && (
                    <div className="num text-[11px] font-semibold text-[#8a6414]">
                      billed {g.variance > 0 ? "+" : ""}{inr(g.variance, 2)}
                    </div>
                  )}
                </div>
                <Icon name="chevron" size={15} />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── BOOK IN ────────────────────────────────────────────────────────── */}
      {open && (
        <Modal
          title={poId ? "Receive against a purchase order" : "Direct receipt"}
          sub={poId
            ? "Check every batch and expiry off the physical strips before posting - this can't be edited afterwards."
            : "An emergency purchase with no PO behind it. Still needs a supplier, so the batch stays traceable."}
          wide busy={busy}
          onClose={() => setOpen(false)}
          footer={
            <>
              <div className="mr-auto flex flex-wrap items-center gap-x-5 gap-y-1">
                <div>
                  <span className="lbl">Value of goods</span>
                  <span className="num text-[16px] font-bold text-[var(--p-ink)]">{inr(totals.value, 2)}</span>
                </div>
                {totals.free > 0 && (
                  <div>
                    <span className="lbl">Free units</span>
                    <span className="num text-[14px] font-semibold text-[var(--p-cyan-deep)]">+{totals.free}</span>
                  </div>
                )}
                {totals.variance !== null && (
                  <div>
                    <span className="lbl">vs their invoice</span>
                    <span className={`num text-[14px] font-semibold ${totals.mismatch ? "text-[var(--p-rose)]" : "text-[var(--p-cyan-deep)]"}`}>
                      {totals.mismatch ? `${totals.variance > 0 ? "+" : ""}${inr(totals.variance, 2)}` : "agrees"}
                    </span>
                  </div>
                )}
              </div>
              <GhostButton onClick={() => setOpen(false)} disabled={busy}>Cancel</GhostButton>
              <PrimaryButton onClick={post} disabled={busy || !canPost}>
                {busy ? <><Spinner /> Posting…</> : <><Icon name="check" size={15} /> Post receipt</>}
              </PrimaryButton>
            </>
          }
        >
          <div className="space-y-5 p-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Supplier">
                <select className={fld} value={supplierId} disabled={!!poId}
                  onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Select…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Their invoice no.">
                <input className={fld} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="On the delivery note" />
              </Field>
              <Field label="Invoice date">
                <input type="date" className={fld} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </Field>
              <Field label="Invoice total (₹)">
                <input className={fld} value={invoiceAmount} inputMode="decimal"
                  onChange={(e) => setInvoiceAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Optional" />
              </Field>
            </div>

            {/* The check nobody does by hand, done automatically. */}
            {totals.mismatch && totals.variance !== null && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--p-amber)]/30 bg-[var(--p-amber-soft)] px-4 py-3 text-[12.5px] leading-relaxed text-[#8a6414]">
                <span className="mt-0.5 shrink-0"><Icon name="alert" size={14} /></span>
                <span>
                  They&apos;ve billed <b>{inr(Math.abs(totals.variance), 2)} {totals.variance > 0 ? "more" : "less"}</b> than
                  what these lines add up to. Usually a short supply or a rate they changed without telling you.
                  You can still post it - the gap is recorded on the receipt.
                </span>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="ptable">
                <thead>
                  <tr>
                    <th style={{ minWidth: 180 }}>Medicine</th>
                    <th style={{ minWidth: 110 }}>Batch no.</th>
                    <th style={{ minWidth: 130 }}>Expiry</th>
                    <th className="r">Qty</th>
                    <th className="r">Free</th>
                    <th className="r">Rate</th>
                    <th className="r">MRP</th>
                    <th className="r">Cost/unit</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const q = Number(r.qty || 0), f = Number(r.freeQty || 0), c = Number(r.unitCost || 0);
                    const landed = q > 0 ? effectiveUnitCost(q, f, c) : 0;
                    const mrpN = Number(r.mrp || 0);
                    const expDays = r.expiryDate ? daysUntil(r.expiryDate) : null;
                    const shortDated = expDays !== null && expDays > 0 && expDays < 180;
                    const dead = expDays !== null && expDays <= 0;
                    const over = r.pending !== undefined && q > r.pending;
                    return (
                      <tr key={r.key}>
                        <td>
                          {r.purchaseOrderItemId ? (
                            <>
                              <div className="text-[13px] font-semibold">{r.name}</div>
                              <div className="text-[11px] text-[var(--p-muted)]">
                                {r.pending} {r.unit}s still due
                                {over && <span className="font-semibold text-[var(--p-amber)]"> · receiving {q - (r.pending ?? 0)} extra</span>}
                              </div>
                            </>
                          ) : (
                            <select className={fld} value={r.medicineId}
                              onChange={(e) => {
                                const m = meds.find((x) => x.id === e.target.value);
                                setRow(r.key, { medicineId: e.target.value, name: m?.name ?? "", unit: m?.unit ?? "unit", mrp: r.mrp || (m?.mrp ?? "") });
                              }}>
                              <option value="">Select…</option>
                              {meds.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          )}
                        </td>
                        <td>
                          <input className={`${fld} num py-1.5`} value={r.batchNo}
                            onChange={(e) => setRow(r.key, { batchNo: e.target.value.toUpperCase() })} placeholder="On the strip" />
                        </td>
                        <td>
                          <input type="date" className={`${fld} py-1.5 ${dead ? "border-[var(--p-rose)]" : ""}`} value={r.expiryDate}
                            onChange={(e) => setRow(r.key, { expiryDate: e.target.value })} />
                          {dead && <div className="mt-1 text-[10.5px] font-semibold text-[var(--p-rose)]">Expired - send it back</div>}
                          {shortDated && <div className="mt-1 text-[10.5px] font-semibold text-[#8a6414]">{Math.round(expDays / 30)} mo left</div>}
                        </td>
                        <td className="r"><input className={`${fld} num w-[74px] py-1.5 text-right`} value={r.qty} inputMode="numeric"
                          onChange={(e) => setRow(r.key, { qty: e.target.value.replace(/\D/g, "") })} /></td>
                        <td className="r"><input className={`${fld} num w-[62px] py-1.5 text-right`} value={r.freeQty} inputMode="numeric"
                          onChange={(e) => setRow(r.key, { freeQty: e.target.value.replace(/\D/g, "") })} placeholder="0" /></td>
                        <td className="r"><input className={`${fld} num w-[82px] py-1.5 text-right`} value={r.unitCost} inputMode="decimal"
                          onChange={(e) => setRow(r.key, { unitCost: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                        <td className="r"><input className={`${fld} num w-[82px] py-1.5 text-right`} value={r.mrp} inputMode="decimal"
                          onChange={(e) => setRow(r.key, { mrp: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                        <td className="r">
                          {/* Free goods folded in - the number the margin is really made on. */}
                          <div className="num text-[13px] font-semibold text-[var(--p-ink)]">{landed > 0 ? inr(landed, 2) : "-"}</div>
                          {landed > 0 && mrpN > 0 && (
                            <div className={`num text-[10.5px] font-semibold ${mrpN > landed ? "text-[var(--p-cyan-deep)]" : "text-[var(--p-rose)]"}`}>
                              {mrpN > landed ? `${Math.round(((mrpN - landed) / mrpN) * 1000) / 10}% margin` : "below cost"}
                            </div>
                          )}
                        </td>
                        <td className="r">
                          <button onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                            aria-label="Remove line"
                            className="grid h-7 w-7 place-items-center rounded-md text-[var(--p-muted)] transition-colors hover:bg-[var(--p-rose-soft)] hover:text-[var(--p-rose)]">
                            <Icon name="x" size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <GhostButton onClick={() => setRows((rs) => [...rs, newRow()])}>
                <Icon name="plus" size={13} /> Add a line
              </GhostButton>
              <span className="text-[12px] text-[var(--p-muted)]">
                {totals.units} unit{totals.units === 1 ? "" : "s"} across {rows.length} line{rows.length === 1 ? "" : "s"}
                {totals.free > 0 && <> · {totals.free} free</>}
              </span>
            </div>

            <Field label="Notes">
              <textarea className={`${fld} min-h-[52px]`} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything odd about the delivery - a torn carton, a missing line, a cold-chain break…" />
            </Field>

            <p className="rounded-lg bg-[var(--p-blue-soft)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--p-blue-deep)]">
              <b>Cost/unit spreads free goods across the whole batch.</b> 10 at ₹100 with 1 free is 11 units for ₹1,000 -
              ₹90.91 each, not ₹100. That&apos;s the figure the shelf stores, so the pharmacy&apos;s profit numbers are the real ones.
            </p>
          </div>
        </Modal>
      )}

      {/* ── VIEW A RECEIPT ────────────────────────────────────────────────── */}
      {view && (
        <Modal
          title={view.grnNumber}
          sub={`${view.supplier.name} · received ${dmyFromISO(view.createdAt)} by ${view.receivedByName}`}
          wide
          onClose={() => setView(null)}
          footer={<GhostButton onClick={() => setView(null)}>Close</GhostButton>}
        >
          <div className="space-y-5 p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--p-border)] px-4 py-3">
                <div className="lbl">Value received</div>
                <div className="num text-[18px] font-bold text-[var(--p-ink)]">{inr(view.receivedValue, 2)}</div>
              </div>
              <div className="rounded-lg border border-[var(--p-border)] px-4 py-3">
                <div className="lbl">They invoiced</div>
                <div className="num text-[18px] font-bold text-[var(--p-ink)]">{view.invoiceAmount ? inr(view.invoiceAmount, 2) : "-"}</div>
                {view.invoiceNo && <div className="num mt-0.5 text-[11px] text-[var(--p-muted)]">{view.invoiceNo}{view.invoiceDate && ` · ${dmy(view.invoiceDate)}`}</div>}
              </div>
              <div className={`rounded-lg border px-4 py-3 ${view.mismatch ? "border-[var(--p-rose)]/30 bg-[var(--p-rose-soft)]" : "border-[var(--p-border)]"}`}>
                <div className="lbl">Difference</div>
                <div className={`num text-[18px] font-bold ${view.mismatch ? "text-[var(--p-rose)]" : "text-[var(--p-ink)]"}`}>
                  {view.variance === null ? "-" : `${view.variance > 0 ? "+" : ""}${inr(view.variance, 2)}`}
                </div>
                {view.mismatch && <div className="mt-0.5 text-[11px] font-semibold text-[var(--p-rose)]">Worth querying</div>}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="ptable">
                <thead>
                  <tr>
                    <th>Medicine</th><th>Batch</th><th>Expiry</th>
                    <th className="r">Qty</th><th className="r">Free</th>
                    <th className="r">Rate</th><th className="r">Cost/unit</th><th className="r">MRP</th><th className="r">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {view.items.map((i) => (
                    <tr key={i.id}>
                      <td className="font-semibold">{i.name}</td>
                      <td className="num">{i.batchNo}</td>
                      <td className="num">{dmy(i.expiryDate)}</td>
                      <td className="r num">{i.qty}</td>
                      <td className="r num text-[var(--p-cyan-deep)]">{i.freeQty || "-"}</td>
                      <td className="r num">{inr(i.unitCost, 2)}</td>
                      <td className="r num font-semibold">{inr(i.landedCost, 2)}</td>
                      <td className="r num">{inr(i.mrp, 2)}</td>
                      <td className={`r num font-semibold ${(i.marginPct ?? 0) > 0 ? "text-[var(--p-cyan-deep)]" : "text-[var(--p-rose)]"}`}>
                        {i.marginPct === null ? "-" : `${i.marginPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {view.notes && (
              <p className="rounded-lg bg-[var(--p-bg)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--p-text)]">{view.notes}</p>
            )}
          </div>
        </Modal>
      )}

      {!loading && !openPos.length && !recent.length && (
        <div className="mt-5">
          <EmptyState
            icon="inbox"
            title="Nothing has been received yet"
            hint="Add a supplier, raise a purchase order from the reorder list, then book the delivery in here when it turns up."
          />
        </div>
      )}
    </PortalScroll>
  );
}
