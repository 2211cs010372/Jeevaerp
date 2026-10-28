"use client";

import { useCallback, useEffect, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";
import { bedLabel } from "@/lib/beds";

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

/**
 * FOUR BOXES WERE REMOVED FROM HERE, not just from the printed sheet.
 *
 * physicalExamination, systemicExamination, followUpInstruction and
 * preventiveAdvice no longer appear on the discharge summary, and a form that
 * still asked for them would have doctors typing into fields nobody will ever
 * read - which is worse than not asking, because it looks like it counts.
 *
 * The COLUMNS are left on the table on purpose. Summaries already written hold
 * text in them, and dropping the columns would delete signed clinical records
 * to tidy up a form. They are simply no longer collected or printed.
 */
const REST: { key: string; label: string; rows: number; hint?: string }[] = [
  { key: "courseInHospital", label: "Course in hospital", rows: 5 },
  { key: "procedureNotes", label: "Operation / procedure notes", rows: 3 },
  { key: "conditionAtDischarge", label: "Condition at discharge", rows: 2 },
];

export const DISCHARGE_TYPE_OPTIONS = [
  "Normal Discharge",
  "Lama Discharge",
  "Refer to",
  "Death",
] as const;

export function parseDischargeType(raw: string | null | undefined): { type: string; details: string } {
  const v = (raw ?? "").trim();
  if (!v) return { type: "Normal Discharge", details: "" };
  if (/^refer(\s*to)?/i.test(v)) {
    const after = v.replace(/^refer(\s*to)?[:\s-]*/i, "").trim();
    return { type: "Refer to", details: after };
  }
  if (/lama/i.test(v)) return { type: "Lama Discharge", details: "" };
  if (/death|expired/i.test(v)) return { type: "Death", details: "" };
  if (/normal/i.test(v)) return { type: "Normal Discharge", details: "" };
  return { type: "Normal Discharge", details: "" };
}

export function formatDischargeType(type: string, details: string): string {
  if (type === "Refer to") {
    const d = details.trim();
    return d ? `Refer to: ${d}` : "Refer to";
  }
  return type;
}

const ALL_KEYS = ["dischargeType", ...NARRATIVE, ...REST].map((f) => f.key).concat(EXAM_VITALS.map((f) => f.key));

const blank = (): Record<string, string> =>
  Object.fromEntries(ALL_KEYS.map((k) => [k, ""]));

const ta = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[13.5px] leading-relaxed text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-blue)]";
const inp = "w-full rounded-lg border border-[var(--p-border)] bg-white px-2.5 py-1.5 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

/**
 * DECLARED OUT HERE, NOT INSIDE THE FORM, AND IT HAS TO STAY OUT HERE.
 *
 * A component defined inside DischargeSummaryForm is a brand new function on
 * every render, so React cannot recognise it as the same component twice: it
 * throws the old <textarea> away and mounts a fresh one. The doctor types one
 * letter, state changes, the box being typed into is destroyed mid-word and the
 * cursor goes with it - typing stops dead after the first character.
 *
 * Everything it needs now arrives as props.
 */
function Field({ label, rows, hint, value, disabled, onChange }: {
  label: string;
  rows: number;
  hint?: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</span>
      <textarea rows={rows} className={ta} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-0.5 block text-[11.5px] text-[var(--p-muted)]">{hint}</span>}
    </label>
  );
}

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

  /**
   * THE DISCHARGE PRESCRIPTION, typed here.
   *
   * Held apart from `f` because it is rows, not fields, and it is saved to its
   * own endpoint: these are real prescription items with a pharmacy-master link
   * behind them, not another textarea on the summary. `dose` is free text on
   * purpose - "BD x 5 Days", "1-0-1 after food", "SOS" are all things doctors
   * write, and a dropdown of frequencies would only send them to the notes box.
   */
  const [meds, setMeds] = useState<{ name: string; dose: string }[]>([]);

  const apply = useCallback((s: SummaryDTO | null, admissionStatus?: string) => {
    if (!s) { setToken(null); setStatus(null); return; }
    const next = blank();
    for (const k of ALL_KEYS) next[k] = s.fields[k] ?? "";
    if (!next.dischargeType) {
      if (admissionStatus === "LAMA") next.dischargeType = "Lama Discharge";
      else if (admissionStatus === "EXPIRED") next.dischargeType = "Death";
      else if (admissionStatus === "TRANSFERRED_OUT") next.dischargeType = "Refer to";
      else next.dischargeType = "Normal Discharge";
    }
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
      apply(r.summary, r.admission?.status);
      const rx = await api.get<{ medicines: { medicineName: string; dosage: string | null }[] }>(
        `/ipd/admissions/${admissionId}/discharge-medicines`
      ).catch(() => ({ medicines: [] }));
      setMeds(rx.medicines.map((m) => ({ name: m.medicineName, dose: m.dosage ?? "" })));
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
      apply(r.summary, d?.admission?.status);
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
      // Saved with the summary, not on its own button. A doctor who typed the
      // discharge drugs and pressed Save expects them kept; a second button they
      // did not notice is how a prescription goes missing.
      await api.post(`/ipd/admissions/${admissionId}/discharge-medicines`, {
        medicines: meds
          .filter((m) => m.name.trim())
          .map((m) => ({ medicineName: m.name.trim(), qty: 1, dosage: m.dose.trim() || undefined })),
      });
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
  const completed = status === "COMPLETED";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="surface my-4 w-full max-w-3xl overflow-hidden bg-white">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--p-border)] bg-white px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Discharge summary</h3>
            {d && (
              <p className="mt-0.5 truncate text-[12.5px] text-[var(--p-muted)]">
                {d.patient.fullName} · <span className="font-mono">{d.patient.displayId}</span> ·{" "}
                <span className="font-mono">{d.admission.ipNumber}</span> · {bedLabel(d.admission.wardName, d.admission.bedNo)}
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

                {/* ── DISCHARGE TYPE ── */}
                <div className="rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <span className="block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                        Discharge Type
                      </span>
                      <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                        Classification of discharge for this patient
                      </p>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 sm:max-w-md sm:items-end">
                      <select
                        className={`${inp} font-medium`}
                        value={parseDischargeType(f.dischargeType).type}
                        disabled={completed}
                        onChange={(e) => {
                          const newType = e.target.value;
                          const curDetails = parseDischargeType(f.dischargeType).details;
                          set("dischargeType")(formatDischargeType(newType, curDetails));
                        }}
                      >
                        {DISCHARGE_TYPE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>

                      {parseDischargeType(f.dischargeType).type === "Refer to" && (
                        <div className="w-full">
                          <input
                            type="text"
                            className={inp}
                            placeholder="Referred hospital / center / reason (e.g. Higher Center, NIMS)"
                            value={parseDischargeType(f.dischargeType).details}
                            disabled={completed}
                            onChange={(e) => {
                              set("dischargeType")(formatDischargeType("Refer to", e.target.value));
                            }}
                          />
                          <span className="mt-1 block text-[11px] text-[var(--p-muted)]">
                            Prints as: <span className="font-semibold text-[var(--p-ink)]">{f.dischargeType || "Refer to"}</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {NARRATIVE.map((x) => (
                  <Field key={x.key} label={x.label} rows={x.rows} hint={x.hint}
                    value={f[x.key] ?? ""} disabled={completed} onChange={set(x.key)} />
                ))}

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

                {REST.map((x) => (
                  <Field key={x.key} label={x.label} rows={x.rows} hint={x.hint}
                    value={f[x.key] ?? ""} disabled={completed} onChange={set(x.key)} />
                ))}

                {/* ── MEDICATIONS ADVISED ──
                    What the patient goes home on. Rows rather than a textarea
                    because the printed summary numbers them and the pharmacy can
                    dispense against them; a paragraph can do neither.

                    Two boxes only. The hospital's own summaries read
                    "TAB. CEFADOX-CV - BD x 5 Days" - a drug and an instruction -
                    and asking for quantity here would be asking the doctor a
                    dispensing question they do not answer at the bedside. */}
                <div>
                  <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                    Medications advised
                  </span>
                  <div className="space-y-2">
                    {meds.map((m, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-4 shrink-0 text-right font-mono text-[12px] text-[var(--p-muted)]">{i + 1}.</span>
                        <input className={`${inp} flex-[2]`} value={m.name} disabled={completed}
                          placeholder="TAB. CEFADOX-CV"
                          onChange={(e) => setMeds(meds.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                        <input className={`${inp} flex-1`} value={m.dose} disabled={completed}
                          placeholder="BD x 5 Days"
                          onChange={(e) => setMeds(meds.map((x, j) => j === i ? { ...x, dose: e.target.value } : x))} />
                        {!completed && (
                          <button type="button" onClick={() => setMeds(meds.filter((_, j) => j !== i))}
                            title="Remove this medicine"
                            className="shrink-0 rounded-lg border border-[var(--p-border)] px-2 py-1.5 text-[12px] text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {!completed && (
                    <button type="button" onClick={() => setMeds([...meds, { name: "", dose: "" }])}
                      className="mt-2 rounded-lg border border-[var(--p-blue)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--p-blue)]">
                      + Add medicine
                    </button>
                  )}
                  {meds.length === 0 && completed && (
                    <p className="text-[12px] text-[var(--p-muted)]">No discharge medications recorded.</p>
                  )}
                </div>

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
