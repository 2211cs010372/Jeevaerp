"use client";

import { useCallback, useEffect, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import {
  EmptyState, ErrorNote, Flash, GhostButton, Modal, PROC_CSS, PageHead, Tag,
  dmyFromISO, fld, inr,
} from "@/components/portal/pharmacy/procurement-ui";
import { api, ApiClientError } from "@/lib/api-client";

interface Supplier {
  id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null;
  address: string | null; gstin: string | null; drugLicenseNo: string | null;
  paymentTermDays: number; active: boolean; notes: string | null;
  openOrders: number; medicinesSupplied: number; lastReceiptAt: string | null;
}

interface Detail {
  id: string; name: string; purchasedTotal: string; creditOutstanding: string;
  purchaseOrders: { id: string; poNumber: string; status: string; totalAmount: string; createdAt: string }[];
  goodsReceipts: { id: string; grnNumber: string; invoiceNo: string | null; receivedValue: string; createdAt: string }[];
  purchaseReturns: { id: string; returnNo: string; status: string; claimValue: string; creditedAmount: string | null }[];
}

const blank = {
  id: "", name: "", contactPerson: "", phone: "", email: "", address: "",
  gstin: "", drugLicenseNo: "", paymentTermDays: "30", active: true, notes: "",
};

export default function SuppliersPage() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [edit, setEdit] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (showInactive) p.set("all", "1");
      const r = await api.get<{ suppliers: Supplier[] }>(`/pharmacy/suppliers${p.toString() ? `?${p}` : ""}`);
      setRows(r.suppliers);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load suppliers.");
    } finally { setLoading(false); }
  }, [q, showInactive]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function save() {
    if (!edit) return;
    setBusy(true); setError(null);
    try {
      await api.post("/pharmacy/suppliers", {
        id: edit.id || undefined,
        name: edit.name,
        contactPerson: edit.contactPerson || undefined,
        phone: edit.phone || undefined,
        email: edit.email || undefined,
        address: edit.address || undefined,
        gstin: edit.gstin || undefined,
        drugLicenseNo: edit.drugLicenseNo || undefined,
        paymentTermDays: Number(edit.paymentTermDays || 30),
        active: edit.active,
        notes: edit.notes || undefined,
      });
      setFlash(`${edit.name} saved.`);
      setEdit(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the supplier.");
    } finally { setBusy(false); }
  }

  async function openDetail(s: Supplier) {
    setDetailLoading(true); setDetail(null);
    try {
      const r = await api.get<{ supplier: Detail }>(`/pharmacy/suppliers/${s.id}`);
      setDetail(r.supplier);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load that supplier.");
    } finally { setDetailLoading(false); }
  }

  const openEdit = (s: Supplier) => setEdit({
    id: s.id, name: s.name, contactPerson: s.contactPerson ?? "", phone: s.phone ?? "",
    email: s.email ?? "", address: s.address ?? "", gstin: s.gstin ?? "",
    drugLicenseNo: s.drugLicenseNo ?? "", paymentTermDays: String(s.paymentTermDays),
    active: s.active, notes: s.notes ?? "",
  });

  return (
    <PortalScroll>
      <style>{PROC_CSS}</style>

      <PageHead
        title="Suppliers"
        blurb="The distributors stock comes from. Their drug licence number is what makes a batch on your shelf traceable, so it belongs here rather than on a note taped to the invoice."
      >
        <PrimaryButton onClick={() => setEdit({ ...blank })}><Icon name="plus" size={15} /> Add supplier</PrimaryButton>
      </PageHead>

      <div data-rise className="mb-4 flex flex-wrap items-center gap-2">
        <div className="surface flex min-w-[260px] flex-1 items-center gap-2 px-3.5 py-2.5 sm:max-w-md">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or contact…"
            className="w-full bg-transparent text-sm outline-none" />
          {loading && <Spinner size={14} />}
        </div>
        <button onClick={() => setShowInactive((v) => !v)} className={`seg ${showInactive ? "seg-on" : ""}`}>
          Show discontinued
        </button>
      </div>

      {flash && <Flash text={flash} onClose={() => setFlash(null)} />}
      {error && <ErrorNote text={error} />}

      {!rows.length && !loading ? (
        <EmptyState
          icon="truck"
          title="No suppliers yet"
          hint="Add the distributors you buy from. Once one exists you can raise a purchase order and book deliveries in against it."
        />
      ) : (
        <section data-rise className="surface overflow-hidden">
          <div className="divide-y divide-[var(--p-border)]">
            {rows.map((s, i) => (
              <div key={s.id} className="prow px-5 py-4" style={{ ["--d" as string]: `${Math.min(i, 12) * 22}ms` }}>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] ${
                    s.active ? "bg-[var(--p-blue-soft)] text-[var(--p-blue)]" : "bg-[var(--p-bg)] text-[var(--p-muted)]"
                  }`}>
                    <Icon name="truck" size={17} />
                  </span>

                  <div className="min-w-[180px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--p-ink)]">{s.name}</span>
                      {!s.active && <Tag tone="mute">Discontinued</Tag>}
                      {s.openOrders > 0 && <Tag tone="info">{s.openOrders} open order{s.openOrders === 1 ? "" : "s"}</Tag>}
                    </div>
                    <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                      {s.contactPerson || "No contact named"}
                      {s.phone && <> · <span className="num">{s.phone}</span></>}
                      {s.lastReceiptAt && <> · last delivery {dmyFromISO(s.lastReceiptAt)}</>}
                    </div>
                  </div>

                  <div className="min-w-[120px]">
                    <span className="lbl">Drug licence</span>
                    {s.drugLicenseNo
                      ? <span className="doc">{s.drugLicenseNo}</span>
                      : <span className="text-[12px] font-semibold text-[var(--p-amber)]">Not recorded</span>}
                  </div>

                  <div className="min-w-[110px]">
                    <span className="lbl">GSTIN</span>
                    {s.gstin ? <span className="doc">{s.gstin}</span> : <span className="text-[12px] text-[var(--p-muted)]">-</span>}
                  </div>

                  <div className="min-w-[74px]">
                    <span className="lbl">Terms</span>
                    <span className="num text-[13px] font-semibold text-[var(--p-ink)]">{s.paymentTermDays}d</span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <GhostButton onClick={() => openDetail(s)}>History</GhostButton>
                    <GhostButton onClick={() => openEdit(s)}>Edit</GhostButton>
                  </div>
                </div>

                {/* A supplier with no licence on file can't answer a drug inspector. */}
                {s.active && !s.drugLicenseNo && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[11.5px] leading-relaxed text-[#8a6414]">
                    <Icon name="alert" size={13} />
                    <span>No drug licence recorded. Every batch received from {s.name} traces back to a supplier nobody can verify.</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── ADD / EDIT ─────────────────────────────────────────────────────── */}
      {edit && (
        <Modal
          title={edit.id ? "Edit supplier" : "Add supplier"}
          sub="Licence and GSTIN are what make a purchase auditable."
          busy={busy}
          onClose={() => setEdit(null)}
          footer={
            <>
              <GhostButton onClick={() => setEdit(null)} disabled={busy}>Cancel</GhostButton>
              <PrimaryButton onClick={save} disabled={busy || edit.name.trim().length < 2}>
                {busy ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> Save</>}
              </PrimaryButton>
            </>
          }
        >
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <Field label="Supplier name" span required>
              <input className={fld} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus placeholder="e.g. Sri Balaji Pharma Distributors" />
            </Field>
            <Field label="Contact person">
              <input className={fld} value={edit.contactPerson} onChange={(e) => setEdit({ ...edit, contactPerson: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className={fld} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} inputMode="tel" />
            </Field>
            <Field label="Email">
              <input className={fld} value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} inputMode="email" />
            </Field>
            <Field label="Payment terms (days)">
              <input className={fld} value={edit.paymentTermDays} inputMode="numeric"
                onChange={(e) => setEdit({ ...edit, paymentTermDays: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label="GSTIN">
              <input className={fld} value={edit.gstin} onChange={(e) => setEdit({ ...edit, gstin: e.target.value.toUpperCase() })} placeholder="29ABCDE1234F1Z5" />
            </Field>
            <Field label="Drug licence no.">
              <input className={fld} value={edit.drugLicenseNo} onChange={(e) => setEdit({ ...edit, drugLicenseNo: e.target.value.toUpperCase() })} placeholder="Form 20B / 21B" />
            </Field>
            <Field label="Address" span>
              <textarea className={`${fld} min-h-[64px]`} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
            <Field label="Notes" span>
              <textarea className={`${fld} min-h-[52px]`} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Delivery days, minimum order, who to call when short-supplied…" />
            </Field>
          </div>

          {edit.id && (
            <label className="mx-6 mb-5 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--p-border)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--p-text)]">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-[var(--p-blue)]" />
              <span>Still buying from them. Untick to discontinue - they disappear from new orders, but every past delivery keeps its trail.</span>
            </label>
          )}
        </Modal>
      )}

      {/* ── HISTORY ────────────────────────────────────────────────────────── */}
      {(detail || detailLoading) && (
        <Modal
          title={detail ? detail.name : "Loading…"}
          sub="Everything we've bought from them, and everything they still owe."
          wide
          onClose={() => { setDetail(null); setDetailLoading(false); }}
          footer={<GhostButton onClick={() => { setDetail(null); setDetailLoading(false); }}>Close</GhostButton>}
        >
          {detailLoading || !detail ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
          ) : (
            <div className="space-y-6 p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[var(--p-border)] px-4 py-3">
                  <div className="lbl">Purchased (last 20 receipts)</div>
                  <div className="num text-[20px] font-bold text-[var(--p-ink)]">{inr(detail.purchasedTotal)}</div>
                </div>
                <div className="rounded-lg border border-[var(--p-border)] px-4 py-3">
                  <div className="lbl">Credit they still owe us</div>
                  <div className={`num text-[20px] font-bold ${Number(detail.creditOutstanding) > 0 ? "text-[var(--p-amber)]" : "text-[var(--p-ink)]"}`}>
                    {inr(detail.creditOutstanding)}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--p-muted)]">Recent deliveries</h4>
                {!detail.goodsReceipts.length ? (
                  <p className="py-4 text-[12.5px] text-[var(--p-muted)]">Nothing received from them yet.</p>
                ) : (
                  <div className="overflow-x-auto"><table className="ptable">
                    <thead><tr><th>GRN</th><th>Their invoice</th><th>Date</th><th className="r">Value</th></tr></thead>
                    <tbody>
                      {detail.goodsReceipts.map((g) => (
                        <tr key={g.id}>
                          <td><span className="doc">{g.grnNumber}</span></td>
                          <td className="num text-[12px] text-[var(--p-muted)]">{g.invoiceNo || "-"}</td>
                          <td className="num text-[12px]">{dmyFromISO(g.createdAt)}</td>
                          <td className="r num font-semibold">{inr(g.receivedValue, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </div>

              <div>
                <h4 className="mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--p-muted)]">Purchase orders</h4>
                {!detail.purchaseOrders.length ? (
                  <p className="py-4 text-[12.5px] text-[var(--p-muted)]">No orders raised on them yet.</p>
                ) : (
                  <div className="overflow-x-auto"><table className="ptable">
                    <thead><tr><th>PO</th><th>Status</th><th>Raised</th><th className="r">Value</th></tr></thead>
                    <tbody>
                      {detail.purchaseOrders.map((p) => (
                        <tr key={p.id}>
                          <td><span className="doc">{p.poNumber}</span></td>
                          <td className="text-[12px] text-[var(--p-muted)]">{p.status.replace(/_/g, " ").toLowerCase()}</td>
                          <td className="num text-[12px]">{dmyFromISO(p.createdAt)}</td>
                          <td className="r num font-semibold">{inr(p.totalAmount, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </div>

              {detail.purchaseReturns.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--p-muted)]">Returns &amp; credit</h4>
                  <div className="overflow-x-auto"><table className="ptable">
                    <thead><tr><th>Note</th><th>Status</th><th className="r">Claimed</th><th className="r">Credited</th></tr></thead>
                    <tbody>
                      {detail.purchaseReturns.map((r) => (
                        <tr key={r.id}>
                          <td><span className="doc">{r.returnNo}</span></td>
                          <td className="text-[12px] text-[var(--p-muted)]">{r.status.toLowerCase()}</td>
                          <td className="r num">{inr(r.claimValue, 2)}</td>
                          <td className="r num font-semibold">{r.creditedAmount ? inr(r.creditedAmount, 2) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </PortalScroll>
  );
}
