"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";

interface Row {
  id: string; displayId: string; fullName: string; age: number | null; gender: string | null;
  phone: string; city: string | null; visits: number; revenue: string; outstanding: string;
  lastVisit: string | null; registeredAt: string; isVip: boolean; isDeceased: boolean; archived: boolean;
}

type Sort = "recent" | "name" | "revenue";

const SORTS: { key: Sort; label: string }[] = [
  { key: "recent", label: "Newest" },
  { key: "name", label: "Name" },
  { key: "revenue", label: "Highest billed" },
];

export default function AdminPatientsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts: { q: string; sort: Sort; page: number; archived: boolean }) => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ sort: opts.sort, page: String(opts.page) });
      if (opts.q.trim()) p.set("q", opts.q.trim());
      if (opts.archived) p.set("archived", "1");
      const res = await api.get<{ patients: Row[]; total: number; page: number; pageSize: number }>(`/admin/patients?${p}`);
      setRows(res.patients); setTotal(res.total); setPageSize(res.pageSize);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load the patient register.");
    } finally { setLoading(false); }
  }, []);

  // Debounced: a register of a few thousand people is searched by typing, and
  // one request per keystroke turns that into a queue of stale responses.
  useEffect(() => {
    const t = setTimeout(() => { load({ q, sort, page, archived: showArchived }); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, sort, page, showArchived, load]);

  // Any filter change invalidates the page number - staying on page 7 of a
  // result set that now has two rows shows an empty table and looks broken.
  useEffect(() => { setPage(1); }, [q, sort, showArchived]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Patients</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--p-muted)]">
              Every registered patient, with how often they have come and what they have been billed.
              Billed totals count every invoice that was not cancelled, the same rule the Overview uses.
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[22px] font-semibold text-[var(--p-ink)]">{total.toLocaleString("en-IN")}</p>
            <p className="text-[11px] uppercase tracking-wide text-[var(--p-muted)]">{showArchived ? "incl. archived" : "on the register"}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1">
            <input
              className={`${fld} pl-9`}
              placeholder="Search name, UHID or phone…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--p-muted)]">
              <Icon name="search" size={14} />
            </span>
          </div>
          <div className="flex gap-1 rounded-lg border border-[var(--p-border)] p-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                  sort === s.key ? "bg-[var(--p-teal)] text-white" : "text-[var(--p-muted)] hover:text-[var(--p-teal)]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-[var(--p-text)]">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-[var(--p-teal)]" />
            Show archived
          </label>
        </div>
      </div>

      {error && <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]">{error}</div>}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-[var(--p-muted)]">
            {q ? `Nobody matches "${q}".` : sort === "revenue" ? "Nobody has been billed yet." : "No patients registered yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--p-border)] bg-[var(--p-bg)] text-[11px] uppercase tracking-wide text-[var(--p-muted)]">
                  <th className="px-6 py-2.5 font-semibold">UHID</th>
                  <th className="py-2.5 font-semibold">Patient</th>
                  <th className="py-2.5 font-semibold">Phone</th>
                  <th className="py-2.5 text-center font-semibold">Visits</th>
                  <th className="py-2.5 text-right font-semibold">Billed</th>
                  <th className="py-2.5 text-right font-semibold">Outstanding</th>
                  <th className="py-2.5 font-semibold">Last visit</th>
                  <th className="px-6 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--p-border)]">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/patients/${r.displayId}`)}
                    className={`cursor-pointer hover:bg-[var(--p-bg)] ${r.archived ? "opacity-55" : ""}`}
                  >
                    <td className="px-6 py-3 font-mono text-[12px] text-[var(--p-teal)]">{r.displayId}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--p-ink)]">{r.fullName}</span>
                        {r.isVip && <span className="badge !text-[10px]">VIP</span>}
                        {r.archived && <span className="badge !text-[10px] text-[var(--p-muted)]">Archived</span>}
                        {r.isDeceased && <span className="badge !text-[10px] text-[var(--p-rose)]">Deceased</span>}
                      </div>
                      <div className="text-[12px] text-[var(--p-muted)]">
                        {[r.age != null ? `${r.age}y` : null, cap(r.gender), r.city].filter(Boolean).join(" · ") || "-"}
                      </div>
                    </td>
                    <td className="py-3 font-mono text-[12px] text-[var(--p-muted)]">{r.phone}</td>
                    <td className="py-3 text-center font-mono">{r.visits}</td>
                    <td className="py-3 text-right font-mono text-[var(--p-ink)]">₹{r.revenue}</td>
                    <td className={`py-3 text-right font-mono ${Number(r.outstanding) > 0 ? "font-semibold text-[var(--p-rose)]" : "text-[var(--p-muted)]"}`}>
                      ₹{r.outstanding}
                    </td>
                    <td className="py-3 font-mono text-[12px] text-[var(--p-muted)]">{r.lastVisit ?? "-"}</td>
                    <td className="px-6 py-3 text-right">
                      <span className="text-[12px] font-medium text-[var(--p-teal)]">Open →</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && pages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--p-border)] px-6 py-3 text-[12px] text-[var(--p-muted)]">
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 font-medium text-[var(--p-text)] disabled:opacity-40"
              >Previous</button>
              <button
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 font-medium text-[var(--p-text)] disabled:opacity-40"
              >Next</button>
            </div>
          </div>
        )}
      </section>
    </PortalScroll>
  );
}

function cap(v: string | null) { return v ? v.charAt(0) + v.slice(1).toLowerCase() : null; }
