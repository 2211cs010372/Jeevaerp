"use client";

import { useCallback, useEffect, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * THE DISCHARGE SUMMARY, WRITTEN FROM EITHER DESK.
 *
 * One component, mounted on the reception ward screen and on the insurance
 * admission screen. Not two forms kept in step by hand: two forms over one
 * record is how the desks end up disagreeing about which fields exist.
 *
 * The form is only the MANUAL half. Patient, ward, consultant, medicines and
 * investigations are shown read-only above it, straight from the stay - a box
 * that lets somebody retype a patient's name is a box that lets them get it
 * wrong.
 */

interface SummaryDTO {
  id: string;
  status: "DRAFT" | "COMPLETED";
  fields: Record<string, string | null>;
  followUpDate: string | null;
  createdBy: string;
  updatedBy: string | null;
  completedBy: string | null;
  completedAt: string | null;
  updatedAt: string;
}

/** The derived half, as the API already serves it for the printable summary. */
interface Derived {
  admission: {
    ipNumber: string; status: string; admittedAt: string; dischargedAt: string | null;
    days: number; wardName: string; bedNo: string; reason: string | null;
    payerType?: string; insurer?: string | null; policyNo?: string | null;
  };
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
  doctor: { name: string; department: string };
  medicines: { name: string; qty: number; dosage: string | null }[];
  investigations: { testName: string; status: string; reportReady: boolean; date: string }[];
  summary: SummaryDTO | null;
}

/** Section order follows the printed document, so somebody filling this in while
 *  holding the paper is reading the same list top to bottom. */
const NARRATIVE: { key: string; label: string; rows: number; hint?: string }[] = [
  { key: "diagnosis", label: "Diagnosis", rows: 2 },
  { key: "historyPresenting", label: "History of presenting illness", rows: 4 },
  { key: "pastPersonalHistory", label: "Past & personal history", rows: 3 },
  { key: "clinicalFindings", label: "Clinical findings", rows: 3 },
];

const EXAM_VITALS: { key: string; label: string; placeholder: string }[] = [
  { key: "vitalTemp", label: "Temp", placeholder: "Afebrile" },
  { key: "vitalPulse", label: "PR", placeholder: "82 bpm" },
  { key: "vitalBp", label: "BP", placeholder: "90/60 mmHg" },
  { key: "vitalSpo2", label: "SpO₂", placeholder: "98% on RA" },
  { key: "examCvs", label: "CVS", placeholder: "S1, S2 (+)" },
  { key: "examRs", label: "RS", placeholder: "BAE (+)" },
  { key: "examPa", label: "P/A", placeholder: "Soft" },
  { key: "examCns", label: "CNS", placeholder: "WFND" },
];

const REST: { key: string; label: string; rows: number; hint?: string }[] = [
  { key: "physicalExamination", label: "Physical examination", rows: 3, hint: "Anything beyond the values above." },
  { key: "systemicExamination", label: "Systemic examination", rows: 3 },
  { key: "courseInHospital", label: "Course in hospital", rows: 5 },
  { key: "procedureNotes", label: "Operation / procedure notes", rows: 3 },
  { key: "conditionAtDischarge", label: "Condition at discharge", rows: 2 },
  { key: "followUpInstruction", label: "Follow-up instruction", rows: 2, hint: "e.g. Review after 5 days." },
  { key: "preventiveAdvice", label: "Preventive advice", rows: 2 },
];

const ALL_KEYS = [...NARRATIVE, ...REST].map((f) => f.key).concat(EXAM_VITALS.map((f) => f.key));

const blank = (): Record<string, string> =>
  Object.fromEntries(ALL_KEYS.map((k) => [k, ""]));

export function DischargeSummaryForm({ admissionId, onClose }: {
  admissionId: string;
  onClose: () => void;
}) {
  const [d, setD] = useState<Derived | null>(null);
  const [f, setF] = useState<Record<string, string>>(blank());
  const [followUpDate, setFollowUpDate] = useState("");
  /** The updatedAt we loaded. Sent on every write so another desk's edit can't
   *  be silently overwritten - the server 409s instead. */
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"DRAFT" | "COMPLETED" | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** Set on a 409 - the only error where the fix is "reload", so it gets a button. */
  const [stale, setStale] = useState(false);

  const apply = useCallback((s: SummaryDTO | null) => {
    if (!s) { setToken(null); setStatus(null); return; }
    const next = blank();
    for (const k of ALL_KEYS) next[k] = s.fields[k] ?? "";
    setF(next);
    setFollowUpDate(s.followUpDate ?? "");
    setToken(s.updatedAt);
    setStatus(s.status);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Derived>(`/ipd/admissions/${admissionId}/discharge-summary`);
      setD(r);
      apply(r.summary);
      setError(null); setStale(false);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load the discharge summary.");
    } finally { setLoading(false); }
  }, [admissionId, apply]);

  useEffect(() => { load(); }, [load]);

  /** Opening a draft is a write - it records who opened it - so it is a POST
   *  the user asks for, never something a page load does behind their back. */
  async function start() {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ summary: SummaryDTO }>(`/ipd/admissions/${admissionId}/discharge-summary`);
      apply(r.summary);
      setFlash("Draft started. Nothing is final until you press Complete.");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't start the summary.");
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError(null); setStale(false);
    try {
      const body: Record<string, string | null> = { expectedUpdatedAt: token };
      for (const k of ALL_KEYS) body[k] = f[k] ?? "";
      body.followUpDate = followUpDate || null;
      const r = await api.patch<{ summary: SummaryDTO }>(`/ipd/admissions/${admissionId}/discharge-summary`, body);
      apply(r.summary);
      setFlash("Saved. The other desk sees this the moment they open the stay.");
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : "Couldn't save.";
      setError(msg);
      if (e instanceof ApiClientError && e.status === 409) setStale(true);
    } finally { setBusy(false); }
  }

  async function act(action: "COMPLETE" | "REOPEN") {
    setBusy(true); setError(null); setStale(false);
    try {
      const r = await api.put<{ summary: SummaryDTO }>(
        `/ipd/admissions/${admissionId}/discharge-summary`,
        { action, expectedUpdatedAt: token }
      );
      apply(r.summary);
      setFlash(action === "COMPLETE" ? "Marked complete." : "Reopened for editing.");
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : "Couldn't do that.";
      setError(msg);
      if (e instanceof ApiClientError && e.status === 409) setStale(true);
    } finally { setBusy(false); }
  }

  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const ta = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[13.5px] leading-relaxed text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-blue)]";
  const inp = "w-full rounded-lg border border-[var(--p-border)] bg-white px-2.5 py-1.5 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";
  const completed = status === "COMPLETED";

  const Field = ({ k, label, rows, hint }: { k: string; label: string; rows: number; hint?: string }) => (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</span>
      <textarea rows={rows} className={ta} value={f[k] ?? ""} disabled={completed}
        onChange={(e) => set(k)(e.target.value)} />
      {hint && <span className="mt-0.5 block text-[11.5px] text-[var(--p-muted)]">{hint}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="surface my-4 w-full max-w-3xl overflow-hidden bg-white">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--p-border)] bg-white px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Discharge summary</h3>
            {d && (
              <p className="mt-0.5 truncate text-[12.5px] text-[var(--p-muted)]">
                {d.patient.fullName} · <span className="font-mono">{d.patient.displayId}</span> ·{" "}
                <span className="font-mono">{d.admission.ipNumber}</span> · {d.admission.wardName} {d.admission.bedNo}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status && (
              <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase ${
                completed ? "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]" : "bg-[var(--p-amber-soft)] text-[#8a6414]"
              }`}>{completed ? "Completed" : "Draft"}</span>
            )}
            <button onClick={onClose} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : !d ? (
          <p className="px-6 py-16 text-center text-[13px] text-[var(--p-rose)]">{error ?? "Couldn't load."}</p>
        ) : (
          <div className="space-y-5 p-6">
            {flash && (
              <div className="rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-2.5 text-[12.5px] text-[var(--p-cyan-deep)]">{flash}</div>
            )}
            {error && (
              <div className="rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-2.5 text-[12.5px] text-[var(--p-rose)]">
                {error}
                {stale && (
                  <button onClick={load} className="ml-2 font-semibold underline">Reload</button>
                )}
              </div>
            )}

            {/* ── AUTOMATIC ── read-only, straight off the stay. */}
            <section className="rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-4">
              <h4 className="text-[11.5px] font-bold uppercase tracking-wide text-[var(--p-muted)]">From this admission</h4>
              <dl className="mt-2 grid gap-x-5 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
                {[
                  ["Age / Sex", [d.patient.age != null ? `${d.patient.age}y` : null, d.patient.gender].filter(Boolean).join(" / ") || "—"],
                  ["Consultant", d.doctor.name],
                  ["Department", d.doctor.department],
                  ["Admitted", new Date(d.admission.admittedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })],
                  ["Discharged", d.admission.dischargedAt ? new Date(d.admission.dischargedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Still admitted"],
                  ["Payer", d.admission.payerType === "INSURANCE" ? (d.admission.insurer || "Insurance") : "Self pay / cash"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10.5px] uppercase tracking-wide text-[var(--p-muted)]">{k}</dt>
                    <dd className="text-[var(--p-ink)]">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                {d.medicines.length} discharge medicine{d.medicines.length === 1 ? "" : "s"} and{" "}
                {d.investigations.length} investigation{d.investigations.length === 1 ? "" : "s"} are pulled from
                this stay automatically — they print on the summary and are not retyped here.
              </p>
            </section>

            {!status ? (
              /* No record yet. Creating one is an act somebody takes, not a
                 side effect of opening a screen. */
              <div className="rounded-xl border border-dashed border-[var(--p-border-strong)] px-6 py-10 text-center">
                <p className="text-[13.5px] text-[var(--p-ink)]">No discharge summary for this stay yet.</p>
                <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-[var(--p-muted)]">
                  Starting one opens a draft against this admission. Reception and the insurance desk
                  then edit the same record — whichever of you opens it first.
                </p>
                <PrimaryButton onClick={start} disabled={busy}>
                  {busy ? <><Spinner /> Starting…</> : <><Icon name="file" size={15} /> Start discharge summary</>}
                </PrimaryButton>
              </div>
            ) : (
              <>
                {completed && (
                  <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-2.5 text-[12.5px] leading-relaxed text-[var(--p-muted)]">
                    This summary is complete. Reopen it to make a correction —
                    a mistake here is fixed on this record, never by writing a second summary.
                  </div>
                )}

                {NARRATIVE.map((x) => <Field key={x.key} k={x.key} label={x.label} rows={x.rows} hint={x.hint} />)}

                {/* ── EXAMINATION AT ADMISSION ──
                    Free text, not numbers: "Afebrile", "98% on RA", "S1, S2 (+)"
                    and "WFND" are what actually gets written on these lines. */}
                <div>
                  <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                    Examination at admission
                  </span>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {EXAM_VITALS.map((v) => (
                      <label key={v.key} className="block">
                        <span className="mb-0.5 block text-[11px] text-[var(--p-muted)]">{v.label}</span>
                        <input className={inp} value={f[v.key] ?? ""} placeholder={v.placeholder} disabled={completed}
                          onChange={(e) => set(v.key)(e.target.value)} />
                      </label>
                    ))}
                  </div>
                </div>

                {REST.map((x) => <Field key={x.key} k={x.key} label={x.label} rows={x.rows} hint={x.hint} />)}

                <label className="block max-w-[220px]">
                  <span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Follow-up date</span>
                  <input type="date" className={inp} value={followUpDate} disabled={completed}
                    onChange={(e) => setFollowUpDate(e.target.value)} />
                </label>
              </>
            )}
          </div>
        )}

        {status && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--p-border)] bg-white px-6 py-4">
            <a href={`/print/discharge/${admissionId}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
              <Icon name="printer" size={15} /> Print
            </a>
            {completed ? (
              <button onClick={() => act("REOPEN")} disabled={busy}
                className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] disabled:opacity-40">
                {busy ? <Spinner /> : "Reopen"}
              </button>
            ) : (
              <>
                <button onClick={save} disabled={busy}
                  className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] disabled:opacity-40">
                  {busy ? <Spinner /> : "Save draft"}
                </button>
                <PrimaryButton onClick={() => act("COMPLETE")} disabled={busy}>
                  <Icon name="check" size={15} /> Complete
                </PrimaryButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
