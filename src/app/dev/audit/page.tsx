"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api } from "@/lib/api-client";

/**
 * The audit trail, queryable.
 *
 * The hospital was already writing a broad trail. This page could only show the
 * newest hundred rows, with no filters and without the targetId or meta that ties
 * a row to the record it is about - so the two questions the trail exists to
 * answer could not be asked:
 *
 *   "produce everything recorded against this patient"   (medico-legal)
 *   "what did this member of staff do that day"          (money or medicines)
 *
 * Filters live in the URL-shaped state below and are sent as query params, so a
 * result set is reproducible rather than a thing one person saw once.
 *
 * Lives in the DEVELOPER portal. The endpoint it reads is still
 * /api/v1/admin/audit and still ADMIN-gated - the API namespace names the role
 * that may call it, not the portal the screen happens to sit in, and SUPERUSER
 * clears every role gate (see requireRole).
 */

interface Log {
  id: string;
  action: string;
  targetTable: string;
  targetId: string;
  createdAt: string;
  actor: { name: string; role: string } | null;
  meta: unknown;
  ipAddress: string | null;
}

interface Filters {
  action: string;
  table: string;
  target: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { action: "", table: "", target: "", from: "", to: "" };
const PAGE = 100;

const fld =
  "w-full rounded-lg border border-[var(--p-border)] bg-[var(--p-surface)] px-3 py-2 text-[13px] text-[var(--p-ink)]";

export default function AuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [options, setOptions] = useState<{ actions: string[]; tables: string[] }>({ actions: [], tables: [] });
  const [filters, setFilters] = useState<Filters>(EMPTY);
  /** Only committed filters hit the API, so typing an id does not fire a request per keystroke. */
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchPage = useCallback(async (f: Filters, offset: number) => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (f.action) p.set("action", f.action);
    if (f.table) p.set("table", f.table);
    if (f.target) p.set("target", f.target);
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
    return api.get<{
      logs: Log[]; total: number; offset: number;
      options?: { actions: string[]; tables: string[] };
    }>(`/admin/audit?${p.toString()}`);
  }, []);

  const load = useCallback(
    (f: Filters) => {
      setLoading(true);
      fetchPage(f, 0)
        .then((r) => {
          setLogs(r.logs);
          setTotal(r.total);
          if (r.options) setOptions(r.options);
        })
        .catch(() => { })
        .finally(() => setLoading(false));
    },
    [fetchPage],
  );

  useEffect(() => load(applied), [applied, load]);

  const loadMore = async () => {
    setMore(true);
    try {
      const r = await fetchPage(applied, logs.length);
      setLogs((prev) => [...prev, ...r.logs]);
    } finally {
      setMore(false);
    }
  };

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  const dirty = JSON.stringify(filters) !== JSON.stringify(applied);
  const filtered = JSON.stringify(applied) !== JSON.stringify(EMPTY);

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Audit log</h1>
        <p className="mt-1 text-[13px] text-[var(--p-muted)]">
          Every significant action - who did what, and when. Nothing is deleted.
        </p>
      </div>

      <section data-rise className="surface mb-6 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Action">
            <select className={fld} value={filters.action} onChange={set("action")}>
              <option value="">Any action</option>
              {options.actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Record type">
            <select className={fld} value={filters.table} onChange={set("table")}>
              <option value="">Any record</option>
              {options.tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          {/* The medico-legal question. Paste an invoice, admission or patient id
              and this becomes "everything ever recorded against that record". */}
          <Field label="Record id">
            <input className={fld} value={filters.target} onChange={set("target")} placeholder="Paste a record id" />
          </Field>
          <Field label="From">
            <input type="date" className={fld} value={filters.from} onChange={set("from")} />
          </Field>
          {/* Inclusive: asking to the 12th includes everything that happened
              during the 12th, not up to midnight at its start. */}
          <Field label="To">
            <input type="date" className={fld} value={filters.to} onChange={set("to")} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setApplied(filters)}
            disabled={!dirty}
            className="rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            Apply
          </button>
          {(filtered || dirty) && (
            <button
              onClick={() => { setFilters(EMPTY); setApplied(EMPTY); }}
              className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-[13px] text-[var(--p-text)]"
            >
              Clear
            </button>
          )}
          <span className="text-[12.5px] text-[var(--p-muted)]">
            {loading ? "…" : `${logs.length} shown of ${total.toLocaleString("en-IN")}${filtered ? " matching" : " total"}`}
          </span>
        </div>
      </section>

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--p-muted)]">
            <Spinner /> Loading…
          </div>
        ) : logs.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-[var(--p-muted)]">
            {filtered ? "Nothing matches those filters." : "No activity recorded yet."}
          </p>
        ) : (
          <>
            <div className="divide-y divide-[var(--p-border)]">
              {logs.map((l) => (
                <div key={l.id} className="px-6 py-3">
                  <button
                    onClick={() => setOpenId(openId === l.id ? null : l.id)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--p-teal-soft)] text-[var(--p-teal)]">
                        <Icon name="activity" size={14} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-[12px] font-semibold text-[var(--p-ink)]">{l.action}</div>
                        <div className="truncate text-[11px] text-[var(--p-muted)]">
                          {l.actor ? `${l.actor.name} (${l.actor.role.replace("_", " ")})` : "System"} · {l.targetTable}
                          {l.targetId && <span className="font-mono"> · {l.targetId}</span>}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--p-muted)]">
                      {new Date(l.createdAt).toLocaleString("en-IN")}
                    </span>
                  </button>
                  {openId === l.id && (
                    <div className="mt-2 rounded-lg bg-[var(--p-bg)] p-3">
                      {/* Meta is the evidence: the amount waived, the dues
                          overridden, the bed freed. Shown exactly as recorded. */}
                      {l.meta ? (
                        <pre className="overflow-x-auto font-mono text-[10.5px] leading-relaxed text-[var(--p-text)]">
                          {JSON.stringify(l.meta, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-[11.5px] italic text-[var(--p-muted)]">No extra detail recorded.</p>
                      )}
                      {l.ipAddress && (
                        <p className="mt-2 font-mono text-[10.5px] text-[var(--p-muted)]">from {l.ipAddress}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {logs.length < total && (
              <div className="border-t border-[var(--p-border)] px-6 py-4 text-center">
                <button
                  onClick={loadMore}
                  disabled={more}
                  className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-50"
                >
                  {more ? "Loading…" : `Load ${Math.min(PAGE, total - logs.length)} more`}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </PortalScroll>
  );
}
