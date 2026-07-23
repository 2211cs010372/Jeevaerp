"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import {
  EmptyState, ErrorNote, PROC_CSS, PageHead, StatStrip, Tag, dmy, dmyFromISO, inr, poStatus,
} from "@/components/portal/pharmacy/procurement-ui";
import { api, ApiClientError } from "@/lib/api-client";

interface Order {
  id: string; poNumber: string; status: string;
  supplierId: string; supplierName: string;
  totalAmount: string; expectedDate: string | null; createdAt: string; sentAt: string | null;
  createdByName: string; lines: number; qtyOrdered: number; qtyReceived: number;
  fulfilledPct: number; overdue: boolean; daysLate: number;
}
interface Stats {
  openOrders: number; overdueOrders: number; onOrderValue: string;
  reorderLines: number; outOfStockLines: number;
  receiptsThisMonth: number; purchaseValueThisMonth: string;
  creditOutstanding: string; suppliers: number; invoiceMismatches: number;
}

type Tab = "OPEN" | "DRAFT" | "RECEIVED" | "CANCELLED" | "ALL";
const TABS: { k: Tab; label: string; tone?: "warn" | "bad" }[] = [
  { k: "OPEN", label: "Open", tone: "warn" },
  { k: "DRAFT", label: "Drafts" },
  { k: "RECEIVED", label: "Complete" },
  { k: "CANCELLED", label: "Cancelled" },
  { k: "ALL", label: "All" },
];

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<Tab>("OPEN");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ status: tab });
      if (q) p.set("q", q);
      const [o, s] = await Promise.all([
        api.get<{ orders: Order[] }>(`/pharmacy/purchase-orders?${p}`),
        api.get<{ stats: Stats }>("/pharmacy/procurement-stats"),
      ]);
      setOrders(o.orders); setStats(s.stats); setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load purchase orders.");
    } finally { setLoading(false); }
  }, [tab, q]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const counts = useMemo(() => ({
    overdue: orders.filter((o) => o.overdue).length,
  }), [orders]);

  return (
    <PortalScroll>
      <style>{PROC_CSS}</style>

      <PageHead
        title="Purchase orders"
        blurb="What you've asked distributors to send, and how much of it has actually turned up. An order past its promised date is the only one worth a phone call."
      >
        <Link href="/reorder" className="seg"><Icon name="trend" size={14} /> Reorder list</Link>
        <Link href="/receive" className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white">
          <Icon name="inbox" size={15} /> Receive a delivery
        </Link>
      </PageHead>

      {stats && (
        <StatStrip items={[
          { label: "Open orders", value: String(stats.openOrders), sub: `${inr(stats.onOrderValue)} on order` },
          { label: "Overdue", value: String(stats.overdueOrders), tone: stats.overdueOrders > 0 ? "bad" : undefined, sub: "past the promised date" },
          { label: "Received this month", value: String(stats.receiptsThisMonth), sub: `${inr(stats.purchaseValueThisMonth)} bought in` },
          { label: "Credit owed to us", value: inr(stats.creditOutstanding), tone: Number(stats.creditOutstanding) > 0 ? "warn" : undefined, sub: "returns awaiting a credit note" },
        ]} />
      )}

      <div data-rise className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`seg ${tab === t.k ? "seg-on" : ""} ${tab !== t.k && t.k === "OPEN" && counts.overdue > 0 ? "seg-bad" : ""}`}>
            {t.label}
            {t.k === tab && <span className="seg-n">{orders.length}</span>}
          </button>
        ))}
        <div className="surface ml-auto flex min-w-[220px] items-center gap-2 px-3.5 py-2">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO number…"
            className="w-full bg-transparent text-sm outline-none" />
          {loading && <Spinner size={13} />}
        </div>
      </div>

      {error && <ErrorNote text={error} />}

      {!orders.length && !loading ? (
        <EmptyState
          icon="file"
          title={tab === "OPEN" ? "Nothing on order" : "No orders here"}
          hint={tab === "OPEN"
            ? "When stock drops below its reorder line, the Reorder screen turns it into an order in one click."
            : "Try another tab, or raise an order from the reorder list."}
        />
      ) : (
        <section data-rise className="surface overflow-hidden">
          <div className="divide-y divide-[var(--p-border)]">
            {orders.map((o, i) => {
              const st = poStatus(o.status);
              return (
                <Link key={o.id} href={`/purchase-orders/${o.id}`}
                  className="prow block px-5 py-4" style={{ ["--d" as string]: `${Math.min(i, 12) * 20}ms` }}>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] ${
                      o.overdue ? "bg-[var(--p-rose-soft)] text-[var(--p-rose)]" : "bg-[var(--p-blue-soft)] text-[var(--p-blue)]"
                    }`}>
                      <Icon name="file" size={17} />
                    </span>

                    <div className="min-w-[190px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="doc">{o.poNumber}</span>
                        <Tag tone={st.tone}>{st.label}</Tag>
                        {o.overdue && <Tag tone="bad">{o.daysLate}d late</Tag>}
                      </div>
                      <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                        {o.supplierName} · {o.lines} line{o.lines === 1 ? "" : "s"} · raised {dmyFromISO(o.createdAt)} by {o.createdByName}
                      </div>
                    </div>

                    <div className="min-w-[128px]">
                      <span className="lbl">Delivered</span>
                      <div className="num text-[13px] font-semibold text-[var(--p-ink)]">
                        {o.qtyReceived}<span className="text-[var(--p-muted)]"> / {o.qtyOrdered}</span>
                      </div>
                      <div className="fill mt-1.5" aria-hidden>
                        <i style={{
                          width: `${o.fulfilledPct}%`,
                          background: o.fulfilledPct >= 100 ? "var(--p-cyan)" : o.overdue ? "var(--p-rose)" : "var(--p-amber)",
                        }} />
                      </div>
                    </div>

                    <div className="min-w-[104px]">
                      <span className="lbl">Expected</span>
                      <span className={`num text-[13px] font-semibold ${o.overdue ? "text-[var(--p-rose)]" : "text-[var(--p-ink)]"}`}>
                        {o.expectedDate ? dmy(o.expectedDate) : "-"}
                      </span>
                    </div>

                    <div className="min-w-[100px] text-right">
                      <span className="lbl">Value</span>
                      <span className="num text-[14px] font-bold text-[var(--p-ink)]">{inr(o.totalAmount, 2)}</span>
                    </div>

                    <Icon name="chevron" size={15} />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </PortalScroll>
  );
}
