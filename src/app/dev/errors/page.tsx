"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api } from "@/lib/api-client";

/**
 * The crash list.
 *
 * This page exists so that a 500 at the billing counter is something the hospital
 * can tell you about instead of something you find out at renewal. One row per
 * distinct bug with an occurrence count, newest first, worst offenders obvious.
 *
 * It is a viewer, not an alerting system: somebody still has to open it. The push
 * notification is a deliberate follow-up (see TODOS.md) because "SMS on every
 * 500" turns one bad deploy into a few hundred rupees of texts at 2am.
 *
 * Lives in the DEVELOPER portal - a stack trace is the maintainer's evidence,
 * not the proprietor's reading. The endpoint stays /api/v1/admin/errors and
 * stays ADMIN-gated; SUPERUSER clears it the way it clears every role gate.
 */

interface ErrorRow {
  id: string;
  route: string;
  method: string;
  status: number;
  name: string;
  message: string;
  stack: string | null;
  count: number;
  actorRole: string | null;
  resolvedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

export default function ErrorsPage() {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ errors: ErrorRow[]; unresolved: number }>(
        `/admin/errors${showResolved ? "?resolved=1" : ""}`,
      )
      .then((r) => {
        setRows(r.errors);
        setUnresolved(r.unresolved);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [showResolved]);

  useEffect(load, [load]);

  const resolve = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/admin/errors/${id}/resolve`, {});
      load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Errors</h1>
        <p className="mt-1 text-[13px] text-[var(--p-muted)]">
          Server crashes, grouped by cause. Patient identifiers are stripped before anything is stored.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[13px] text-[var(--p-ink)]">
            <span className="font-semibold">{unresolved}</span> unresolved
          </span>
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--p-muted)]">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Include resolved
          </label>
        </div>
      </div>

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--p-muted)]">
            <Spinner /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-[var(--p-muted)]">
            {showResolved ? "Nothing recorded yet." : "No unresolved errors. "}
            {!showResolved && <span className="text-[var(--p-muted)]">Quiet is the correct state.</span>}
          </p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {rows.map((r) => (
              <div key={r.id} className="px-6 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${r.resolvedAt
                        ? "bg-[var(--p-teal-soft)] text-[var(--p-teal)]"
                        : "bg-[#fdeceb] text-[#b3261e]"
                        }`}
                    >
                      <Icon name={r.resolvedAt ? "check" : "alert"} size={14} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[12px] font-semibold text-[var(--p-ink)]">
                          {r.name}
                        </span>
                        {r.count > 1 && (
                          <span className="font-mono text-[11px] text-[#b3261e]">×{r.count}</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[12.5px] text-[var(--p-ink)]">{r.message}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-[var(--p-muted)]">
                        {r.method} {r.route}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--p-muted)]">
                        last {when(r.lastSeenAt)} · first {when(r.firstSeenAt)}
                        {r.actorRole ? ` · ${r.actorRole.replace("_", " ").toLowerCase()}` : ""}
                      </div>
                    </div>
                  </button>
                  {!r.resolvedAt && (
                    <button
                      onClick={() => resolve(r.id)}
                      disabled={busyId === r.id}
                      className="shrink-0 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-ink)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-50"
                    >
                      {busyId === r.id ? "…" : "Resolve"}
                    </button>
                  )}
                </div>
                {openId === r.id && r.stack && (
                  <pre className="mt-3 max-h-[300px] overflow-auto rounded-lg bg-[var(--p-bg-soft,#f6f7f7)] p-3 font-mono text-[10.5px] leading-relaxed text-[var(--p-muted)]">
                    {r.stack}
                  </pre>
                )}
                {openId === r.id && !r.stack && (
                  <p className="mt-3 text-[11.5px] italic text-[var(--p-muted)]">
                    No stack trace - the thrown value was not an Error.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </PortalScroll>
  );
}
