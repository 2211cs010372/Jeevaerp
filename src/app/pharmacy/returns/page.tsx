"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import {
  EmptyState, ErrorNote, Flash, GhostButton, Modal, PROC_CSS, PageHead, StatStrip, Tag,
  daysUntil, dmy, dmyFromISO, fld, inr, returnStatus,
} from "@/components/portal/pharmacy/procurement-ui";
import { api, ApiClientError } from "@/lib/api-client";

interface Supplier { id: string; name: string }
interface Ret {
  id: string; returnNo: string; status: string; reason: string;
  claimValue: string; creditedAmount: string | null; shortfall: string | null; creditNoteNo: string | null;
  createdAt: string; sentAt: string | null; settledAt: string | null;
  supplierId: string; supplierName: string; createdByName: string;
  items: { name: string; unit: string; batchNo: string; qty: number }[];
}
interface Med { id: string; name: string; unit: string; expiredQty: number; nearestExpiry: string | null }
interface Batch {
  id: string; batchNo: string; expiryDate: string; quantity: number; rate: string | null;
  expired: boolean; supplierId: string | null; supplierName: string | null;
}

/** Fixed reasons - a credit note is disputed on the wording, so don't invite prose. */
const REASONS = [
  "Expiry credit - near-dated stock",
  "Expired stock",
  "Damaged in transit",
  "Wrong item supplied",
  "Product recall",
  "Excess / not ordered",
];

type Tab = "SENT" | "DRAFT" | "CREDITED" | "ALL";

export default function ReturnsPage() {
  const [rows, setRows] = useState<Ret[]>([]);
  const [tab, setTab] = useState<Tab>("SENT");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // build a return
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [meds, setMeds] = useState<Med[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState("");
  const [medId, setMedId] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [picked, setPicked] = useState<Record<string, { batch: Batch; medName: string; unit: string; qty: string }>>({});

  // settle a claim
  const [settling, setSettling] = useState<Ret | null>(null);
  const [creditNoteNo, setCreditNoteNo] = useState("");
  const [creditedAmount, setCreditedAmount] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ returns: Ret[] }>(`/pharmacy/returns?status=${tab}`);
      setRows(r.returns); setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load returns.");
    } finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      api.get<{ suppliers: Supplier[] }>("/pharmacy/suppliers"),
      api.get<{ medicines: Med[] }>("/pharmacy/medicines"),
    ]).then(([s, m]) => { setSuppliers(s.suppliers); setMeds(m.medicines); }).catch(() => {});
  }, [open]);

  async function pickMedicine(id: string) {
    setMedId(id); setBatches([]);
    if (!id) return;
    try {
      const r = await api.get<{ batches: Batch[] }>(`/pharmacy/medicines/${id}/batches`);
      setBatches(r.batches.filter((b) => b.quantity > 0));
    } catch { setBatches([]); }
  }

  function toggleBatch(b: Batch) {
    const med = meds.find((m) => m.id === medId);
    setPicked((p) => {
      const next = { ...p };
      if (next[b.id]) delete next[b.id];
      else next[b.id] = { batch: b, medName: med?.name ?? "", unit: med?.unit ?? "unit", qty: String(b.quantity) };
      return next;
    });
    // A batch carries its own supplier - default the claim to whoever sold it.
    if (b.supplierId && !supplierId) setSupplierId(b.supplierId);
  }

  const claimValue = useMemo(
    () => Object.values(picked).reduce((t, p) => t + Number(p.qty || 0) * Number(p.batch.rate ?? 0), 0),
    [picked]
  );
  const unpriced = Object.values(picked).filter((p) => p.batch.rate === null);
  const wrongSupplier = Object.values(picked).filter((p) => p.batch.supplierId && supplierId && p.batch.supplierId !== supplierId);

  function reset() {
    setOpen(false); setSupplierId(""); setReason(REASONS[0]); setNotes("");
    setMedId(""); setBatches([]); setPicked({});
  }

  async function create(send: boolean) {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ return: { returnNo: string; claimValue: string } }>("/pharmacy/returns", {
        supplierId, reason, notes: notes || undefined, send,
        items: Object.values(picked).map((p) => ({ batchId: p.batch.id, qty: Number(p.qty) })),
      });
      setFlash(`${r.return.returnNo} raised - ${inr(r.return.claimValue, 2)} claimed. The stock has left the shelf.`);
      reset(); await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not raise the return.");
    } finally { setBusy(false); }
  }

  async function settle(status: "SENT" | "CREDITED" | "REJECTED") {
    if (!settling) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/pharmacy/returns/${settling.id}`, {
        status,
        creditNoteNo: status === "CREDITED" ? creditNoteNo || undefined : undefined,
        creditedAmount: status === "CREDITED" ? Number(creditedAmount || 0) : undefined,
      });
      setFlash(
        status === "CREDITED"
          ? `${settling.returnNo} settled at ${inr(creditedAmount, 2)}.`
          : status === "SENT" ? `${settling.returnNo} marked as sent.` : `${settling.returnNo} marked refused.`
      );
      setSettling(null); setCreditNoteNo(""); setCreditedAmount("");
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "That didn't work.");
    } finally { setBusy(false); }
  }

  const awaiting = rows.filter((r) => r.status === "SENT");
  const owed = awaiting.reduce((t, r) => t + Number(r.claimValue), 0);
  const lost = rows.filter((r) => r.shortfall && Number(r.shortfall) > 0)
    .reduce((t, r) => t + Number(r.shortfall), 0);

  return (
    <PortalScroll>
      <style>{PROC_CSS}</style>

      <PageHead
        title="Returns to supplier"
        blurb="Near-expiry credit is a routine part of pharmacy economics, and it used to vanish here - 'returned to supplier' just dropped the shelf count and told nobody. Now it raises a claim you can chase."
      >
        <PrimaryButton onClick={() => setOpen(true)}><Icon name="undo" size={15} /> Raise a return</PrimaryButton>
      </PageHead>

      <StatStrip items={[
        { label: "Awaiting credit", value: String(awaiting.length), sub: "notes with the distributor" },
        { label: "Money owed to us", value: inr(owed), tone: owed > 0 ? "warn" : undefined, sub: "claimed, not yet credited" },
        { label: "Written down", value: inr(lost), tone: lost > 0 ? "bad" : undefined, sub: "claimed but never credited" },
        { label: "Shown", value: String(rows.length), sub: tab === "ALL" ? "all returns" : "in this tab" },
      ]} />

      <div data-rise className="mb-4 flex flex-wrap items-center gap-2">
        {(["SENT", "DRAFT", "CREDITED", "ALL"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`seg ${tab === t ? "seg-on" : ""}`}>
            {t === "SENT" ? "Awaiting credit" : t === "DRAFT" ? "Not sent" : t === "CREDITED" ? "Settled" : "All"}
          </button>
        ))}
      </div>

      {flash && <Flash text={flash} onClose={() => setFlash(null)} />}
      {error && <ErrorNote text={error} />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : !rows.length ? (
        <EmptyState
          icon="undo"
          title="Nothing here"
          hint="When stock is short-dated, damaged or wrongly supplied, raise a return - the units leave the shelf and the distributor owes you for them."
        />
      ) : (
        <section data-rise className="surface overflow-hidden">
          <div className="divide-y divide-[var(--p-border)]">
            {rows.map((r, i) => {
              const st = returnStatus(r.status);
              const short = r.shortfall && Number(r.shortfall) > 0;
              const stale = r.status === "SENT" && r.sentAt &&
                (Date.now() - new Date(r.sentAt).getTime()) / 86400000 > 45;
              return (
                <div key={r.id} className="prow" style={{ ["--d" as string]: `${Math.min(i, 12) * 20}ms` }}>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] ${
                      r.status === "CREDITED" ? "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"
                      : r.status === "REJECTED" ? "bg-[var(--p-rose-soft)] text-[var(--p-rose)]"
                      : "bg-[var(--p-amber-soft)] text-[#8a6414]"
                    }`}>
                      <Icon name="undo" size={17} />
                    </span>

                    <div className="min-w-[200px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="doc">{r.returnNo}</span>
                        <Tag tone={st.tone}>{st.label}</Tag>
                        {stale && <Tag tone="bad">Chase them</Tag>}
                      </div>
                      <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                        {r.supplierName} · {r.reason} · raised {dmyFromISO(r.createdAt)} by {r.createdByName}
                      </div>
                      <div className="mt-1 text-[11.5px] text-[var(--p-muted)]">
                        {r.items.slice(0, 3).map((it) => `${it.name} ×${it.qty} (${it.batchNo})`).join(" · ")}
                        {r.items.length > 3 && ` · +${r.items.length - 3} more`}
                      </div>
                    </div>

                    <div className="min-w-[96px] text-right">
                      <span className="lbl">Claimed</span>
                      <span className="num text-[14px] font-bold text-[var(--p-ink)]">{inr(r.claimValue, 2)}</span>
                    </div>

                    <div className="min-w-[96px] text-right">
                      <span className="lbl">Credited</span>
                      <span className={`num text-[14px] font-bold ${r.creditedAmount ? "text-[var(--p-cyan-deep)]" : "text-[var(--p-muted)]"}`}>
                        {r.creditedAmount ? inr(r.creditedAmount, 2) : "-"}
                      </span>
                      {r.creditNoteNo && <div className="num text-[10.5px] text-[var(--p-muted)]">{r.creditNoteNo}</div>}
                    </div>

                    {r.status !== "CREDITED" && r.status !== "REJECTED" && (
                      <GhostButton onClick={() => {
                        setSettling(r);
                        setCreditNoteNo(r.creditNoteNo ?? "");
                        setCreditedAmount(r.claimValue);
                      }}>
                        {r.status === "DRAFT" ? "Mark sent" : "Record credit"}
                      </GhostButton>
                    )}
                  </div>

                  {short && (
                    <div className="warnstrip warnstrip-amber">
                      <Icon name="alert" size={13} />
                      <span>
                        They credited <b>{inr(r.shortfall!, 2)} less</b> than claimed. That difference is a real loss - worth knowing before the next order goes to them.
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── RAISE A RETURN ─────────────────────────────────────────────────── */}
      {open && (
        <Modal
          title="Return stock to a supplier"
          sub="The units leave the shelf immediately and a credit claim is raised against the distributor."
          wide busy={busy}
          onClose={reset}
          footer={
            <>
              <div className="mr-auto">
                <span className="lbl">Claim value</span>
                <span className="num text-[16px] font-bold text-[var(--p-ink)]">{inr(claimValue, 2)}</span>
              </div>
              <GhostButton onClick={reset} disabled={busy}>Cancel</GhostButton>
              <GhostButton onClick={() => create(false)} disabled={busy || !supplierId || !Object.keys(picked).length}>
                Save as draft
              </GhostButton>
              <PrimaryButton onClick={() => create(true)} disabled={busy || !supplierId || !Object.keys(picked).length}>
                {busy ? <><Spinner /> Working…</> : <><Icon name="truck" size={15} /> Raise &amp; send</>}
              </PrimaryButton>
            </>
          }
        >
          <div className="space-y-5 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Send back to">
                <select className={fld} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Select supplier…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Why?">
                <select className={fld} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            </div>

            <div>
              <Field label="Pick the batches going back">
                <select className={fld} value={medId} onChange={(e) => pickMedicine(e.target.value)}>
                  <option value="">Choose a medicine…</option>
                  {meds.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.expiredQty > 0 ? ` — ${m.expiredQty} expired on shelf` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              {batches.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {batches.map((b) => {
                    const d = daysUntil(b.expiryDate);
                    const on = !!picked[b.id];
                    return (
                      <label key={b.id}
                        className={`flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3.5 py-2.5 transition-colors ${
                          on ? "border-[var(--p-blue)] bg-[var(--p-blue-soft)]" : "border-[var(--p-border)] bg-white hover:border-[var(--p-blue)]/50"
                        }`}>
                        <input type="checkbox" checked={on} onChange={() => toggleBatch(b)} className="h-4 w-4 accent-[var(--p-blue)]" />
                        <span className="num w-[100px] text-[12.5px] font-semibold">{b.batchNo}</span>
                        <span className="text-[12px] text-[var(--p-muted)]">
                          exp <span className="num">{dmy(b.expiryDate)}</span>
                          {b.expired ? <span className="ml-1 font-semibold text-[var(--p-rose)]">expired</span>
                            : d < 180 ? <span className="ml-1 font-semibold text-[#8a6414]">{Math.round(d / 30)} mo left</span> : null}
                        </span>
                        <span className="num text-[12px]">{b.quantity} on shelf</span>
                        <span className="text-[12px] text-[var(--p-muted)]">
                          {b.rate ? <>paid <span className="num">{inr(b.rate, 2)}</span></> : <span className="font-semibold text-[var(--p-amber)]">no rate on file</span>}
                        </span>
                        <span className="ml-auto text-[11.5px] text-[var(--p-muted)]">
                          {b.supplierName ?? "supplier unknown"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {Object.keys(picked).length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-[var(--p-border)]">
                <table className="ptable">
                  <thead><tr><th>Going back</th><th>Batch</th><th className="r">On shelf</th><th className="r">Returning</th><th className="r">Rate paid</th><th className="r">Claim</th><th /></tr></thead>
                  <tbody>
                    {Object.values(picked).map((p) => (
                      <tr key={p.batch.id}>
                        <td className="font-semibold">{p.medName}</td>
                        <td className="num">{p.batch.batchNo}</td>
                        <td className="r num text-[var(--p-muted)]">{p.batch.quantity}</td>
                        <td className="r">
                          <input className={`${fld} num w-[76px] py-1.5 text-right`} value={p.qty} inputMode="numeric"
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, "");
                              setPicked((prev) => ({ ...prev, [p.batch.id]: { ...prev[p.batch.id], qty: v } }));
                            }} />
                        </td>
                        <td className="r num">{p.batch.rate ? inr(p.batch.rate, 2) : "-"}</td>
                        <td className="r num font-semibold">{inr(Number(p.qty || 0) * Number(p.batch.rate ?? 0), 2)}</td>
                        <td className="r">
                          <button onClick={() => setPicked((prev) => { const n = { ...prev }; delete n[p.batch.id]; return n; })}
                            aria-label="Remove"
                            className="grid h-7 w-7 place-items-center rounded-md text-[var(--p-muted)] hover:bg-[var(--p-rose-soft)] hover:text-[var(--p-rose)]">
                            <Icon name="x" size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {unpriced.length > 0 && (
              <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[#8a6414]">
                {unpriced.length} batch{unpriced.length === 1 ? " has" : "es have"} no purchase rate recorded, so {unpriced.length === 1 ? "it claims" : "they claim"} ₹0.
                The stock still leaves the shelf. Guessing a rate from MRP is how a credit note gets disputed - agree the figure with the distributor and record it on the credit note instead.
              </p>
            )}

            {wrongSupplier.length > 0 && (
              <p className="rounded-lg bg-[var(--p-rose-soft)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--p-rose)]">
                <b>Check this.</b> {wrongSupplier.length} of the selected batch{wrongSupplier.length === 1 ? " was" : "es were"} supplied by someone else.
                A distributor won&apos;t credit stock they never sold you.
              </p>
            )}

            <Field label="Notes">
              <textarea className={`${fld} min-h-[52px]`} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Reference to their collection docket, who authorised it…" />
            </Field>
          </div>
        </Modal>
      )}

      {/* ── SETTLE ────────────────────────────────────────────────────────── */}
      {settling && (
        <Modal
          title={settling.status === "DRAFT" ? "Mark as sent" : "Record the credit note"}
          sub={`${settling.returnNo} · ${settling.supplierName} · ${inr(settling.claimValue, 2)} claimed`}
          busy={busy}
          onClose={() => setSettling(null)}
          footer={
            settling.status === "DRAFT" ? (
              <>
                <GhostButton onClick={() => setSettling(null)} disabled={busy}>Cancel</GhostButton>
                <PrimaryButton onClick={() => settle("SENT")} disabled={busy}>
                  {busy ? <><Spinner /> Saving…</> : "Mark sent"}
                </PrimaryButton>
              </>
            ) : (
              <>
                <GhostButton onClick={() => setSettling(null)} disabled={busy}>Cancel</GhostButton>
                <GhostButton tone="danger" onClick={() => settle("REJECTED")} disabled={busy}>They refused it</GhostButton>
                <PrimaryButton onClick={() => settle("CREDITED")} disabled={busy || !creditedAmount}>
                  {busy ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> Record credit</>}
                </PrimaryButton>
              </>
            )
          }
        >
          <div className="space-y-4 p-6">
            {settling.status === "DRAFT" ? (
              <p className="text-[13px] leading-relaxed text-[var(--p-text)]">
                The stock already left the shelf when this was raised. Marking it sent starts the clock on the credit -
                anything still unsettled after 45 days gets flagged for chasing.
              </p>
            ) : (
              <>
                <Field label="Their credit note no.">
                  <input className={fld} value={creditNoteNo} onChange={(e) => setCreditNoteNo(e.target.value)} autoFocus />
                </Field>
                <Field label="Amount actually credited (₹)">
                  <input className={`${fld} num`} value={creditedAmount} inputMode="decimal"
                    onChange={(e) => setCreditedAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                </Field>
                {creditedAmount && Number(creditedAmount) < Number(settling.claimValue) && (
                  <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[#8a6414]">
                    That&apos;s <b>{inr(Number(settling.claimValue) - Number(creditedAmount), 2)} short</b> of the claim.
                    Recording it honestly is the point - a distributor who routinely credits less than they owe should show up in their own history.
                  </p>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </PortalScroll>
  );
}
