"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Req, Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";
import { bedLabel } from "@/lib/beds";

/**
 * CORRECTING THE THREE FIGURES THE BILL IS BUILT ON.
 *
 * The bed, the nursing and the number of days are the largest lines on almost
 * every inpatient bill, and until now they were the only ones nobody could
 * touch: two of them came from rates snapshotted onto the stay, and the third
 * from a pair of timestamps no screen exposed. Everything smaller - a dressing,
 * an oxygen hour - had an edit button.
 *
 * So the desk's workaround was an "adjustment" line on the tab. On a discharge
 * sheet that is a charge the family is entitled to ask about and nobody can
 * explain; on a claim it reads as the hospital correcting its own bill.
 *
 * ONE DIALOG, TWO DESKS. Reception opens it to fix an admission typed in the
 * next morning; the insurance room opens it to reprice bed and nursing to the
 * tariff the policy actually settles. Written twice it would drift twice, and
 * these are the numbers a TPA checks first.
 *
 * WHAT IT SHOWS BEFORE YOU SAVE, and why that matters more here than elsewhere:
 * days are charged per STARTED day, so moving an admission by forty minutes can
 * add a whole night to the bill. The preview recomputes the day count, each
 * leg's nights and both totals as you type, using the same arithmetic the server
 * uses - so nobody discovers a ₹8,000 swing from the printed bill.
 *
 * WHAT IT DOES NOT DO: it does not decide whether this desk may rewrite a bill.
 * A discharged stay re-issues its invoice server-side through `updateInvoice`,
 * where `billEditingEnabled`, the filed-IRN refusal and the
 * money-already-collected floor are all enforced. A dialog that hid itself would
 * be a permission made of CSS.
 */

export interface StayLeg {
  id: string; wardName: string; bedNo: string; dailyCharge: string;
  from: string; to: string | null; days: number; total: string; current: boolean;
}

export interface StayBillingSnapshot {
  admittedAt: string;
  dischargedAt: string | null;
  /** ADMITTED, or one of the closed outcomes. */
  status: string;
  /** The whole-stay rate. The only bed rate there is when `legs` is empty. */
  dailyCharge: string;
  nursePerDay: string;
  legs: StayLeg[];
}

const DAY_MS = 86_400_000;
/** The client-side twin of `stayDays` - per started day, minimum one. */
const stayDays = (from: Date, until: Date) =>
  Math.max(1, Math.ceil((until.getTime() - from.getTime()) / DAY_MS));

const pad = (n: number) => String(n).padStart(2, "0");
/** A Date as `<input type="datetime-local">` wants it: local wall clock. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => Number(s) || 0;

export function CorrectStayDialog({
  admissionId,
  stay,
  accent = "teal",
  onClose,
  onSaved,
}: {
  admissionId: string;
  stay: StayBillingSnapshot;
  accent?: "teal" | "blue";
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const closed = stay.status !== "ADMITTED";

  // ── THE MINUTE TRAP ──
  //
  // `datetime-local` has no seconds. A stay admitted at 22:14:37 seeds the box
  // as 22:14, and reading that box back gives 22:14:00 - THIRTY-SEVEN SECONDS
  // EARLIER. Days are charged per started day, so that silent drift is enough to
  // add a whole night. Somebody who opened this to fix the nursing rate, never
  // touched the dates, and pressed Save would watch the bed go up ₹8,000.
  //
  // So the seeded string is kept, and a box still equal to it means the date was
  // NOT edited: the original instant goes back to the server untouched, seconds
  // and all, and the preview below prices it the same way.
  const seededAdmitted = toLocalInput(new Date(stay.admittedAt));
  const seededDischarged = stay.dischargedAt ? toLocalInput(new Date(stay.dischargedAt)) : "";

  const [admitted, setAdmitted] = useState(seededAdmitted);
  const [discharged, setDischarged] = useState(seededDischarged);

  /** The instant to bill from - the untouched original, or what was typed. */
  const admittedAt = admitted === seededAdmitted ? stay.admittedAt : admitted;
  const dischargedAt = discharged === seededDischarged ? stay.dischargedAt : discharged;
  const [nurse, setNurse] = useState(() => String(Number(stay.nursePerDay)));
  const [bedRate, setBedRate] = useState(() => String(Number(stay.dailyCharge)));
  const [legRates, setLegRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(stay.legs.map((l) => [l.id, String(Number(l.dailyCharge))]))
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ring = accent === "blue" ? "var(--p-blue)" : "var(--p-teal)";

  // ── THE BILL, RECOMPUTED AS YOU TYPE ──
  //
  // Same arithmetic as the server: per started day, each leg priced on its own
  // between its own dates, and the first leg dragged along by the admission
  // date because that is what the correction does to it on the way in.
  const preview = useMemo(() => {
    const from = new Date(admittedAt);
    const to = dischargedAt ? new Date(dischargedAt) : null;
    if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime()))) return null;

    const now = new Date();
    const until = to ?? now;
    if (until <= from) return null;

    const days = stayDays(from, until);
    const legs = stay.legs.map((l, i) => {
      const legFrom = i === 0 ? from : new Date(l.from);
      const legTo = l.to ? new Date(l.to) : until;
      const d = stayDays(legFrom, legTo);
      const rate = num(legRates[l.id] ?? l.dailyCharge);
      return { ...l, days: d, rate, total: d * rate };
    });
    const bedTotal = legs.length
      ? legs.reduce((s, l) => s + l.total, 0)
      : days * num(bedRate);
    const nurseTotal = days * num(nurse);
    return { days, legs, bedTotal, nurseTotal, total: bedTotal + nurseTotal };
  }, [admittedAt, dischargedAt, legRates, bedRate, nurse, stay.legs]);

  // What it costs today, so the dialog can show the swing rather than only the
  // new figure. A desk correcting a date wants to know what it moved.
  const wasBed = stay.legs.length
    ? stay.legs.reduce((s, l) => s + num(l.total), 0)
    : stayDays(new Date(stay.admittedAt), stay.dischargedAt ? new Date(stay.dischargedAt) : new Date()) * num(stay.dailyCharge);
  const wasDays = stayDays(
    new Date(stay.admittedAt),
    stay.dischargedAt ? new Date(stay.dischargedAt) : new Date()
  );
  const wasNurse = wasDays * num(stay.nursePerDay);
  const wasTotal = wasBed + wasNurse;
  const delta = preview ? preview.total - wasTotal : 0;

  // Checked independently of `preview`, which goes null for a future admission
  // too - and "the stay would end before it started" is the wrong thing to tell
  // somebody who typed next Tuesday.
  const future =
    new Date(admittedAt) > new Date() || (!!dischargedAt && new Date(dischargedAt) > new Date());

  async function save() {
    if (!preview || future) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/ipd/admissions/${admissionId}/billing`, {
        admittedAt: new Date(admittedAt).toISOString(),
        ...(closed && dischargedAt ? { dischargedAt: new Date(dischargedAt).toISOString() } : {}),
        nursePerDay: num(nurse),
        ...(stay.legs.length === 0 ? { bedRate: num(bedRate) } : {}),
        legs: stay.legs.map((l) => ({ id: l.id, dailyCharge: num(legRates[l.id] ?? l.dailyCharge) })),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onSaved(
        closed
          ? "Stay corrected. The discharge bill has been re-issued to match."
          : "Stay corrected. The running tab is on the new figures."
      );
    } catch (e) {
      // The 403 from a switched-off desk and the "refund the difference first"
      // refusal both arrive here already worded for the reader. Do not replace
      // them with something generic.
      setError(e instanceof ApiClientError ? e.message : "Could not save the correction.");
    } finally { setBusy(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none";
  const label = "mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]";
  const maxNow = toLocalInput(new Date());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="surface w-full max-w-2xl bg-white">
        <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
          <div>
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Correct the stay&apos;s charges</h3>
            <p className="mt-0.5 text-[11.5px] text-[var(--p-muted)]">
              The dates, the bed rate and the nursing rate. Everything else on the tab is edited as a line.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
        </div>

        {error && (
          <div className="border-b border-[var(--p-border)] bg-[var(--p-rose-soft)] px-6 py-3 text-[12.5px] text-[var(--p-rose)]">
            {error}
          </div>
        )}

        {/* ── THE BILL IS ALREADY ISSUED ──
            Said before anything is typed. A correction here rewrites a document
            the family or the insurer is already holding. */}
        {closed && (
          <div className="border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-6 py-3 text-[12px] leading-relaxed text-[#8a6414]">
            <strong>This stay is discharged and its bill is issued.</strong> Saving re-issues that invoice on
            the new figures, keeping its receipt number — so the claim bill and the tax invoice never
            disagree. A correction that would take the total below money already collected is refused;
            refund the difference first.
          </div>
        )}

        <div className="max-h-[62vh] overflow-y-auto overscroll-contain p-6">
          {/* ── DATES ── first, because they move every other number on the page */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Admitted<Req /></label>
              <input type="datetime-local" className={fld} value={admitted} max={maxNow}
                onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                onChange={(e) => setAdmitted(e.target.value)} />
            </div>
            <div>
              <label className={label}>Discharged{closed && <Req />}</label>
              <input type="datetime-local" className={`${fld} disabled:bg-[var(--p-bg)] disabled:text-[var(--p-muted)]`}
                value={discharged} max={maxNow} disabled={!closed}
                onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                onChange={(e) => setDischarged(e.target.value)} />
              {!closed && (
                <p className="mt-1.5 text-[11.5px] text-[var(--p-muted)]">
                  Still in a bed — the tab runs to today. Discharging the patient sets this.
                </p>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
            The <strong>time</strong> counts. A stay is charged per started day, so an admission moved from
            23:40 to 00:10 the next morning is one whole day less on the bill.
          </p>

          {/* ── BED ── one rate per leg. A transferred patient has two, and one
              averaged figure cannot tell an insurer which nights were ICU. */}
          <div className="mt-6 border-t border-[var(--p-border)] pt-5">
            <label className={label}>Bed charges — per day</label>
            {stay.legs.length === 0 ? (
              <div className="max-w-[220px]">
                <input className={fld} value={bedRate} inputMode="decimal"
                  onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                  onChange={(e) => setBedRate(e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
            ) : (
              <div className="space-y-2">
                {stay.legs.map((l) => {
                  const p = preview?.legs.find((x) => x.id === l.id);
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1 text-[13px] text-[var(--p-ink)]">
                        {bedLabel(l.wardName, l.bedNo)}
                        {l.current && (
                          <span className="ml-2 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--p-blue-deep)]">
                            now
                          </span>
                        )}
                      </span>
                      <input className={`${fld} !w-[120px]`} value={legRates[l.id] ?? ""} inputMode="decimal"
                        onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                        onChange={(e) => setLegRates((r) => ({ ...r, [l.id]: e.target.value.replace(/[^\d.]/g, "") }))} />
                      <span className="w-[150px] shrink-0 text-right font-mono text-[12.5px] text-[var(--p-muted)]">
                        × {p?.days ?? l.days}d = ₹{money(p?.total ?? num(l.total))}
                      </span>
                    </div>
                  );
                })}
                {stay.legs.length > 1 && (
                  <p className="text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                    Two rows means this patient was transferred. Each leg keeps its own rate — an insurer
                    paying an ICU entitlement has to see which nights were actually ICU.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── NURSING ── */}
          <div className="mt-5">
            <label className={label}>Nursing care — per day</label>
            <div className="flex flex-wrap items-center gap-3">
              <input className={`${fld} !w-[120px]`} value={nurse} inputMode="decimal"
                onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                onChange={(e) => setNurse(e.target.value.replace(/[^\d.]/g, ""))} />
              <span className="font-mono text-[12.5px] text-[var(--p-muted)]">
                × {preview?.days ?? wasDays}d = ₹{money(preview?.nurseTotal ?? wasNurse)}
              </span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
              Set on this stay alone. Changing it here never touches the hospital&apos;s standard rate or any
              other patient&apos;s bill.
            </p>
          </div>

          {/* ── WHY ── */}
          <div className="mt-5">
            <label className={label}>Why (optional)</label>
            <input className={fld} value={reason} maxLength={200}
              placeholder="e.g. admitted 11pm, entered next morning — or: Star Health settles nursing at ₹450"
              onFocus={(e) => (e.currentTarget.style.borderColor = ring)}
              onBlur={(e) => (e.currentTarget.style.borderColor = "")}
              onChange={(e) => setReason(e.target.value)} />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
              Kept on the stay&apos;s record with the old figures and the new ones, against your name.
            </p>
          </div>

          {/* ── WHAT IT COMES TO ── */}
          <div className="mt-6 rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3">
            {future || !preview ? (
              <p className="text-[12.5px] text-[var(--p-rose)]">
                {future
                  ? "A stay can't start or end in the future."
                  : "Those dates don't work — the stay would end before it started."}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--p-muted)]">Days</span>
                  <span className="font-mono text-[var(--p-ink)]">
                    {preview.days}{preview.days !== wasDays && <span className="text-[var(--p-muted)]"> (was {wasDays})</span>}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[13px]">
                  <span className="text-[var(--p-muted)]">Bed</span>
                  <span className="font-mono text-[var(--p-ink)]">₹{money(preview.bedTotal)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[13px]">
                  <span className="text-[var(--p-muted)]">Nursing</span>
                  <span className="font-mono text-[var(--p-ink)]">₹{money(preview.nurseTotal)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-[var(--p-border)] pt-2">
                  <span className="text-[13px] font-semibold text-[var(--p-ink)]">Bed + nursing</span>
                  <span className="font-mono text-[15px] font-bold text-[var(--p-ink)]">₹{money(preview.total)}</span>
                </div>
                {Math.abs(delta) >= 0.01 && (
                  <p className={`mt-2 text-[12px] font-semibold ${delta > 0 ? "text-[#8a6414]" : "text-[var(--p-teal-deep)]"}`}>
                    {delta > 0 ? "↑" : "↓"} ₹{money(Math.abs(delta))} on what this stay bills today.
                    {" "}
                    <span className="font-normal text-[var(--p-muted)]">
                      The tab&apos;s other charges are not affected.
                    </span>
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--p-border)] p-5">
          <button onClick={onClose}
            className="rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-muted)]">
            Cancel
          </button>
          <button onClick={save} disabled={busy || !preview || future}
            style={{ background: ring }}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
            {busy ? <><Spinner /> Saving…</> : <><Icon name="check" size={14} /> {closed ? "Save & re-issue the bill" : "Save the correction"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
