"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { Icon } from "@/components/portal/ui/icons";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { Pagination } from "@/components/portal/ui/pagination";
import { api, ApiClientError } from "@/lib/api-client";
import { useDebounce } from "@/lib/use-debounce";
import { useLive } from "@/lib/realtime/use-live";
import { EditBillDialog } from "@/components/portal/billing/edit-bill-dialog";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import {
  ADMIN_BILLS_PAGE_SIZE, BILL_PAY_FILTERS, BILL_SOURCES, BILL_STATUSES,
  type BillPayFilter, type BillSearchField, type BillSource, type BillStatus,
} from "@/lib/admin-bills-query";

interface Bill {
  id: string; receiptNo: string; source: string; status: string;
  totalAmount: string; amountPaid: string; refunded: string; refundable: string;
  paymentModes: string[];
  /** SELF_PAY or INSURANCE - see the PayerType enum. */
  payer: string;
  payerName: string | null;
  createdAt: string;
  /** The corrected date this bill prints, when a desk has set one. */
  billDate: string | null;
  patient: { displayId: string; fullName: string };
}

/** One page of the register, plus totals over every bill the filters match. */
interface BillsPage {
  invoices: Bill[];
  total: number;
  page: number;
  pageSize: number;
  totals: { billed: string; collected: string };
}

const inr2 = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const SRC_LABEL: Record<string, string> = { CONSULTATION: "Consultation", LAB: "Lab", PHARMACY: "Pharmacy", IPD: "Inpatient", OTHER: "Other" };
const SRC_COLOR: Record<string, string> = { CONSULTATION: "#0b5f55", LAB: "#2f6df6", PHARMACY: "#c77d33", IPD: "#7c5cbf", OTHER: "#94a3b8" };
const STATUS_LABEL: Record<BillStatus, string> = {
  PENDING: "Pending", PARTIALLY_PAID: "Part paid", PAID: "Paid", REFUNDED: "Refunded", CANCELLED: "Cancelled",
};

/** Which column the search box reads - picked, so "12" finds UHIDs and not every receipt with a 12 in it. */
const SEARCH_BY: { value: BillSearchField; label: string; hint: string }[] = [
  { value: "ALL", label: "All fields", hint: "Search receipt no, patient or UHID" },
  { value: "RECEIPT", label: "Receipt no", hint: "Search by receipt no" },
  { value: "NAME", label: "Patient name", hint: "Search by patient name" },
  { value: "UHID", label: "UHID", hint: "Search by UHID" },
];

const PAGE_SIZES = [25, 50, 100];

const sel = "rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";
const lbl = "text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]";

function billChip(status: string) {
  const map: Record<string, string> = {
    PAID: "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]",
    PARTIALLY_PAID: "bg-[#fdf0dd] text-[#8a5a1a]",
    PENDING: "bg-[var(--p-border)]/40 text-[var(--p-muted)]",
    REFUNDED: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]",
    CANCELLED: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]",
  };
  const label: Record<string, string> = { PARTIALLY_PAID: "Part paid" };
  return <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${map[status] ?? "bg-[var(--p-border)]/40 text-[var(--p-muted)]"}`}>{label[status] ?? status[0] + status.slice(1).toLowerCase()}</span>;
}

function modeChip(m: string) {
  const c: Record<string, string> = {
    CASH: "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]",
    UPI: "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]",
    CARD: "bg-[#efe9fb] text-[#5b3fa0]",
    NETBANKING: "bg-[#e7effb] text-[#2f6df6]",
    OTHER: "bg-[var(--p-border)]/40 text-[var(--p-muted)]",
  };
  const label: Record<string, string> = { NETBANKING: "Netbank", UPI: "UPI" };
  return <span key={m} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${c[m] ?? "bg-[var(--p-border)]/40 text-[var(--p-muted)]"}`}>{label[m] ?? m[0] + m.slice(1).toLowerCase()}</span>;
}

export default function AdminBillsPage() {
  const [data, setData] = useState<BillsPage | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"ALL" | BillSource>("ALL");
  const [pay, setPay] = useState<BillPayFilter>("ALL");
  const [status, setStatus] = useState<"ALL" | BillStatus>("ALL");
  const [searchBy, setSearchBy] = useState<BillSearchField>("ALL");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q.trim(), 300);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pageSize, setPageSize] = useState(ADMIN_BILLS_PAGE_SIZE);
  /**
   * The bill open for correction.
   *
   * No useBillEditing() check here, unlike reception and the insurance room.
   * HospitalConfig.billEditingEnabled gates the COUNTER DESKS; an admin who
   * could not correct a bill would have no way to fix the mistake that switch
   * exists to prevent. The server agrees - see EDIT_GATED_ROLES.
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  // Every filter except the page number, as the query string the server reads.
  // The search column only counts once there is something to search, so
  // switching it over an empty box is not a reload.
  const filters = useMemo(() => {
    const p = new URLSearchParams({ pageSize: String(pageSize) });
    if (source !== "ALL") p.set("source", source);
    if (pay !== "ALL") p.set("pay", pay);
    if (status !== "ALL") p.set("status", status);
    if (debouncedQ) { p.set("q", debouncedQ); p.set("searchBy", searchBy); }
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [source, pay, status, searchBy, debouncedQ, from, to, pageSize]);

  // Any filter change starts again at page 1 - page 7 of a search that now has
  // two pages is an empty screen that reads as "no bills". Derived from the
  // filters rather than reset in an effect, so a filter change is one request
  // instead of the old page followed by page 1.
  const [paged, setPaged] = useState({ filters, page: 1 });
  const page = paged.filters === filters ? paged.page : 1;
  const setPage = (n: number) => setPaged({ filters, page: n });

  // Typing fires a request per pause; a slow early answer must not land on top
  // of a later one.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setFetching(true);
    try {
      const r = await api.get<BillsPage>(`/admin/bills?${filters}&page=${page}`);
      if (mine !== seq.current) return;
      // A bill can leave a filter while you sit on its last page - a pending
      // bill gets paid. Step back to the page that still exists.
      const last = Math.max(1, Math.ceil(r.total / r.pageSize));
      if (page > last) { setPaged({ filters, page: last }); return; }
      setData(r);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof ApiClientError ? e.message : "Couldn't load bills.");
    } finally {
      if (mine === seq.current) setFetching(false);
    }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  // Bills are raised at four counters. This is the one screen that sees all of
  // them, so it is the one that most needs to not be stale. A refresh re-reads
  // the page on screen, not the register.
  useLive([TOPICS.ADMIN], load, {
    events: [EVENTS.INVOICE_RAISED, EVENTS.PAYMENT_TAKEN],
    // Not while a bill is open for correction - a list that reloads under an
    // open dialog takes a half-typed amendment with it.
    enabled: !editingId,
  });

  const filtered = source !== "ALL" || pay !== "ALL" || status !== "ALL" || searchBy !== "ALL" || q !== "" || from !== "" || to !== "";
  const resetFilters = () => {
    setSource("ALL"); setPay("ALL"); setStatus("ALL"); setSearchBy("ALL");
    setQ(""); setFrom(""); setTo("");
  };

  // The date the bill PRINTS - the same date the From / To filter reads. Year
  // included: every bill the hospital has raised is on this screen now, not
  // just the recent ones.
  const dt = (b: Bill) => new Date(b.billDate ?? b.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const bills = data?.invoices ?? [];
  const total = data?.total ?? 0;

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-teal)]">Admin console</p>
        <h1 className="mt-1 font-serif-p text-[24px] font-semibold text-[var(--p-ink)]">All bills</h1>
        <p className="mt-1 text-[13px] text-[var(--p-muted)]">Every invoice across reception, lab, pharmacy and inpatient - with how each was paid.</p>
        <div className="mt-4 flex flex-wrap items-stretch gap-2">
          <select value={searchBy} onChange={(e) => setSearchBy(e.target.value as BillSearchField)} aria-label="Search in" className={sel}>
            {SEARCH_BY.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[var(--p-border)] bg-white px-3 py-2">
            <Icon name="search" size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={SEARCH_BY.find((s) => s.value === searchBy)?.hint}
              className="w-full bg-transparent text-[13px] text-[var(--p-ink)] outline-none" />
            {q && <button onClick={() => setQ("")} className="text-[12px] text-[var(--p-muted)]">clear</button>}
          </div>
        </div>
      </div>

      {/* filters */}
      <div data-rise className="mb-4 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {(["ALL", ...BILL_SOURCES] as const).map((s) => (
            <button key={s} onClick={() => setSource(s)}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${source === s ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white" : "border-[var(--p-border)] text-[var(--p-muted)]"}`}>
              {s === "ALL" ? "All sources" : SRC_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {BILL_PAY_FILTERS.map((p) => (
            <button key={p} onClick={() => setPay(p)}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${pay === p ? "border-[var(--p-cyan-deep)] bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]" : "border-[var(--p-border)] text-[var(--p-muted)]"}`}>
              {p === "ALL" ? "Any payment" : p[0] + p.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <label className="flex flex-col gap-1">
            <span className={lbl}>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as "ALL" | BillStatus)} className={sel}>
              <option value="ALL">Any status</option>
              {BILL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          {/* On the date the bill prints, so a bill re-dated at the desk is
              found on the day its paper says. */}
          <label className="flex flex-col gap-1">
            <span className={lbl}>From</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={sel} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={lbl}>To</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={sel} />
          </label>
          {filtered && (
            <button onClick={resetFilters}
              className="rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[12px] font-semibold text-[var(--p-muted)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
              Reset filters
            </button>
          )}
        </div>
      </div>

      {data === null ? (
        error ? (
          <p className="py-20 text-center text-[13px] text-[var(--p-rose)]">{error}</p>
        ) : (
          <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading bills…</div>
        )
      ) : (
        <>
          {/* summary - over every bill the filters match, not just this page */}
          <div data-rise className="mb-4 grid grid-cols-3 gap-4">
            <div className="surface px-5 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Bills {fetching && <Spinner size={11} />}</div>
              <div className="mt-0.5 font-mono text-[19px] font-bold text-[var(--p-ink)]">{total.toLocaleString("en-IN")}</div>
            </div>
            <div className="surface px-5 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Billed</div><div className="mt-0.5 font-mono text-[19px] font-bold text-[var(--p-ink)]">{inr0(Number(data.totals.billed))}</div></div>
            <div className="surface px-5 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Collected</div><div className="mt-0.5 font-mono text-[19px] font-bold text-[var(--p-teal)]">{inr0(Number(data.totals.collected))}</div></div>
          </div>

          {error && <p className="mb-3 text-[12px] text-[var(--p-rose)]">{error} - showing the last page that loaded.</p>}

          {/* list */}
          <section data-rise className="surface overflow-hidden">
            <div className={`divide-y divide-[var(--p-border)] transition-opacity ${fetching ? "opacity-60" : ""}`}>
              {bills.length === 0 ? (
                <p className="px-6 py-12 text-center text-[13px] text-[var(--p-muted)]">No bills match.</p>
              ) : bills.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3.5">
                  <div className="min-w-[150px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-medium text-[var(--p-ink)]">{b.receiptNo}</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `${SRC_COLOR[b.source] ?? "#94a3b8"}18`, color: SRC_COLOR[b.source] ?? "#94a3b8" }}>{SRC_LABEL[b.source] ?? b.source}</span>
                    </div>
                    <div className="text-[12px] text-[var(--p-muted)]">{b.patient.fullName} · <span className="font-mono">{b.patient.displayId}</span></div>
                  </div>
                  <div className="min-w-[90px] text-[12px] text-[var(--p-muted)]">{dt(b)}</div>
                  <div className="min-w-[150px]">
                    <div className="flex flex-wrap gap-1">
                      {/* "unpaid" is only true of a bill somebody could have paid.
                          A cashless bill names its insurer instead - it has no
                          tender because none was ever going to be taken here. */}
                      {b.payer === "INSURANCE" ? (
                        <span className="rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--p-blue-deep)]">
                          Insurance{b.payerName ? ` · ${b.payerName}` : ""}
                        </span>
                      ) : b.paymentModes.length > 0 ? b.paymentModes.map(modeChip) : (
                        <span className="text-[11px] text-[var(--p-muted)]">unpaid</span>
                      )}
                    </div>
                    {Number(b.refunded) > 0 && <div className="mt-0.5 text-[10px] text-[var(--p-rose)]">−{inr2(Number(b.refunded))} refunded</div>}
                  </div>
                  <div className="min-w-[130px] text-right">
                    <div className="font-mono text-[13px] text-[var(--p-ink)]">{inr2(Number(b.totalAmount))}</div>
                    {Number(b.amountPaid) !== Number(b.totalAmount) && <div className="font-mono text-[11px] text-[var(--p-muted)]">{inr2(Number(b.amountPaid))} paid</div>}
                  </div>
                  {billChip(b.status)}
                  <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer" title="View & print the bill"
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-blue)] transition-colors hover:border-[var(--p-blue)]">
                    <Icon name="printer" size={13} /> Bill
                  </a>
                  {/* Paid bills included - the counters can correct those now,
                      and an admin who could do less than a receptionist would be
                      an odd console. Only a cancelled bill is excluded, because
                      it is finished and the row already says so. The remaining
                      limits (a live IRN, never below what was collected) are
                      enforced server-side. */}
                  {b.status !== "CANCELLED" && (
                    <button onClick={() => setEditingId(b.id)}
                      title={Number(b.amountPaid) > 0
                        ? `Correct this bill — ${inr2(Number(b.amountPaid))} already collected`
                        : "Correct this bill's date, lines or amount"}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-blue)] transition-colors hover:border-[var(--p-blue)]">
                      <Icon name="file" size={13} /> Edit
                    </button>
                  )}
                </div>
              ))}
            </div>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(total / pageSize))}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={PAGE_SIZES}
              itemLabel="bills"
            />
          </section>
        </>
      )}

      {/* The same dialog every other desk corrects a bill with. Blue here to sit
          with the admin console, teal at the counters - the accent is the only
          thing that differs. */}
      {editingId && (
        <EditBillDialog
          invoiceId={editingId}
          accent="blue"
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load(); }}
        />
      )}
    </PortalScroll>
  );
}
