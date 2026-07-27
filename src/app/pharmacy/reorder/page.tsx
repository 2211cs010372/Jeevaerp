"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import {
  EmptyState, ErrorNote, Flash, GhostButton, PROC_CSS, PageHead, Tag, fld, inr,
} from "@/components/portal/pharmacy/procurement-ui";
import { api, ApiClientError } from "@/lib/api-client";

interface Line {
  medicineId: string; name: string; unit: string;
  /** On the shelf, in dispensing units (tablets, ml). */
  inStock: number;
  /** Dispensing units per pack, and the label it came from. Orders are packs. */
  packSize: number; packLabel: string | null;
  reorderThreshold: number; reorderQty: number | null;
  /** ORDER QUANTITY, in PACKS. suggestedUnits is what those packs contain. */
  onOrder: number; suggestedQty: number; suggestedUnits: number;
  lastUnitCost: string | null; gstRatePct: string;
  supplierId: string | null; supplierName: string | null;
  outOfStock: boolean;
}
interface Group { supplierId: string | null; supplierName: string; lines: Line[]; estimatedValue: string }

/** Per-line editable state, keyed by medicine id. */
interface Draft { qty: string; cost: string; on: boolean }

export default function ReorderPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [expected, setExpected] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ suppliers: Group[]; totalLines: number }>("/pharmacy/reorder");
      setGroups(r.suppliers);
      // Pre-tick everything with a supplier: the default action on this screen
      // is "order the obvious things", not "start from nothing".
      const d: Record<string, Draft> = {};
      for (const g of r.suppliers) {
        for (const l of g.lines) {
          d[l.medicineId] = {
            qty: String(l.suggestedQty),
            cost: l.lastUnitCost ?? "",
            on: g.supplierId !== null,
          };
        }
      }
      setDrafts(d);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't work out what to reorder.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const toggleGroup = (g: Group, on: boolean) =>
    setDrafts((d) => {
      const next = { ...d };
      for (const l of g.lines) next[l.medicineId] = { ...next[l.medicineId], on };
      return next;
    });

  /** What's actually selected, and what it comes to. */
  const selection = useMemo(() => {
    const out: { group: Group; lines: { line: Line; qty: number; cost: number }[]; value: number }[] = [];
    let total = 0, count = 0;
    for (const g of groups) {
      const picked = g.lines
        .map((line) => {
          const d = drafts[line.medicineId];
          const qty = Number(d?.qty || 0);
          const cost = Number(d?.cost || 0);
          return d?.on && qty > 0 ? { line, qty, cost } : null;
        })
        .filter((x): x is { line: Line; qty: number; cost: number } => x !== null);
      if (!picked.length) continue;
      const value = picked.reduce((t, p) => t + p.qty * p.cost, 0);
      total += value; count += picked.length;
      out.push({ group: g, lines: picked, value });
    }
    return { groups: out, total, count };
  }, [groups, drafts]);

  /** Orderable = has a supplier. Everything else is a catalog gap, flagged below. */
  const orderable = selection.groups.filter((s) => s.group.supplierId !== null);
  const unassigned = groups.find((g) => g.supplierId === null);

  async function raise(send: boolean) {
    if (!orderable.length) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ created: { poNumber: string; supplier: string; lines: number; totalAmount: string }[] }>(
        "/pharmacy/reorder",
        {
          send,
          groups: orderable.map((s) => ({
            supplierId: s.group.supplierId!,
            expectedDate: expected || undefined,
            items: s.lines.map((p) => ({
              medicineId: p.line.medicineId,
              qtyOrdered: p.qty,
              unitCost: p.cost,
              gstRatePct: Number(p.line.gstRatePct),
            })),
          })),
        }
      );
      const n = r.created.length;
      setFlash(
        `${n} purchase order${n === 1 ? "" : "s"} ${send ? "sent" : "drafted"}: ${r.created.map((c) => `${c.poNumber} (${c.supplier})`).join(", ")}.`
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not raise the orders.");
    } finally { setBusy(false); }
  }

  return (
    <PortalScroll>
      <style>{PROC_CSS}</style>

      <PageHead
        title="What to reorder"
        blurb="Everything at or below its reorder line, priced at the rate you last paid and grouped by distributor. Stock already on an open order is subtracted, so nothing gets ordered twice."
      >
        <Link href="/purchase-orders" className="seg">View orders</Link>
      </PageHead>

      {flash && <Flash text={flash} onClose={() => setFlash(null)} />}
      {error && <ErrorNote text={error} />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Working out what&apos;s short…</div>
      ) : !groups.length ? (
        <EmptyState
          icon="check"
          title="Nothing needs ordering"
          hint="Every medicine is above its reorder line, or already has stock on the way. This screen is empty because there's nothing to decide."
        />
      ) : (
        <>
          {groups.map((g, gi) => {
            const allOn = g.lines.every((l) => drafts[l.medicineId]?.on);
            const noSupplier = g.supplierId === null;
            return (
              <section key={g.supplierId ?? "none"} data-rise className="surface mb-4 overflow-hidden">
                <div className={`flex flex-wrap items-center gap-3 border-b border-[var(--p-border)] px-5 py-3.5 ${noSupplier ? "bg-[var(--p-amber-soft)]" : "bg-[var(--p-bg)]"}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
                    noSupplier ? "bg-[var(--p-amber)]/20 text-[#8a6414]" : "bg-[var(--p-blue-soft)] text-[var(--p-blue)]"
                  }`}>
                    <Icon name={noSupplier ? "alert" : "truck"} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-[var(--p-ink)]">{g.supplierName}</div>
                    <div className="text-[11.5px] text-[var(--p-muted)]">
                      {g.lines.length} medicine{g.lines.length === 1 ? "" : "s"} short
                      {g.lines.some((l) => l.outOfStock) && (
                        <> · <span className="font-semibold text-[var(--p-rose)]">{g.lines.filter((l) => l.outOfStock).length} out of stock right now</span></>
                      )}
                    </div>
                  </div>
                  {!noSupplier && (
                    <button onClick={() => toggleGroup(g, !allOn)} className="seg">
                      {allOn ? "Clear all" : "Select all"}
                    </button>
                  )}
                </div>

                {noSupplier && (
                  <p className="border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-5 py-2.5 text-[12px] leading-relaxed text-[#8a6414]">
                    These have no preferred supplier set, so there&apos;s nobody to send an order to.
                    Set one on each medicine in <Link href="/stock" className="font-semibold underline">Stock</Link>, and they&apos;ll join a distributor&apos;s order next time.
                  </p>
                )}

                <div className="overflow-x-auto">
                  <table className="ptable">
                    <thead>
                      <tr>
                        <th style={{ width: 34 }} />
                        <th>Medicine</th>
                        <th className="r">On shelf<span className="th-sub">units</span></th>
                        <th className="r">Coming<span className="th-sub">packs</span></th>
                        <th className="r">Order<span className="th-sub">packs</span></th>
                        <th className="r">Rate<span className="th-sub">per pack</span></th>
                        <th className="r">Line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.lines.map((l, i) => {
                        const d = drafts[l.medicineId] ?? { qty: "0", cost: "", on: false };
                        const value = Number(d.qty || 0) * Number(d.cost || 0);
                        return (
                          <tr key={l.medicineId} className="prow" style={{ ["--d" as string]: `${Math.min(gi * 3 + i, 12) * 18}ms` }}>
                            <td>
                              <input type="checkbox" checked={d.on} disabled={noSupplier}
                                onChange={(e) => set(l.medicineId, { on: e.target.checked })}
                                className="h-4 w-4 accent-[var(--p-blue)] disabled:opacity-30" />
                            </td>
                            <td>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{l.name}</span>
                                {l.outOfStock && <Tag tone="bad">Out of stock</Tag>}
                              </div>
                              <div className="text-[11px] text-[var(--p-muted)]">
                                reorder line {l.reorderThreshold} {l.unit}s
                                {l.packSize > 1 && <> · pack of {l.packLabel || l.packSize}</>}
                                {l.lastUnitCost === null && <> · <span className="font-semibold text-[var(--p-amber)]">never bought before - set a rate</span></>}
                              </div>
                            </td>
                            <td className={`r num font-semibold ${l.outOfStock ? "text-[var(--p-rose)]" : "text-[var(--p-amber)]"}`}>
                              {l.inStock}
                              {l.packSize > 1 && (
                                <div className="text-[9.5px] font-semibold text-[var(--p-muted)]">
                                  {Math.floor(l.inStock / l.packSize)} × {l.packLabel || l.packSize}
                                  {l.inStock % l.packSize > 0 && ` + ${l.inStock % l.packSize}`}
                                </div>
                              )}
                            </td>
                            <td className="r num text-[var(--p-muted)]">{l.onOrder > 0 ? l.onOrder : "-"}</td>
                            <td className="r">
                              {/* PACKS - a distributor sells strips, not loose
                                  tablets. The units those packs contain are
                                  shown underneath so the shortfall stays legible. */}
                              <input className={`${fld} num w-[86px] py-1.5 text-right`} value={d.qty} inputMode="numeric"
                                onChange={(e) => set(l.medicineId, { qty: e.target.value.replace(/\D/g, "") })} />
                              {l.packSize > 1 && (
                                <div className="mt-0.5 text-[9.5px] text-[var(--p-muted)]">
                                  = {(Number(d.qty || 0) * l.packSize).toLocaleString("en-IN")} {l.unit}s
                                </div>
                              )}
                            </td>
                            <td className="r">
                              <input className={`${fld} num w-[92px] py-1.5 text-right`} value={d.cost} inputMode="decimal"
                                placeholder="0.00"
                                onChange={(e) => set(l.medicineId, { cost: e.target.value.replace(/[^\d.]/g, "") })} />
                            </td>
                            <td className="r num font-semibold">{value > 0 ? inr(value, 2) : "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          {/* ── The bar that turns all of this into orders ─────────────────── */}
          {orderable.length > 0 && (
            <section data-rise className="surface sticky bottom-4 z-20 mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 shadow-[0_10px_30px_-12px_rgba(9,26,52,.25)]">
              <div>
                <div className="lbl">Selected</div>
                <div className="text-[13px] font-semibold text-[var(--p-ink)]">
                  {selection.count} line{selection.count === 1 ? "" : "s"} · {orderable.length} order{orderable.length === 1 ? "" : "s"}
                </div>
              </div>
              <div>
                <div className="lbl">Estimated value</div>
                <div className="num text-[19px] font-bold text-[var(--p-ink)]">{inr(selection.total, 2)}</div>
              </div>
              <div>
                <div className="lbl">Expected delivery</div>
                <input type="date" className={`${fld} w-[150px] py-1.5`} value={expected} onChange={(e) => setExpected(e.target.value)} />
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <GhostButton onClick={() => raise(false)} disabled={busy}>
                  {busy ? <><Spinner size={13} /> Working…</> : "Save as drafts"}
                </GhostButton>
                <PrimaryButton onClick={() => raise(true)} disabled={busy}>
                  {busy ? <><Spinner /> Working…</> : <><Icon name="truck" size={15} /> Raise &amp; send</>}
                </PrimaryButton>
              </div>
            </section>
          )}

          {unassigned && orderable.length === 0 && (
            <ErrorNote text="Nothing here can be ordered yet - none of these medicines has a preferred supplier. Set one in Stock and come back." />
          )}
        </>
      )}
    </PortalScroll>
  );
}
