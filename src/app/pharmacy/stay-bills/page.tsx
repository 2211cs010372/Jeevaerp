"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { ForgottenBillDialog } from "@/components/portal/ipd/forgotten-bill-dialog";
import { api, ApiClientError } from "@/lib/api-client";
import { bedLabel } from "@/lib/beds";

/**
 * FORGOTTEN IP BILLS, FROM THE PHARMACY COUNTER (owner, 1 Oct 2026).
 *
 * The counter bills a stay only while the patient is in the bed. Medicine that
 * went up to the ward and was never billed - found at settlement, or when old
 * stays are keyed in from paper - had to be raised by reception. This puts the
 * same "Add a forgotten bill" the stay sheet has in the pharmacy's hands, for
 * medicine only: pick the stay (still admitted or long discharged) and raise
 * the bill onto it, from stock or bill-only, dated in the stay.
 *
 * Lab, services and advances stay with reception; the server refuses anything
 * but a PHARMACY bill from this role.
 */

interface Stay {
  id: string; ipNumber: string; status: string;
  admittedAt: string; dischargedAt: string | null;
  ward: string; bedNo: string;
  patient: { id: string; displayId: string; fullName: string; phone: string };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export default function PharmacyStayBillsPage() {
  const [q, setQ] = useState("");
  const [stays, setStays] = useState<Stay[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<Stay | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: "ALL" });
      if (query.trim()) params.set("q", query.trim());
      const r = await api.get<{ inpatients: Stay[] }>(`/ipd/admissions?${params}`);
      setStays(r.inpatients);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Couldn't load the stays.");
    } finally { setLoading(false); }
  }, []);

  // Search as the desk types, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void load(q); }, 300);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Forgotten IP bills</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--p-muted)]">
          Medicine a stay was given and never billed. Find the stay - still admitted or already
          discharged - and raise the bill onto it, dated on the day in the stay it belongs to.
        </p>
        <div className="mt-4 flex max-w-xl items-center gap-2 rounded-lg border border-[var(--p-border)] bg-white px-3 py-2">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            placeholder="IP number, patient name, Jeeva ID or phone…" className="w-full text-sm outline-none" />
        </div>
      </div>

      {flash && (
        <div data-rise className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-[var(--p-teal-soft)] px-4 py-3 text-[13px] text-[var(--p-teal-deep)]">
          <span className="flex items-center gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss"><Icon name="x" size={14} /></button>
        </div>
      )}

      {err ? (
        <p className="rounded-lg bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]">{err}</p>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : stays.length === 0 ? (
        <div data-rise className="surface dotgrid py-16 text-center text-[13px] text-[var(--p-muted)]">
          {q.trim() ? "No stay matches that search." : "No stays yet."}
        </div>
      ) : (
        <section data-rise className="surface overflow-hidden">
          <div className="divide-y divide-[var(--p-border)]">
            {stays.map((s) => {
              const inBed = s.status === "ADMITTED";
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium text-[var(--p-ink)]">{s.patient.fullName}</span>
                      <span className="font-mono text-[11.5px] text-[var(--p-muted)]">{s.patient.displayId}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${inBed ? "bg-[var(--p-amber-soft)] text-[#8a6414]" : "bg-[var(--p-bg)] text-[var(--p-muted)]"}`}>
                        {inBed ? "In bed" : "Discharged"}
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--p-muted)]">
                      <span className="font-mono">{s.ipNumber}</span>
                      {s.ward && ` · ${bedLabel(s.ward, s.bedNo)}`}
                      {` · ${day(s.admittedAt)} – ${s.dischargedAt ? day(s.dischargedAt) : "now"}`}
                    </div>
                  </div>
                  <button type="button" onClick={() => { setFlash(null); setAdding(s); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                    <Icon name="plus" size={14} /> Add forgotten bill
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {adding && (
        <ForgottenBillDialog
          admissionId={adding.id} ipNumber={adding.ipNumber}
          admittedAt={adding.admittedAt} dischargedAt={adding.dischargedAt}
          kinds={["PHARMACY"]}
          onCreated={() => setFlash(`Medicine bill added to ${adding.ipNumber}.`)}
          onClose={() => setAdding(null)}
        />
      )}
    </PortalScroll>
  );
}
