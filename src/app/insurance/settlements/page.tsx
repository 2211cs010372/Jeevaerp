"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Req, Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";
import { StatusPill } from "@/components/portal/insurance/claims-board";

/**
 * SETTLE UP - what the insurer's answer means for the money.
 *
 * The desk could always see whether a claim was approved. What it could not see,
 * anywhere, was the consequence: a REFUSED claim's bills stay pointed at the
 * insurer, and a bill pointed at an insurer is deliberately kept out of every
 * dues list and every collection total - because on a cashless stay the family
 * genuinely owes nothing.
 *
 * So a refusal produced silence. The money sat against an insurer who had
 * already declined it, invisible to reception, and the only way to find it was
 * to open stays one at a time and read each one's claim panel. Reception's
 * instinct - go and look in Billing - was guaranteed to fail, because that is
 * precisely the screen the bill is being kept off.
 *
 * This is that consequence as a list. Three tabs, in the order somebody acts:
 *
 *   Patient must pay - decided, refused, money still pointed at the insurer.
 *   Waiting          - still with them. Nobody owes anything yet.
 *   Done             - settled by the insurer, or already moved to the patient.
 *
 * Pressing the button on a row does the whole handoff: the bills become the
 * patient's and appear on reception's Billing screen by themselves. Nobody has
 * to be told, and nobody has to go and check.
 */

type Bucket = "PATIENT_PAYS" | "WAITING" | "DONE";

interface Row {
  admissionId: string;
  ipNumber: string;
  patient: { id: string; displayId: string; fullName: string; phone: string };
  insurer: string | null;
  policyNo: string | null;
  admittedAt: string;
  dischargedAt: string | null;
  claims: {
    id: string; claimNo: string; stage: string; status: string;
    claimedAmount: string; approvedAmount: string | null; settledAmount: string | null;
    decisionAt: string | null;
  }[];
  status: string;
  claimed: string;
  approved: string;
  settled: string;
  shortfall: string;
  withInsurer: { count: number; total: string; movable: number; movableTotal: string };
  /** Pointed at the insurer beyond what they agreed to carry. */
  uncovered: string;
  /** Of that gap, what can actually move. See the service. */
  atRisk: string;
  patientDue: string;
  bucket: Bucket;
  outcome: "SETTLED_BY_INSURER" | "BILLED_TO_PATIENT" | null;
  sinceDecisionDays: number | null;
}

interface Board {
  rows: Row[];
  counts: Record<Bucket, number>;
  /** Flat copy of counts.PATIENT_PAYS - the sidebar badge reads this. */
  patientPaysCount: number;
  patientPaysTotal: string;
}

const inr = (v: string | number) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const inr2 = (v: string | number) => "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const TABS: { k: Bucket; label: string; hint: string }[] = [
  { k: "PATIENT_PAYS", label: "Patient must pay", hint: "The insurer refused. Move it onto the family so reception can collect." },
  { k: "WAITING", label: "Waiting on the insurer", hint: "Still with them. Nobody owes anything yet - do not bill the family." },
  { k: "DONE", label: "Done", hint: "Settled by the insurer, or already moved onto the patient." },
];

export default function SettlementsPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [tab, setTab] = useState<Bucket>("PATIENT_PAYS");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  /** The row whose bills are being moved, and the reason being typed for it. */
  const [moving, setMoving] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setBoard(await api.get<Board>("/insurance/settlements")); setError(null); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load the list."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Suspended while the reason box is open - a reload under it takes the
  // half-typed reason with it.
  useLive([TOPICS.INSURANCE], load, { enabled: !moving });

  const shown = useMemo(() => {
    const rows = (board?.rows ?? []).filter((r) => r.bucket === tab);
    if (!q.trim()) return rows;
    const t = q.toLowerCase();
    return rows.filter((r) =>
      r.patient.fullName.toLowerCase().includes(t) ||
      r.patient.displayId.toLowerCase().includes(t) ||
      r.ipNumber.toLowerCase().includes(t) ||
      (r.insurer ?? "").toLowerCase().includes(t) ||
      (r.policyNo ?? "").toLowerCase().includes(t)
    );
  }, [board, tab, q]);

  async function billThePatient() {
    if (!moving || reason.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<{
        moved: { receiptNo: string }[]; movedTotal: string; skipped: { receiptNo: string; why: string }[];
      }>(`/insurance/admissions/${moving.admissionId}/claims`, { reason: reason.trim() });

      setFlash(
        `${moving.patient.fullName}: ${inr2(r.movedTotal)} across ${r.moved.length} bill` +
        `${r.moved.length === 1 ? "" : "s"} is now theirs. It is already on reception's Billing screen - ` +
        `nobody needs to be told.` +
        (r.skipped.length ? ` ${r.skipped.length} left alone (money already taken against it).` : "")
      );
      setMoving(null); setReason("");
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't move the bills.");
    } finally { setBusy(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-5 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Settle up</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-[var(--p-muted)]">
          What the insurer&apos;s answer means for the money. A refused claim&apos;s bills stay pointed at
          the insurer and are kept out of every dues list by design - so until somebody moves them,
          nobody can collect them and nothing on reception&apos;s screens says so. This is that list.
        </p>
      </div>

      {/* ── THE ONE FIGURE THAT MATTERS ──
          Money nobody can currently collect, because it is still pointed at an
          insurer who already said no. */}
      {board && board.counts.PATIENT_PAYS > 0 && (
        <div data-rise className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-rose)]/30 bg-[var(--p-rose-soft)] px-5 py-4">
          <div>
            <p className="flex items-center gap-2 text-[13.5px] font-bold text-[var(--p-rose)]">
              <Icon name="alert" size={16} />
              {inr2(board.patientPaysTotal)} is pointed at insurers who have not agreed to carry it
            </p>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--p-rose)]">
              Across {board.counts.PATIENT_PAYS} stay{board.counts.PATIENT_PAYS === 1 ? "" : "s"}.
              Nobody can collect a rupee of it while it points at the insurer - not reception, not the
              ward, not the day close. A claim marked <b>settled</b> can still be sitting here: they
              settle what they agreed to, and the rest stays where it was.
            </p>
          </div>
        </div>
      )}

      <div data-rise className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-md border border-[var(--p-border)] bg-white p-1">
          {TABS.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} title={t.hint}
              className={`rounded px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                tab === t.k ? "bg-[var(--p-blue)] text-white" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>
              {t.label}
              {board && board.counts[t.k] > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 text-[10.5px] font-bold ${
                  tab === t.k
                    ? "bg-white/25"
                    : t.k === "PATIENT_PAYS" ? "bg-[var(--p-rose-soft)] text-[var(--p-rose)]" : "bg-[var(--p-border)]/50"}`}>
                  {board.counts[t.k]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[var(--p-border)] bg-white px-3 py-2">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, IP no, insurer, policy…"
            className="w-60 bg-transparent text-sm outline-none" />
        </div>
      </div>

      <p data-rise className="mb-4 text-[12.5px] leading-relaxed text-[var(--p-muted)]">
        {TABS.find((t) => t.k === tab)!.hint}
      </p>

      {flash && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[13.5px] font-medium text-[var(--p-cyan-deep)]">
          <span className="flex items-start gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button onClick={() => setFlash(null)}>✕</button>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13.5px] text-[var(--p-rose)]">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : !board ? (
          // ── A FAILED LOAD IS NOT AN EMPTY LIST ──
          // The reassuring empty state below would say "every refused claim has
          // been dealt with" to somebody whose request just failed. On the one
          // screen that exists to say money is stuck, silence must never read as
          // all-clear.
          <div className="flex flex-col items-center px-6 py-20 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--p-rose)]/40 text-[var(--p-rose)]">
              <Icon name="alert" size={20} />
            </span>
            <p className="mt-3 text-[15px] font-semibold text-[var(--p-ink)]">This list didn&apos;t load.</p>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--p-muted)]">
              So it is not saying there is nothing to collect - it is saying it doesn&apos;t know.
            </p>
            <button onClick={() => { setLoading(true); load(); }}
              className="mt-4 rounded-lg border border-[var(--p-border)] px-4 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
              Try again
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-20 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--p-border)] text-[var(--p-muted)]">
              <Icon name={tab === "PATIENT_PAYS" ? "check" : "shield"} size={20} />
            </span>
            <p className="mt-3 text-[15px] font-semibold text-[var(--p-ink)]">
              {q ? "Nothing matches that."
                : tab === "PATIENT_PAYS" ? "Nothing is stuck with a refusal."
                : tab === "WAITING" ? "Nothing is with an insurer right now."
                : "Nothing has been settled or moved yet."}
            </p>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--p-muted)]">
              {tab === "PATIENT_PAYS"
                ? "Every refused claim has been dealt with - the money is either collected or on the patient."
                : "A stay appears here once a claim is raised against it."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {shown.map((r) => (
              <div key={r.admissionId} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admissions/${r.admissionId}`}
                        className="text-[14px] font-semibold text-[var(--p-ink)] hover:text-[var(--p-blue)]">
                        {r.patient.fullName}
                      </Link>
                      <span className="font-mono text-[11.5px] text-[var(--p-muted)]">{r.patient.displayId}</span>
                      <span className="font-mono text-[11.5px] font-semibold text-[var(--p-blue-deep)]">{r.ipNumber}</span>
                      <StatusPill s={r.status} />
                      {/* How long this has been nobody's job. The point of the
                          whole screen is that it used to be forever. */}
                      {r.bucket === "PATIENT_PAYS" && r.sinceDecisionDays != null && r.sinceDecisionDays > 0 && (
                        <span className="rounded-full bg-[var(--p-rose-soft)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--p-rose)]">
                          {r.sinceDecisionDays}d since they refused
                        </span>
                      )}
                      {r.outcome === "BILLED_TO_PATIENT" && (
                        <span className="rounded-full bg-[var(--p-amber-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[#8a6414]">
                          Billed to the patient
                        </span>
                      )}
                      {r.outcome === "SETTLED_BY_INSURER" && (
                        <span className="rounded-full bg-[var(--p-cyan-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--p-cyan-deep)]">
                          Insurer paid
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-[var(--p-muted)]">
                      {r.insurer ?? "Insurer not recorded"}
                      {r.policyNo && <> · <span className="font-mono">{r.policyNo}</span></>}
                      {" · "}{r.dischargedAt ? `discharged ${day(r.dischargedAt)}` : `admitted ${day(r.admittedAt)}`}
                      {" · "}{r.claims.map((c) => c.claimNo).join(", ")}
                    </div>

                    {/* The arithmetic of the refusal, in words. "Claimed X,
                        they agreed to Y" is the sentence the family is owed
                        when they ask why they are being billed at all. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--p-muted)]">
                      <span>Claimed <b className="font-mono text-[var(--p-ink)]">{inr(r.claimed)}</b></span>
                      <span>Approved <b className="font-mono text-[var(--p-ink)]">{inr(r.approved)}</b></span>
                      {Number(r.settled) > 0 && (
                        <span>Received <b className="font-mono text-[var(--p-cyan-deep)]">{inr(r.settled)}</b></span>
                      )}
                      {Number(r.shortfall) > 0 && (
                        <span className="font-semibold text-[var(--p-rose)]">Short {inr(r.shortfall)}</span>
                      )}
                      {Number(r.patientDue) > 0 && (
                        <span className="font-semibold text-[#8a6414]">
                          Family already owes {inr2(r.patientDue)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {r.withInsurer.count > 0 && (
                      <div className="text-right">
                        <div className="font-mono text-[15px] font-bold text-[var(--p-ink)]">
                          {inr2(r.withInsurer.total)}
                        </div>
                        <div className="text-[11px] text-[var(--p-muted)]">
                          still pointed at the insurer · {r.withInsurer.count} bill{r.withInsurer.count === 1 ? "" : "s"}
                        </div>
                      </div>
                    )}
                    {r.bucket === "PATIENT_PAYS" && (
                      <button onClick={() => { setMoving(r); setReason(""); setError(null); }}
                        className="rounded-lg bg-[var(--p-rose)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90">
                        Bill the patient
                      </button>
                    )}
                    <Link href={`/admissions/${r.admissionId}`}
                      className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                      Open the stay
                    </Link>
                  </div>
                </div>

                {/* ── SOME OF IT CANNOT MOVE ──
                    A bill with money already taken against it is part-collected;
                    re-pointing it would misstate what was taken and from whom.
                    Said on the row, before the button is pressed. */}
                {r.bucket === "PATIENT_PAYS" && r.withInsurer.movable < r.withInsurer.count && (
                  <p className="mt-2 rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[11.5px] leading-relaxed text-[#8a6414]">
                    Only {inr2(r.withInsurer.movableTotal)} of this can move.{" "}
                    {r.withInsurer.count - r.withInsurer.movable} bill
                    {r.withInsurer.count - r.withInsurer.movable === 1 ? " has" : "s have"} money already
                    taken against {r.withInsurer.count - r.withInsurer.movable === 1 ? "it" : "them"} and
                    will be left alone.
                  </p>
                )}

                {/* ── MOVING IT WOULD OVER-BILL THE FAMILY ──
                    Bills move whole. Where one bill straddles the approval, the
                    button hands the family more than the insurer refused - and
                    the usual cause is that the insurer's payment was never
                    recorded against the bill. Refusing outright would be wrong
                    (the gap is real); saying nothing would be worse. */}
                {r.bucket === "PATIENT_PAYS" && Number(r.withInsurer.movableTotal) > Number(r.uncovered) + 0.01 && (
                  <p className="mt-2 rounded-lg bg-[var(--p-rose-soft)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--p-rose)]">
                    <b>Check the insurer&apos;s payment first.</b> Only {inr2(r.uncovered)} of this is
                    genuinely uncovered, but bills move whole — pressing the button would put{" "}
                    {inr2(r.withInsurer.movableTotal)} on this family. That gap usually means the{" "}
                    {inr2(r.approved)} the insurer agreed to was never recorded against the bill.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── THE HANDOFF ──
          A reason is required and stored on the stay's own record, not just in
          the audit log: the family WILL ask why they are being billed for a stay
          they were told was cashless, and the ward has to be able to answer. */}
      {moving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface w-full max-w-lg bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">
                  Bill {moving.patient.fullName} instead
                </h3>
                <p className="mt-0.5 text-[11.5px] text-[var(--p-muted)]">
                  {moving.insurer ?? "The insurer"} agreed to {inr2(moving.approved)} of{" "}
                  {inr2(moving.claimed)} — {inr2(moving.uncovered)} is still pointed at them uncovered.
                </p>
              </div>
              <button onClick={() => { setMoving(null); setReason(""); }}
                className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>

            <div className="space-y-3 p-6">
              <p className="text-[12.5px] leading-relaxed text-[var(--p-text)]">
                <b>{inr2(moving.withInsurer.movableTotal)}</b> across {moving.withInsurer.movable} bill
                {moving.withInsurer.movable === 1 ? "" : "s"} becomes this family&apos;s to pay. It appears on
                reception&apos;s <b>Billing</b> screen straight away - nobody has to be told and nobody has to
                go looking for it.
              </p>
              {Number(moving.withInsurer.movableTotal) > Number(moving.uncovered) + 0.01 && (
                <p className="rounded-lg bg-[var(--p-rose-soft)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--p-rose)]">
                  <b>This moves more than the insurer refused.</b> Only {inr2(moving.uncovered)} is
                  genuinely uncovered, but bills move whole — so the family would be asked for{" "}
                  {inr2(moving.withInsurer.movableTotal)}. Check that the {inr2(moving.approved)} the
                  insurer agreed to has been recorded against the bill before you do this.
                </p>
              )}
              <p className="text-[12.5px] leading-relaxed text-[var(--p-muted)]">
                Do this only once the claim is genuinely finished. A refused pre-auth that is still being
                argued should stay with the insurer - putting the family into the dues list while you are
                on the phone to the TPA is how somebody gets asked for money they do not owe.
              </p>
              <div>
                <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                  Why (kept on the stay&apos;s record)<Req />
                </label>
                <input className={fld} autoFocus value={reason} maxLength={200}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Star Health rejected — pre-existing, ref STR/2026/8841" />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => { setMoving(null); setReason(""); }}
                className="rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)]">
                Cancel
              </button>
              <button onClick={billThePatient} disabled={busy || reason.trim().length < 3}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Moving…</> : <>Bill the patient {inr2(moving.withInsurer.movableTotal)}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
