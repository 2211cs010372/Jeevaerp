"use client";

import { useEffect, useRef, useState } from "react";
import { Pill, statusTone, PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";

interface Test {
  id: string; testName: string; status: string; price: string | null; reportFileUrl: string | null;
  createdAt: string; completedAt: string | null; billed: boolean;
  patient: { id: string; displayId: string; fullName: string; phone: string } | null;
  appointment: { opNumber: string; doctorName: string; visitDate: string } | null;
  /** The bench's read of these results, once written. */
  impression: string | null;
}

type Flag = "NORMAL" | "HIGH" | "LOW" | "ABNORMAL";
interface ResultRow {
  name: string; unit: string | null; value: string;
  refLow: string | null; refHigh: string | null; refText: string | null;
  flag: Flag; sortOrder: number;
}
interface Sheet {
  test: {
    id: string; testName: string; status: string; completedAt: string | null;
    /** What the bench wrote against these numbers last time, if anything. */
    impression: string | null; technicianName: string | null;
    patient: { displayId: string; fullName: string; age: number | null; gender: string | null } | null;
  };
  results: ResultRow[];
  fromTemplate: boolean;
}

/** Mirrors flagFor() on the server so the bench sees H/L as it types. */
function liveFlag(value: string, refLow: string | null, refHigh: string | null): Flag | "" {
  const t = value.trim();
  if (!t) return "";
  const n = Number(t);
  if (!Number.isFinite(n)) return "";
  if (refHigh != null && n > Number(refHigh)) return "HIGH";
  if (refLow != null && n < Number(refLow)) return "LOW";
  return "NORMAL";
}

/** "12 - 17", "< 200", "> 40", or the text range. */
function rangeLabel(r: ResultRow): string {
  if (r.refLow != null && r.refHigh != null) return `${Number(r.refLow)} - ${Number(r.refHigh)}`;
  if (r.refHigh != null) return `< ${Number(r.refHigh)}`;
  if (r.refLow != null) return `> ${Number(r.refLow)}`;
  return r.refText ?? "-";
}

const FLAG_STYLE: Record<Flag, string> = {
  NORMAL: "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]",
  HIGH: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]",
  LOW: "bg-[var(--p-amber-soft)] text-[#8a6414]",
  ABNORMAL: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]",
};

export default function LabQueuePage() {
  const [filter, setFilter] = useState<"PENDING" | "COMPLETED" | "ALL">("PENDING");
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── structured results ──
  const [sheetFor, setSheetFor] = useState<Test | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [impression, setImpression] = useState("");
  const [savingSheet, setSavingSheet] = useState(false);

  async function openSheet(t: Test) {
    setSheetFor(t); setSheet(null); setRows([]); setImpression(""); setError(null);
    try {
      const s = await api.get<Sheet>(`/labs/tests/${t.id}/results`);
      setSheet(s); setRows(s.results); setImpression(s.test.impression ?? "");
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't open the result sheet."); }
  }

  function setRow(i: number, patch: Partial<ResultRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function saveSheet() {
    if (!sheetFor) return;
    const items = rows
      .filter((r) => r.name.trim() && r.value.trim())
      .map((r) => ({
        name: r.name.trim(), unit: r.unit, value: r.value.trim(),
        refLow: r.refLow != null ? Number(r.refLow) : null,
        refHigh: r.refHigh != null ? Number(r.refHigh) : null,
        refText: r.refText,
      }));
    if (items.length === 0) { setError("Enter a value for at least one analyte."); return; }
    setSavingSheet(true); setError(null);
    try {
      // Always sent, even when empty: on this screen a cleared box means the
      // technician deleted what they had written, not "leave it as it was".
      await api.put(`/labs/tests/${sheetFor.id}/results`, { items, impression: impression.trim() });
      setSheetFor(null); setSheet(null); setRows([]); setImpression("");
      await load();
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not save the results."); }
    finally { setSavingSheet(false); }
  }

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const q = filter === "ALL" ? "" : `?status=${filter}`;
      const { tests } = await api.get<{ tests: Test[] }>(`/labs/tests${q}`);
      setTests(tests);
    } catch { if (!quiet) setTests([]); } finally { if (!quiet) setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  // A test ordered at reception appears here while the sample is still being
  // collected. Suspended while a result sheet is open so typing is never
  // interrupted by the list reloading underneath.
  useLive([TOPICS.LABS], () => load(true), { enabled: !sheetFor });

  async function complete(id: string) {
    setError(null); setBusyId(id);
    try { await api.post("/labs/tests/complete", { labTestId: id }); await load(); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not complete the test."); }
    finally { setBusyId(null); }
  }

  async function removeReport(id: string) {
    setError(null); setBusyId(id);
    try { await api.post("/labs/tests/report/remove", { labTestId: id }); await load(); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not remove the report."); }
    finally { setBusyId(null); }
  }

  async function uploadReport(id: string, file: File) {
    setError(null); setBusyId(id);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("labTestId", id);
      const res = await fetch("/api/v1/labs/tests/report", { method: "POST", body: form, credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok) throw new ApiClientError(res.status, body.error ?? "Upload failed");
      await load();
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Upload failed."); }
    finally { setBusyId(null); }
  }

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Test queue</h1>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">Upload a report to complete a test, or mark it done.</p>
        </div>
        <div className="flex gap-1 rounded-full border border-[var(--p-border)] bg-white p-1">
          {(["PENDING", "COMPLETED", "ALL"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${filter === f ? "bg-[var(--p-teal)] text-white" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>
              {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div data-rise className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]">
          <Icon name="alert" size={15} /> <span>{error}</span>
        </div>
      )}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading tests…</div>
        ) : tests.length === 0 ? (
          <div className="dotgrid flex flex-col items-center py-20 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--p-border)] bg-white text-[var(--p-muted)]"><Icon name="flask" size={20} /></span>
            <p className="mt-3 text-[13px] text-[var(--p-muted)]">No {filter === "ALL" ? "" : filter.toLowerCase()} tests.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {tests.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 transition-colors hover:bg-[var(--p-bg)]">
                <div className="min-w-[220px]">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-[var(--p-ink)]">{t.testName}</span>
                    {t.billed && <span className="badge !py-0.5 !text-[10px]">billed</span>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                    {t.patient?.fullName ?? "-"} · <span className="tabular">{t.patient?.displayId ?? "-"}</span>
                    {t.appointment ? ` · ${t.appointment.doctorName} (${t.appointment.opNumber})` : " · walk-in"}
                  </div>
                  {/* Shown on the row, not hidden behind the sheet: a queue that
                      makes you open every test to find the one that was flagged
                      is a queue nobody reads. */}
                  {t.impression && (
                    <p className="mt-1 max-w-[42ch] text-[12px] italic leading-snug text-[var(--p-teal-deep)]">
                      {t.impression}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {t.price && <span className="font-mono text-[12px] text-[var(--p-muted)]">₹{t.price}</span>}
                  <Pill tone={statusTone(t.status === "PENDING" ? "Waiting" : "Completed")}>
                    {t.status === "PENDING" ? "Pending" : "Completed"}
                  </Pill>

                  {t.reportFileUrl && (
                    <a href={t.reportFileUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-teal)] transition-colors hover:border-[var(--p-teal)]">
                      <Icon name="file" size={13} /> Report
                    </a>
                  )}

                  {/* The numbers themselves - what makes a result readable by a screen. */}
                  <button onClick={() => openSheet(t)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-teal)]/40 bg-[var(--p-teal-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-teal-deep)] transition-colors hover:bg-[var(--p-teal)] hover:text-white">
                    <Icon name="flask" size={13} /> {t.status === "PENDING" ? "Enter results" : "Results"}
                  </button>

                  {t.status === "COMPLETED" && (
                    <>
                      <input
                        ref={(el) => { fileRefs.current[t.id] = el; }}
                        type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReport(t.id, f); }}
                      />
                      <button onClick={() => fileRefs.current[t.id]?.click()} disabled={busyId === t.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-60">
                        {busyId === t.id ? <Spinner size={12} /> : <Icon name="file" size={13} />} Replace
                      </button>
                      {t.reportFileUrl && (
                        <button onClick={() => removeReport(t.id)} disabled={busyId === t.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-rose)]/30 px-3 py-1.5 text-[12px] font-medium text-[var(--p-rose)] transition-colors hover:bg-[var(--p-rose-soft)] disabled:opacity-60">
                          <Icon name="alert" size={13} /> Remove
                        </button>
                      )}
                    </>
                  )}

                  {t.status === "PENDING" && (
                    <>
                      <input
                        ref={(el) => { fileRefs.current[t.id] = el; }}
                        type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReport(t.id, f); }}
                      />
                      <button onClick={() => fileRefs.current[t.id]?.click()} disabled={busyId === t.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)] disabled:opacity-60">
                        {busyId === t.id ? <Spinner size={12} /> : <Icon name="file" size={13} />} Upload report
                      </button>
                      <button onClick={() => complete(t.id)} disabled={busyId === t.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-60">
                        <Icon name="check" size={13} /> Mark done
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─────────── RESULT SHEET ─────────── */}
      {sheetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSheetFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="surface flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">{sheetFor.testName}</h3>
                <p className="text-[13px] text-[var(--p-muted)]">
                  {sheetFor.patient?.fullName ?? "-"} · <span className="tabular">{sheetFor.patient?.displayId ?? "-"}</span>
                  {sheet?.fromTemplate && <span className="ml-2 rounded bg-[var(--p-teal-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--p-teal-deep)]">from template</span>}
                </p>
              </div>
              <button onClick={() => setSheetFor(null)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!sheet ? (
                <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Opening the sheet…</div>
              ) : rows.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-[var(--p-muted)]">
                  No analyte template for this test yet. Add a line below to record the reading.
                </p>
              ) : (
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--p-muted)]">
                      <th className="pb-2 pr-2 font-semibold">Analyte</th>
                      <th className="w-[120px] pb-2 pr-2 font-semibold">Value</th>
                      <th className="w-[80px] pb-2 pr-2 font-semibold">Unit</th>
                      <th className="w-[110px] pb-2 pr-2 font-semibold">Reference</th>
                      <th className="w-[70px] pb-2 font-semibold">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const f = liveFlag(r.value, r.refLow, r.refHigh);
                      return (
                        <tr key={i} className="border-t border-[var(--p-border)]">
                          <td className="py-2 pr-2">
                            <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })}
                              className="w-full bg-transparent text-[13px] font-medium text-[var(--p-ink)] outline-none" />
                          </td>
                          <td className="py-2 pr-2">
                            <input value={r.value} onChange={(e) => setRow(i, { value: e.target.value })}
                              placeholder="-" autoFocus={i === 0}
                              className="w-full rounded-lg border border-[var(--p-border)] bg-white px-2.5 py-1.5 font-mono text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />
                          </td>
                          <td className="py-2 pr-2 font-mono text-[12px] text-[var(--p-muted)]">{r.unit ?? "-"}</td>
                          <td className="py-2 pr-2 font-mono text-[12px] text-[var(--p-muted)]">{rangeLabel(r)}</td>
                          <td className="py-2">
                            {f && f !== "NORMAL" ? (
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${FLAG_STYLE[f]}`}>{f}</span>
                            ) : f === "NORMAL" ? (
                              <span className="text-[11px] text-[var(--p-muted)]">normal</span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {sheet && (
                <button
                  onClick={() => setRows((rs) => [...rs, { name: "", unit: null, value: "", refLow: null, refHigh: null, refText: null, flag: "NORMAL", sortOrder: rs.length }])}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--p-teal)]">
                  <Icon name="plus" size={12} /> Add a line
                </button>
              )}
            </div>

            {/* The bench's read of its own numbers. Written here rather than on
                a separate screen because it is only trustworthy when it is
                written WITH the values in front of you, in one action. */}
            <div className="mx-6 mb-4">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                Impression / diagnosis from these results
              </label>
              <textarea
                value={impression}
                onChange={(e) => setImpression(e.target.value)}
                maxLength={600}
                placeholder="What these numbers show - e.g. Microcytic hypochromic anaemia. Suggest serum ferritin."
                className="mt-1.5 min-h-[72px] w-full resize-y rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[13px] leading-relaxed text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]"
              />
              <p className="mt-1 text-[11px] text-[var(--p-muted)]">
                Optional. Goes onto the patient&apos;s OPD sheet under <span className="font-semibold">Investigation</span>,
                attributed to the lab. The consulting doctor&apos;s diagnosis is separate and this never replaces it.
                {sheet?.test.impression && sheet.test.technicianName && (
                  <> Currently written by <span className="font-semibold">{sheet.test.technicianName}</span>.</>
                )}
              </p>
            </div>

            <p className="mx-6 mb-3 rounded-lg bg-[var(--p-teal-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--p-teal-deep)]">
              Saving marks the test completed and stamps your name on it. The reference range is stored
              alongside each value, so a later change to the catalogue can&apos;t re-grade a report already given out.
            </p>

            <div className="flex items-center justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => setSheetFor(null)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
              <PrimaryButton onClick={saveSheet} disabled={savingSheet || !sheet}>
                {savingSheet ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> Save results</>}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
