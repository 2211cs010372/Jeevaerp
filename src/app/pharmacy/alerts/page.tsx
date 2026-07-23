"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pill } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api } from "@/lib/api-client";

interface Alerts {
  expiring: { batchId: string; medicine: string; batchNo: string; expiryDate: string; quantity: number; daysLeft: number }[];
  lowStock: { medicineId: string; name: string; inStock: number; reorderThreshold: number }[];
}

export default function AlertsPage() {
  const [a, setA] = useState<Alerts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Alerts>("/pharmacy/alerts").then(setA).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-end justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Stock alerts</h1>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">What to reorder, and what&apos;s about to die on the shelf.</p>
        </div>
        {/* This screen names the problem. These two are where you fix it. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/returns"
            className="inline-flex items-center gap-2 rounded-md border border-[var(--p-border-strong)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--p-ink)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="undo" size={15} /> Return for credit
          </Link>
          <Link href="/reorder"
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white">
            <Icon name="trend" size={15} /> Turn this into an order
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section data-rise className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Expiring soon</h3>
                <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Within 90 days, or already expired.</p>
              </div>
              <span className="badge">{a?.expiring.length ?? 0}</span>
            </div>
            {!a?.expiring.length ? (
              <p className="py-12 text-center text-[13px] text-[var(--p-muted)]">Nothing expiring soon.</p>
            ) : (
              <div className="divide-y divide-[var(--p-border)]">
                {a.expiring.map((e) => (
                  <div key={e.batchId} className="flex items-center justify-between px-6 py-3">
                    <div>
                      <div className="text-[13px] font-medium text-[var(--p-ink)]">{e.medicine}</div>
                      <div className="text-[11px] text-[var(--p-muted)]">Batch <span className="font-mono">{e.batchNo}</span> · {e.quantity} units · exp <span className="font-mono">{e.expiryDate}</span></div>
                    </div>
                    <Pill tone={e.daysLeft < 0 ? "cancelled" : e.daysLeft < 30 ? "low" : "waiting"}>
                      {e.daysLeft < 0 ? "Expired" : `${e.daysLeft}d left`}
                    </Pill>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section data-rise className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Reorder</h3>
                <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">At or below the reorder threshold.</p>
              </div>
              <span className="badge">{a?.lowStock.length ?? 0}</span>
            </div>
            {!a?.lowStock.length ? (
              <p className="py-12 text-center text-[13px] text-[var(--p-muted)]">Everything is well stocked.</p>
            ) : (
              <div className="divide-y divide-[var(--p-border)]">
                {a.lowStock.map((m) => (
                  <div key={m.medicineId} className="flex items-center justify-between px-6 py-3">
                    <div>
                      <div className="text-[13px] font-medium text-[var(--p-ink)]">{m.name}</div>
                      <div className="text-[11px] text-[var(--p-muted)]">Reorder at {m.reorderThreshold}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[14px] font-semibold text-[var(--p-rose)]">{m.inStock}</span>
                      <Pill tone="low">{m.inStock === 0 ? "Out" : "Low"}</Pill>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </PortalScroll>
  );
}
