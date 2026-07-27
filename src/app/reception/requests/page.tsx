"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { Pill, statusTone } from "@/components/portal/ui/primitives";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * The callback queue - people who asked the website to ring them back.
 *
 * These are NOT appointments. Nobody has a slot, an OP number or a patient
 * file yet; all that exists is a verified mobile number and an intent. The
 * desk's job here is to ring, then either book them (which creates all three)
 * or close the request with a reason.
 *
 * Ordered oldest-open-first on purpose: the person who has been waiting
 * longest for a call is the one to ring next.
 */

interface Req {
  id: string;
  refNo: string;
  patientName: string;
  phone: string;
  doctor: { id: string; name: string; department: string } | null;
  preferredDate: string | null;
  note: string | null;
  status: string;
  handledNote: string | null;
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
  priorRequests: number;
  appointment: { id: string; opNumber: string } | null;
}

const TABS = ["NEW", "CONTACTED", "BOOKED", "CLOSED", "ALL"] as const;
const LABEL: Record<string, string> = {
  NEW: "Not yet called", CONTACTED: "Called", BOOKED: "Booked", CLOSED: "Closed",
};
const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const ago = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function CallbackRequestsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("NEW");
  const [rows, setRows] = useState<Req[]>([]);
  const [open, setOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [closing, setClosing] = useState<Req | null>(null);
  const [closeNote, setCloseNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.get<{ requests: Req[]; open: number }>(`/reception/appointment-requests?status=${tab}`);
      setRows(r.requests); setOpen(r.open);
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't load the queue."); }
    finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  async function move(r: Req, status: Req["status"], note?: string) {
    setActing(r.id); setErr(null);
    try {
      await api.patch(`/reception/appointment-requests/${r.id}`, { status, note });
      setClosing(null); setCloseNote("");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't update that request."); }
    finally { setActing(null); }
  }

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-teal)]">Front desk</p>
          <h1 className="mt-1 font-serif-p text-[24px] font-semibold text-[var(--p-ink)]">Callback requests</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--p-muted)]">
            People who asked the website to ring them back. Their mobile is already verified - nobody here
            has a slot or a file yet, so ring them, then book or close.
          </p>
        </div>
        {open > 0 && (
          <span className="rounded-full bg-[#dc2626] px-3.5 py-1.5 text-[12.5px] font-bold text-white">
            {open} waiting
          </span>
        )}
      </div>

      <div data-rise className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
            className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              tab === t
                ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white"
                : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]"
            }`}>
            {t === "ALL" ? "All" : LABEL[t]}
          </button>
        ))}
      </div>

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-2.5 text-[13px] text-[var(--p-rose)]">
          <Icon name="alert" size={14} /> {err}
        </div>
      )}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : rows.length === 0 ? (
          <div className="dotgrid flex flex-col items-center py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--p-border)] bg-white text-[var(--p-muted)]">
              <Icon name="check" size={20} />
            </span>
            <p className="mt-3 text-[14px] text-[var(--p-muted)]">
              {tab === "NEW" ? "Nobody is waiting for a call. " : "Nothing here. "}
              {tab === "NEW" && <span className="font-medium text-[var(--p-ink)]">Queue is clear.</span>}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--p-ink)]">{r.patientName}</span>
                    <a href={`tel:${r.phone}`} className="font-mono text-[13px] font-semibold text-[var(--p-teal)] hover:underline">
                      {r.phone}
                    </a>
                    <span className="font-mono text-[11.5px] text-[var(--p-muted)]">{r.refNo}</span>
                    {r.priorRequests > 0 && (
                      <span className="rounded-full bg-[var(--p-amber-soft)] px-2 py-0.5 text-[11px] font-semibold text-[#8a6414]">
                        {r.priorRequests} earlier request{r.priorRequests === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-[13px] text-[var(--p-muted)]">
                    {r.doctor ? `${r.doctor.name} · ${r.doctor.department}` : "Any available doctor"}
                    {r.preferredDate && ` · prefers ${prettyDate(r.preferredDate)}`}
                    {" · "}<span title={new Date(r.createdAt).toLocaleString("en-IN")}>{ago(r.createdAt)}</span>
                  </div>

                  {r.note && (
                    <p className="mt-2 max-w-2xl rounded-lg bg-[var(--p-bg)] px-3 py-2 text-[13px] leading-relaxed text-[var(--p-text)]">
                      &ldquo;{r.note}&rdquo;
                    </p>
                  )}

                  {r.handledNote && (
                    <p className="mt-1.5 text-[12px] text-[var(--p-muted)]">
                      <span className="font-semibold">Desk note:</span> {r.handledNote}
                      {r.handledBy && ` — ${r.handledBy}`}
                    </p>
                  )}

                  {r.appointment && (
                    <p className="mt-1.5 text-[12px] font-semibold text-[var(--p-teal-deep)]">
                      Booked as <span className="font-mono">{r.appointment.opNumber}</span>
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Pill tone={statusTone(LABEL[r.status] ?? r.status)}>{LABEL[r.status] ?? r.status}</Pill>

                  {(r.status === "NEW" || r.status === "CONTACTED") && (
                    <>
                      {r.status === "NEW" && (
                        <button onClick={() => move(r, "CONTACTED")} disabled={acting === r.id}
                          title="Mark that you've spoken to them - it stays in the queue until booked or closed"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                          {acting === r.id ? <Spinner size={12} /> : <Icon name="clock" size={12} />} Called
                        </button>
                      )}
                      {/* Carries the request through, so booking closes it automatically. */}
                      <Link
                        href={`/book?req=${r.id}${r.doctor ? `&doctor=${r.doctor.id}` : ""}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)]">
                        <Icon name="calendar" size={12} /> Book
                      </Link>
                      <button onClick={() => { setClosing(r); setCloseNote(""); }}
                        className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-muted)] transition-colors hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
                        Close
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Closing needs a reason. "Number unreachable, tried 3 times" is the
          answer to "why was this never booked", months later. */}
      {closing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface w-full max-w-sm bg-white">
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Close this request?</h3>
              <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">
                {closing.patientName} · <span className="font-mono">{closing.refNo}</span>
              </p>
            </div>
            <div className="space-y-3 p-6">
              <label className="block text-[13px] font-medium text-[var(--p-text)]">What happened?</label>
              <input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} autoFocus
                placeholder="Number unreachable · booked by phone · changed their mind"
                className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--p-teal)]" />
              <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
                The request is kept, not deleted. This note is why it never became a visit.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => setClosing(null)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Keep it open</button>
              <button onClick={() => move(closing, "CLOSED", closeNote.trim() || undefined)}
                disabled={acting === closing.id || closeNote.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {acting === closing.id ? <><Spinner /> Closing…</> : "Close request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
