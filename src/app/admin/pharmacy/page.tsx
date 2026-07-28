"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * THE PHARMACY, FROM THE OWNER'S CHAIR.
 *
 * The pharmacist has eight screens because they act on eight different things.
 * The owner has one question - is it healthy, and is anything about to bite me -
 * so this is one screen with four tabs, and every number on it is produced by the
 * same service function the pharmacy portal uses. A management report that
 * computes stock value its own way is how one hospital ends up with two truths.
 *
 * Read-only on purpose. Ordering, receiving and writing off are the counter's
 * job; an owner reaching in from here would take an action nobody at the counter
 * knows happened.
 */

interface ModeTotal { mode: string; collected: number; refunded: number; net: number; count: number; }
interface Counter {
  pendingRx: number; dispensedToday: number; revenueToday: string;
  lowStock: number; expiringSoon: number; expired: number;
  profitToday: string; marginPct: number;
  stockValueCost: string; stockValueMrp: string; potentialProfit: string;
  collections: ModeTotal[];
  duesCount: number; duesTotal: string; duesIpdCount: number; duesIpdTotal: string;
}
interface Proc {
  openOrders: number; overdueOrders: number; onOrderValue: string;
  reorderLines: number; outOfStockLines: number;
  receiptsThisMonth: number; purchaseValueThisMonth: string;
  creditOutstanding: string; suppliers: number; invoiceMismatches: number;
}
interface Alerts {
  expiring: { batchId: string; medicine: string; batchNo: string; expiryDate: string; quantity: number; daysLeft: number }[];
  lowStock: { medicineId: string; name: string; inStock: number; reorderThreshold: number }[];
}
interface ReorderLine {
  medicineId: string; name: string; unit: string; inStock: number;
  packSize: number; packLabel: string | null;
  reorderThreshold: number; suggestedQty: number; suggestedUnits: number;
  lastUnitCost: string | null; supplierName: string | null; outOfStock: boolean;
}
interface Reorder {
  suppliers: { supplierId: string | null; supplierName: string; lines: ReorderLine[]; estimatedValue: string }[];
  totalLines: number;
}
interface Grn {
  id: string; grnNumber: string; invoiceNo: string | null; invoiceDate: string | null;
  invoiceAmount: string | null; receivedValue: string; variance: number | null; mismatch: boolean;
  createdAt: string; supplierName: string; poNumber: string | null; receivedByName: string; lines: number;
}
interface Po {
  id: string; poNumber: string; status: string; supplierName: string;
  totalAmount: string; expectedDate: string | null; lines: number;
  fulfilledPct: number; overdue: boolean; daysLate: number;
}
interface Mover { medicineId: string | null; name: string; units: number; revenue: number; profit: number; marginPct: number | null; }
interface Overview {
  counter: Counter; procurement: Proc; alerts: Alerts; reorder: Reorder;
  receipts: Grn[]; purchaseOrders: Po[];
  dues: { count: number; totalDue: string; ipdCount: number; ipdTotal: string };
  trend: { date: string; revenue: number; profit: number; bills: number }[];
  movers: Mover[];
  window: { revenue: number; profit: number; marginPct: number | null; bills: number; units: number };
}

const inr0 = (n: number | string) => "₹" + Math.round(Number(n)).toLocaleString("en-IN");
const inr2 = (n: number | string) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
};

type Tab = "money" | "stock" | "reorder" | "deliveries";
const TABS: { key: Tab; label: string; icon: "trend" | "alert" | "inbox" | "truck" }[] = [
  { key: "money", label: "Money & movement", icon: "trend" },
  { key: "stock", label: "Stock alerts", icon: "alert" },
  { key: "reorder", label: "Reorder", icon: "truck" },
  { key: "deliveries", label: "Orders & deliveries", icon: "inbox" },
];

export default function AdminPharmacyPage() {
  const [d, setD] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("money");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setD(await api.get<Overview>("/admin/pharmacy")); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load the pharmacy."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Counts that belong ON the tab, so a problem is visible before it's opened.
  const stockCount = (d?.counter.expired ?? 0) + (d?.counter.expiringSoon ?? 0) + (d?.counter.lowStock ?? 0);
  const tabCount: Record<Tab, number> = {
    money: d?.dues.count ?? 0,
    stock: stockCount,
    reorder: d?.reorder.totalLines ?? 0,
    deliveries: (d?.procurement.overdueOrders ?? 0) + (d?.procurement.invoiceMismatches ?? 0),
  };

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-end justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-teal)]">Admin console</p>
          <h1 className="mt-1 font-serif-p text-[24px] font-semibold text-[var(--p-ink)]">Pharmacy</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--p-muted)]">
            What the counter earns, what&apos;s sitting on the shelf, what needs buying and what
            arrived. Read-only — ordering and writing off stay at the counter.
          </p>
        </div>
        <button onClick={() => load()} disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] bg-white px-3.5 py-2 text-[13px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-45">
          {loading ? <Spinner size={13} /> : <Icon name="activity" size={14} />} Refresh
        </button>
      </div>

      {error ? (
        <div data-rise className="surface flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--p-rose-soft)] text-[var(--p-rose)]"><Icon name="alert" size={20} /></span>
          <p className="text-[15px] font-semibold text-[var(--p-ink)]">Couldn&apos;t load the pharmacy</p>
          <p className="max-w-md text-[13px] text-[var(--p-rose)]">{error}</p>
          <button onClick={() => load()} className="mt-1 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--p-teal-deep)]">Try again</button>
        </div>
      ) : loading || !d ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : (
        <>
          {/* ── the four numbers an owner checks first ── */}
          <div data-rise className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Revenue today" value={inr0(d.counter.revenueToday)}
              sub={`${d.counter.dispensedToday} dispensed · ${d.counter.pendingRx} waiting`} />
            <Kpi label="Profit today" value={inr0(d.counter.profitToday)}
              sub={`${d.counter.marginPct}% margin on costed lines`} tone="good" />
            <Kpi label="Stock on the shelf" value={inr0(d.counter.stockValueMrp)}
              sub={`bought at ${inr0(d.counter.stockValueCost)} · ${inr0(d.counter.potentialProfit)} unrealised`} />
            <Kpi label="Not collected" value={inr0(d.dues.totalDue)}
              sub={d.dues.ipdCount > 0 ? `${d.dues.count} bills · ${d.dues.ipdCount} on the ward` : `${d.dues.count} bills open`}
              tone={Number(d.dues.totalDue) > 0 ? "warn" : undefined} />
          </div>

          {/* ── tabs ── */}
          <div data-rise className="mb-5 flex flex-wrap gap-2">
            {TABS.map((t) => {
              const active = tab === t.key;
              const n = tabCount[t.key];
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                    active
                      ? "border-[var(--p-teal)] bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"
                      : "border-[var(--p-border)] bg-white text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]"
                  }`}>
                  <Icon name={t.icon} size={15} /> {t.label}
                  {n > 0 && (
                    <span className={`rounded-full px-1.5 py-px font-mono text-[10.5px] font-bold ${
                      active ? "bg-[var(--p-teal)] text-white" : "bg-[var(--p-amber)] text-white"
                    }`}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>

          {tab === "money" && <MoneyTab d={d} />}
          {tab === "stock" && <StockTab d={d} />}
          {tab === "reorder" && <ReorderTab d={d} />}
          {tab === "deliveries" && <DeliveriesTab d={d} />}
        </>
      )}
    </PortalScroll>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "warn" }) {
  return (
    <div className="surface px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</div>
      <div className={`mt-1 font-mono text-[22px] font-bold ${
        tone === "good" ? "text-[var(--p-teal-deep)]" : tone === "warn" ? "text-[var(--p-amber)]" : "text-[var(--p-ink)]"
      }`}>{value}</div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--p-muted)]">{sub}</div>
    </div>
  );
}

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section data-rise className="surface overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--p-border)] px-5 py-3.5">
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">{title}</h2>
          {sub && <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-[var(--p-muted)]">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-12 text-center text-[13px] text-[var(--p-muted)]">{text}</p>;
}

// ── MONEY & MOVEMENT ────────────────────────────────────────────────────────

function MoneyTab({ d }: { d: Overview }) {
  const max = Math.max(1, ...d.trend.map((t) => t.revenue));
  return (
    <div className="space-y-5">
      <Panel
        title="Last 14 days"
        sub="Each bar is a day's pharmacy sales. The solid part is gross profit — MRP minus what that exact batch cost, so it is the real margin and not an average applied afterwards."
        right={
          <div className="text-right">
            <div className="font-mono text-[18px] font-bold text-[var(--p-ink)]">{inr0(d.window.revenue)}</div>
            <div className="text-[11.5px] text-[var(--p-muted)]">
              {inr0(d.window.profit)} profit{d.window.marginPct !== null && ` · ${d.window.marginPct}%`} · {d.window.bills} bills
            </div>
          </div>
        }
      >
        <div className="px-5 py-5">
          <div className="flex h-[180px] items-end gap-1.5">
            {d.trend.map((t) => {
              const h = (t.revenue / max) * 100;
              const ph = t.revenue > 0 ? (Math.max(0, t.profit) / t.revenue) * h : 0;
              return (
                <div key={t.date} className="group relative flex flex-1 flex-col justify-end" style={{ height: "100%" }}>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--p-ink)] px-2 py-1 text-[11px] text-white group-hover:block">
                    {dayLabel(t.date)} · {inr0(t.revenue)} · {inr0(t.profit)} profit · {t.bills} bill{t.bills === 1 ? "" : "s"}
                  </div>
                  <div className="w-full rounded-t-[3px] bg-[var(--p-teal)]/20 transition-colors group-hover:bg-[var(--p-teal)]/30"
                    style={{ height: `${Math.max(h, t.revenue > 0 ? 2 : 0)}%` }}>
                    <div className="w-full rounded-t-[3px] bg-[var(--p-teal)]"
                      style={{ height: `${(ph / Math.max(h, 0.0001)) * 100}%`, marginTop: `${100 - (ph / Math.max(h, 0.0001)) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10.5px] text-[var(--p-muted)]">
            <span>{dayLabel(d.trend[0]?.date ?? "")}</span>
            <span>{dayLabel(d.trend[d.trend.length - 1]?.date ?? "")}</span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Panel title="What actually sells"
          sub="Top 15 by revenue over the same 14 days, with the margin each one really earned.">
          {d.movers.length === 0 ? <Empty text="Nothing dispensed in the last fortnight." /> : (
            <div className="divide-y divide-[var(--p-border)]">
              {d.movers.map((m, i) => (
                <div key={m.medicineId ?? m.name} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] text-[var(--p-muted)]">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[var(--p-ink)]">{m.name}</div>
                    <div className="text-[11.5px] text-[var(--p-muted)]">{m.units.toLocaleString("en-IN")} units sold</div>
                  </div>
                  <span className="w-[74px] text-right font-mono text-[12px] text-[var(--p-muted)]">
                    {m.marginPct === null ? "—" : `${m.marginPct}%`}
                  </span>
                  <span className="w-[86px] text-right font-mono text-[13px] font-bold text-[var(--p-ink)]">{inr0(m.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Collected at the counter today" sub="Today's pharmacy takings by payment type.">
            <div className="divide-y divide-[var(--p-border)]">
              {d.counter.collections.filter((c) => c.collected > 0 || c.refunded > 0).length === 0 ? (
                <Empty text="Nothing taken yet today." />
              ) : d.counter.collections.filter((c) => c.collected > 0 || c.refunded > 0).map((c) => (
                <div key={c.mode} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="flex-1 text-[13px] font-medium text-[var(--p-ink)]">{c.mode}</span>
                  <span className="text-[11.5px] text-[var(--p-muted)]">{c.count}×</span>
                  {c.refunded > 0 && <span className="font-mono text-[12px] text-[var(--p-rose)]">−{inr0(c.refunded)}</span>}
                  <span className="w-[86px] text-right font-mono text-[13px] font-bold text-[var(--p-ink)]">{inr2(c.net)}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Money already dispensed and not yet paid for - the counter's debtors. */}
          <Panel title="Dispensed, not collected"
            sub="Medicine that has left the counter unpaid. Ward bills hold up a discharge until they're settled.">
            {d.dues.count === 0 ? <Empty text="Everything the counter billed has been paid." /> : (
              <div className="px-5 py-4">
                <div className="font-mono text-[26px] font-bold text-[var(--p-amber)]">{inr2(d.dues.totalDue)}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--p-muted)]">
                  across <b className="text-[var(--p-ink)]">{d.dues.count}</b> open bill{d.dues.count === 1 ? "" : "s"}
                  {d.dues.ipdCount > 0 && <> — <b className="text-[var(--p-ink)]">{d.dues.ipdCount}</b> of them ({inr0(d.dues.ipdTotal)}) belong to patients still in a bed.</>}
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ── STOCK ALERTS ────────────────────────────────────────────────────────────

function StockTab({ d }: { d: Overview }) {
  const expired = d.alerts.expiring.filter((e) => e.daysLeft < 0);
  const soon = d.alerts.expiring.filter((e) => e.daysLeft >= 0);
  return (
    <div className="space-y-5">
      <div data-rise className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Expired on the shelf" value={String(d.counter.expired)}
          sub="must be quarantined - never dispensable" tone={d.counter.expired > 0 ? "warn" : undefined} />
        <Kpi label="Expiring within 90 days" value={String(d.counter.expiringSoon)}
          sub="still sellable, still returnable for credit" tone={d.counter.expiringSoon > 0 ? "warn" : undefined} />
        <Kpi label="Below reorder line" value={String(d.counter.lowStock)}
          sub={`${d.procurement.outOfStockLines} of them out of stock right now`}
          tone={d.procurement.outOfStockLines > 0 ? "warn" : undefined} />
      </div>

      {expired.length > 0 && (
        <Panel title="Expired — quarantine now"
          sub="Past its date and still counted on the shelf. Dispensing from these is the one pharmacy mistake that cannot be undone.">
          <div className="divide-y divide-[var(--p-border)]">
            {expired.map((e) => (
              <div key={e.batchId} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <div className="min-w-[180px] flex-1">
                  <div className="text-[13px] font-medium text-[var(--p-ink)]">{e.medicine}</div>
                  <div className="text-[11.5px] text-[var(--p-muted)]">Batch <span className="font-mono">{e.batchNo}</span> · {e.quantity} units</div>
                </div>
                <span className="font-mono text-[12px] text-[var(--p-muted)]">exp {e.expiryDate}</span>
                <span className="rounded-full bg-[var(--p-rose-soft)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--p-rose)]">
                  {Math.abs(e.daysLeft)}d expired
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Expiring soon"
        sub="Within 90 days. Still worth money if it moves or goes back to the distributor for credit — worth nothing the day after."
        right={<span className="font-mono text-[13px] font-bold text-[var(--p-ink)]">{soon.length}</span>}>
        {soon.length === 0 ? <Empty text="Nothing expiring in the next 90 days." /> : (
          <div className="divide-y divide-[var(--p-border)]">
            {soon.map((e) => (
              <div key={e.batchId} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <div className="min-w-[180px] flex-1">
                  <div className="text-[13px] font-medium text-[var(--p-ink)]">{e.medicine}</div>
                  <div className="text-[11.5px] text-[var(--p-muted)]">Batch <span className="font-mono">{e.batchNo}</span> · {e.quantity} units</div>
                </div>
                <span className="font-mono text-[12px] text-[var(--p-muted)]">exp {e.expiryDate}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  e.daysLeft < 30 ? "bg-[var(--p-amber-soft)] text-[#8a6414]" : "bg-[var(--p-bg)] text-[var(--p-muted)]"
                }`}>{e.daysLeft}d left</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Running low"
        sub="At or under the reorder line. Out-of-stock rows are a patient who was turned away today."
        right={<span className="font-mono text-[13px] font-bold text-[var(--p-ink)]">{d.alerts.lowStock.length}</span>}>
        {d.alerts.lowStock.length === 0 ? <Empty text="Everything is above its reorder line." /> : (
          <div className="divide-y divide-[var(--p-border)]">
            {d.alerts.lowStock.map((l) => (
              <div key={l.medicineId} className="flex items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--p-ink)]">{l.name}</span>
                <span className="text-[11.5px] text-[var(--p-muted)]">reorder at {l.reorderThreshold}</span>
                <span className={`w-[92px] text-right font-mono text-[13px] font-bold ${
                  l.inStock === 0 ? "text-[var(--p-rose)]" : "text-[var(--p-amber)]"
                }`}>{l.inStock === 0 ? "out of stock" : `${l.inStock} left`}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── REORDER ─────────────────────────────────────────────────────────────────

function ReorderTab({ d }: { d: Overview }) {
  const total = d.reorder.suppliers.reduce((s, x) => s + Number(x.estimatedValue), 0);
  return (
    <div className="space-y-5">
      <div data-rise className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Lines to buy" value={String(d.reorder.totalLines)} sub="netted off against stock already on its way" />
        <Kpi label="Out of stock now" value={String(d.procurement.outOfStockLines)}
          sub="each one is a sale walking out the door" tone={d.procurement.outOfStockLines > 0 ? "warn" : undefined} />
        <Kpi label="Estimated spend" value={inr0(total)} sub="priced at the last rate actually paid" />
      </div>

      {d.reorder.suppliers.length === 0 ? (
        <Panel title="Nothing to reorder"><Empty text="Every line is above its reorder point." /></Panel>
      ) : d.reorder.suppliers.map((s) => (
        <Panel key={s.supplierId ?? s.supplierName}
          title={s.supplierName}
          sub={`${s.lines.length} line${s.lines.length === 1 ? "" : "s"} · quantities are in PACKS, which is what a distributor sells`}
          right={<span className="font-mono text-[15px] font-bold text-[var(--p-ink)]">{inr0(s.estimatedValue)}</span>}>
          <div className="divide-y divide-[var(--p-border)]">
            {s.lines.map((l) => (
              <div key={l.medicineId} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--p-ink)]">{l.name}</span>
                    {l.outOfStock && (
                      <span className="rounded-full bg-[var(--p-rose-soft)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[var(--p-rose)]">Out</span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-[var(--p-muted)]">
                    {l.inStock} {l.unit} on hand · reorder at {l.reorderThreshold}
                    {l.packLabel && ` · pack ${l.packLabel}`}
                  </div>
                </div>
                <span className="font-mono text-[12px] text-[var(--p-muted)]">
                  {l.lastUnitCost ? `${inr2(l.lastUnitCost)}/pack` : "no rate on file"}
                </span>
                <span className="w-[132px] text-right">
                  <span className="font-mono text-[14px] font-bold text-[var(--p-ink)]">{l.suggestedQty} pack{l.suggestedQty === 1 ? "" : "s"}</span>
                  <span className="block text-[11px] text-[var(--p-muted)]">= {l.suggestedUnits} {l.unit}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

// ── ORDERS & DELIVERIES ─────────────────────────────────────────────────────

function DeliveriesTab({ d }: { d: Overview }) {
  return (
    <div className="space-y-5">
      <div data-rise className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Open orders" value={String(d.procurement.openOrders)} sub={`${inr0(d.procurement.onOrderValue)} on order`} />
        <Kpi label="Overdue" value={String(d.procurement.overdueOrders)} sub="past the promised date"
          tone={d.procurement.overdueOrders > 0 ? "warn" : undefined} />
        <Kpi label="Received this month" value={String(d.procurement.receiptsThisMonth)}
          sub={`${inr0(d.procurement.purchaseValueThisMonth)} bought in`} />
        <Kpi label="Credit owed to us" value={inr0(d.procurement.creditOutstanding)}
          sub={`${d.procurement.suppliers} active suppliers`}
          tone={Number(d.procurement.creditOutstanding) > 0 ? "warn" : undefined} />
      </div>

      {d.procurement.invoiceMismatches > 0 && (
        <div data-rise className="flex items-start gap-2 rounded-lg border border-[var(--p-amber)]/35 bg-[var(--p-amber-soft)] px-4 py-3 text-[12.5px] leading-relaxed text-[#8a6414]">
          <span className="mt-0.5 shrink-0"><Icon name="alert" size={15} /></span>
          <span>
            <b>{d.procurement.invoiceMismatches} delivery{d.procurement.invoiceMismatches === 1 ? "" : " notes"} this month</b> where
            the supplier&apos;s invoice total doesn&apos;t match what was actually counted out of the carton.
            Settle those before the invoices are paid.
          </span>
        </div>
      )}

      <Panel title="New orders received"
        sub="Deliveries booked in over the last 30 days, against the supplier's invoice."
        right={<span className="font-mono text-[13px] font-bold text-[var(--p-ink)]">{d.receipts.length}</span>}>
        {d.receipts.length === 0 ? <Empty text="No deliveries booked in this month." /> : (
          <div className="divide-y divide-[var(--p-border)]">
            {d.receipts.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-[190px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-[var(--p-ink)]">{g.grnNumber}</span>
                    {g.mismatch && (
                      <span className="rounded-full bg-[var(--p-amber-soft)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[#8a6414]">
                        Invoice mismatch
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-[var(--p-muted)]">
                    {g.supplierName}
                    {g.invoiceNo && <> · inv <span className="font-mono">{g.invoiceNo}</span></>}
                    {g.poNumber && <> · <span className="font-mono">{g.poNumber}</span></>}
                  </div>
                </div>
                <span className="text-[11.5px] text-[var(--p-muted)]">{g.lines} line{g.lines === 1 ? "" : "s"} · {g.receivedByName}</span>
                <span className="text-[11.5px] text-[var(--p-muted)]">{ago(g.createdAt)}</span>
                <span className="w-[120px] text-right">
                  <span className="font-mono text-[13.5px] font-bold text-[var(--p-ink)]">{inr2(g.receivedValue)}</span>
                  {g.mismatch && g.invoiceAmount && (
                    <span className="block font-mono text-[11px] text-[var(--p-amber)]">invoiced {inr2(g.invoiceAmount)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Still on order"
        sub="Sent to a distributor and not yet fully delivered. Overdue rows are the ones worth a phone call."
        right={<span className="font-mono text-[13px] font-bold text-[var(--p-ink)]">{d.purchaseOrders.length}</span>}>
        {d.purchaseOrders.length === 0 ? <Empty text="Nothing outstanding with any distributor." /> : (
          <div className="divide-y divide-[var(--p-border)]">
            {d.purchaseOrders.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-[180px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-[var(--p-ink)]">{p.poNumber}</span>
                    {p.overdue && (
                      <span className="rounded-full bg-[var(--p-rose-soft)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[var(--p-rose)]">
                        {p.daysLate}d late
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-[var(--p-muted)]">
                    {p.supplierName} · {p.lines} line{p.lines === 1 ? "" : "s"}
                    {p.expectedDate && ` · due ${p.expectedDate}`}
                  </div>
                </div>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-[70px] overflow-hidden rounded-full bg-[var(--p-bg)]">
                    <span className="block h-full rounded-full bg-[var(--p-teal)]" style={{ width: `${p.fulfilledPct}%` }} />
                  </span>
                  <span className="w-[36px] font-mono text-[11.5px] text-[var(--p-muted)]">{p.fulfilledPct}%</span>
                </span>
                <span className="w-[100px] text-right font-mono text-[13.5px] font-bold text-[var(--p-ink)]">{inr2(p.totalAmount)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
