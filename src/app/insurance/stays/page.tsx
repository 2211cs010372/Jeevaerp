"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";
import { StatusPill, NewClaim, type ClaimPrefill } from "@/components/portal/insurance/claims-board";
import { bedLabel } from "@/lib/beds";
// One definition of which stage a stay still owes, shared with the stay's own
// screen - both draw these two buttons. See final-claim.ts.
import { openPreAuth, openFinalClaim } from "@/lib/final-claim";

/**
 * INSURANCE STAYS - every patient this desk is responsible for.
 *
 * The list of things that are LATE ("To raise") is not the same list as the
 * people you look after, and this desk needs both. Before this page existed the
 * bill was reachable only through the late list, so the moment a pre-authorisation
 * was submitted the stay disappeared - along with any route to reprice the bill
 * it would actually be settled on, or reprint it when the TPA asked again. The
 * work outlives the reminder to start it.
 *
 * Every row leads to the same place: the stay's bill.
 */

interface Stay {
  admissionId: string; ipNumber: string;
  patient: { id: string; displayId: string; fullName: string; phone: string };
  /** SELF_PAY rows only appear on the self-pay tab - see the payer filter. */
  payerType: string;
  insurer: string | null; policyNo: string | null;
  ward: string; bedNo: string;
  admittedAt: string; dischargedAt: string | null; days: number;
  amount: string;
  claims: { id: string; claimNo: string; stage: string; status: string; claimedAmount: string }[];
}

/**
 * ── WHICH PATIENTS THIS DESK CAN SEE ──
 *
 * Cashless first and by default: an unauthorized cashless stay is money the
 * hospital loses, so that list must never be diluted by rows nobody is
 * accountable for.
 *
 * Self-paying stays are the second tab because the family paying the counter
 * does not mean the family has no policy. They pay in full - the policy was not
 * produced at admission, or the TPA is not on the panel - and then claim the
 * money back themselves. The hospital's part is the paperwork, and until now the
 * desk had to rebuild the stay by hand on the claims board to produce it.
 */
type Payer = "INSURANCE" | "SELF_PAY";
const PAYERS: { k: Payer; label: string; hint: string }[] = [
  { k: "INSURANCE", label: "Cashless", hint: "Admitted on a policy. The hospital bills the insurer directly." },
  { k: "SELF_PAY", label: "Self-paying", hint: "The family settles at the counter. Raise a reimbursement claim so they can get it back from their own insurer." },
];

const inr = (v: string | number) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

type Tab = "IN_BED" | "DISCHARGED" | "ALL";
const TABS: { k: Tab; label: string }[] = [
  { k: "IN_BED", label: "In a bed" },
  { k: "DISCHARGED", label: "Discharged" },
  { k: "ALL", label: "All" },
];

export default function StaysPage() {
  const [stays, setStays] = useState<Stay[]>([]);
  const [tab, setTab] = useState<Tab>("IN_BED");
  const [payer, setPayer] = useState<Payer>("INSURANCE");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** The stay a reimbursement claim is being raised against, prefilled. */
  const [raising, setRaising] = useState<ClaimPrefill | null>(null);
  /** The insurer picker's options, same source the pending screen uses. */
  const [insurers, setInsurers] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  /** The stay whose policy number is being typed in, and what is in the box. */
  const [policyFor, setPolicyFor] = useState<string | null>(null);
  const [policyVal, setPolicyVal] = useState("");
  const [policyBusy, setPolicyBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStays((await api.get<{ stays: Stay[] }>(`/insurance/stays?payer=${payer}`)).stays);
      setError(null);
    }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load the list."); }
    finally { setLoading(false); }
  }, [payer]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    api.get<{ insurers: string[] }>("/insurance?status=ALL")
      .then((r) => setInsurers(r.insurers)).catch(() => {});
  }, []);
  // Not while the claim form or a policy box is open - a reload behind them is
  // harmless, but the list jumping under a half-typed entry is not.
  useLive([TOPICS.INSURANCE], load, { enabled: !raising && !policyFor });

  const shown = useMemo(() => stays.filter((s) => {
    if (tab === "IN_BED" && s.dischargedAt) return false;
    if (tab === "DISCHARGED" && !s.dischargedAt) return false;
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return s.patient.fullName.toLowerCase().includes(t)
      || s.patient.displayId.toLowerCase().includes(t)
      || s.ipNumber.toLowerCase().includes(t)
      || (s.insurer ?? "").toLowerCase().includes(t)
      || (s.policyNo ?? "").toLowerCase().includes(t);
  }), [stays, tab, q]);

  const inBed = stays.filter((s) => !s.dischargedAt).length;

  /**
   * Raise one of the two stages off a row, prefilled from it.
   *
   * CASHLESS, not reimbursement: a stay on this tab was treated on the promise
   * that the insurer pays directly. The reimbursement button below is the other
   * shape and belongs to the self-paying tab, where the family has already
   * settled at the counter.
   *
   * The amount is a starting point in whole rupees - the running total for a
   * stay still going, the final bill for one that has ended - and the form
   * leaves it editable, because a pre-auth estimates the WHOLE stay and only the
   * desk knows what the surgeon has planned for tomorrow.
   */
  function raise(s: Stay, stage: "PRE_AUTH" | "FINAL") {
    setRaising({
      patient: { ...s.patient, age: null },
      stage,
      type: "CASHLESS",
      claimedAmount: String(Math.round(Number(s.amount))),
      admissionId: s.admissionId,
      insurer: s.insurer ?? undefined,
      policyNo: s.policyNo ?? undefined,
    });
  }

  /** Write the policy number onto the stay - and onto the claims still waiting
   *  on an answer, which is the half that reaches the TPA. See setStayPolicy. */
  async function savePolicy(s: Stay) {
    setPolicyBusy(true);
    try {
      const r = await api.patch<{ policyNo: string | null; claimsUpdated: number }>(
        `/insurance/admissions/${s.admissionId}/policy`, { policyNo: policyVal.trim() });
      setPolicyFor(null); setPolicyVal(""); setError(null);
      setFlash(r.policyNo
        ? `Policy ${r.policyNo} saved on ${s.ipNumber}${r.claimsUpdated > 0
            ? ` and onto ${r.claimsUpdated} claim${r.claimsUpdated === 1 ? "" : "s"} still with the insurer`
            : ""}.`
        : `Policy number cleared on ${s.ipNumber}.`);
      load();
    }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't save the policy number."); }
    finally { setPolicyBusy(false); }
  }

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-5 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Insurance stays</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-[var(--p-muted)]">
          {payer === "INSURANCE"
            ? "Every patient admitted on a policy. Open one to price its bill against that policy's tariff, or to print the claim bill again."
            : "Patients whose families settled at the counter. They may still hold a policy - raise a reimbursement claim so they can get the money back themselves. Nothing here changes what was collected."}
        </p>
      </div>

      {/* ── WHO IS PAYING ──
          Cashless is the accountable list and stays first. Self-paying is a
          second door onto the same patients, not a filter on the same list -
          which is why it reloads rather than filtering client-side: the server
          never sent these rows before. */}
      <div data-rise className="mb-4 flex flex-wrap gap-1 rounded-md border border-[var(--p-border)] bg-white p-1">
        {PAYERS.map((p) => (
          <button key={p.k} onClick={() => setPayer(p.k)} title={p.hint}
            className={`rounded px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
              payer === p.k ? "bg-[var(--p-ink)] text-white" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>
            {p.label}
          </button>
        ))}
      </div>

      <div data-rise className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-md border border-[var(--p-border)] bg-white p-1">
          {TABS.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`rounded px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                tab === t.k ? "bg-[var(--p-blue)] text-white" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>
              {t.label}{t.k === "IN_BED" && inBed > 0 ? ` (${inBed})` : ""}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[var(--p-border)] bg-white px-3 py-2">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, IP no, insurer, policy…"
            className="w-60 bg-transparent text-sm outline-none" />
        </div>
      </div>

      {flash && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[13.5px] font-medium text-[var(--p-cyan-deep)]">
          <span className="flex items-start gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button onClick={() => setFlash(null)}>✕</button>
        </div>
      )}
      {error && <div className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{error}</div>}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-20 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--p-border)] text-[var(--p-muted)]"><Icon name="bed" size={20} /></span>
            <p className="mt-3 text-[15px] font-semibold text-[var(--p-ink)]">
              {q ? "Nothing matches that."
                : tab === "IN_BED"
                  ? (payer === "INSURANCE" ? "Nobody is in a bed on a policy right now." : "Nobody is in a bed paying their own way right now.")
                  : "Nothing here."}
            </p>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--p-muted)]">
              {payer === "INSURANCE"
                ? "A stay appears here the moment reception admits somebody and marks them as insurance."
                : "Every stay reception admits as self-paying appears here, whether or not the family has a policy."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {shown.map((s) => (
              // The whole row still opens the stay - but printing the bill is now
              // a second destination, and a nested <a> inside an <a> is invalid
              // HTML that browsers resolve by dropping one of them. So the row
              // link is a stretched overlay instead: the card is still clickable
              // edge to edge, and the print button sits above it on its own.
              <div key={s.admissionId}
                className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-[var(--p-bg)]">
                <Link href={`/admissions/${s.admissionId}`} className="absolute inset-0"
                  aria-label={`Open ${s.patient.fullName}'s stay`} />
                <div className="pointer-events-none min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--p-ink)]">{s.patient.fullName}</span>
                    <span className="font-mono text-[11.5px] text-[var(--p-muted)]">{s.patient.displayId}</span>
                    <span className="font-mono text-[11.5px] font-semibold text-[var(--p-blue-deep)]">{s.ipNumber}</span>
                    {!s.dischargedAt && (
                      <span className="rounded-full bg-[var(--p-cyan-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-cyan-deep)]">
                        Day {s.days}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-[var(--p-muted)]">
                    {s.payerType === "SELF_PAY" ? "Paying at the counter" : (s.insurer ?? "Insurer not recorded")}
                    {/* ── THE POLICY NUMBER NOBODY TOOK AT ADMISSION ──
                        Reception admits on the promise of a card the family is
                        still looking for, so this is blank far more often than
                        the form suggests - and the number turns up here, at the
                        desk holding the card, with nowhere to be typed. Printing
                        nothing at all read as "this stay has no policy", which
                        is a different thing from "nobody has given us it yet".

                        An existing number opens the same box, because the second
                        commonest state of a hand-copied policy number is a typo.
                        `pointer-events-auto` because the row is covered by a
                        stretched link - see the overlay above. */}
                    {s.payerType === "INSURANCE" && (
                      s.policyNo ? (
                        <> · <button onClick={() => { setPolicyFor(s.admissionId); setPolicyVal(s.policyNo ?? ""); }}
                          title="Correct this policy number"
                          className="pointer-events-auto relative font-mono underline decoration-dotted underline-offset-2 hover:text-[var(--p-blue)]">
                          {s.policyNo}
                        </button></>
                      ) : (
                        <> · <button onClick={() => { setPolicyFor(s.admissionId); setPolicyVal(""); }}
                          title="Record the policy number on this stay - it goes onto the claims still with the insurer too"
                          className="pointer-events-auto relative font-semibold text-[var(--p-amber)] underline decoration-dotted underline-offset-2 hover:text-[var(--p-blue)]">
                          + policy no
                        </button></>
                      )
                    )}
                    {s.payerType === "SELF_PAY" && s.policyNo && <> · <span className="font-mono">{s.policyNo}</span></>}
                    {" · "}{bedLabel(s.ward, s.bedNo)}
                    {" · "}
                    {s.dischargedAt ? `discharged ${day(s.dischargedAt)}` : `admitted ${day(s.admittedAt)}`}
                  </div>

                  {/* Its own line, not inline in the meta above: that line
                      truncates, and a box you are typing into must never be the
                      thing that gets cut off. Empty + Save clears it. */}
                  {policyFor === s.admissionId && (
                    <div className="pointer-events-auto relative mt-1.5 flex flex-wrap items-center gap-2">
                      <input autoFocus value={policyVal} maxLength={60}
                        onChange={(e) => setPolicyVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !policyBusy) savePolicy(s);
                          if (e.key === "Escape") { setPolicyFor(null); setPolicyVal(""); }
                        }}
                        placeholder="P/1234/5678"
                        className="w-48 rounded-md border border-[var(--p-border)] bg-white px-2.5 py-1.5 font-mono text-[12px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]" />
                      <button onClick={() => savePolicy(s)} disabled={policyBusy}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--p-blue)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)] disabled:opacity-40">
                        {policyBusy ? <Spinner size={12} /> : <Icon name="check" size={13} />} Save
                      </button>
                      <button onClick={() => { setPolicyFor(null); setPolicyVal(""); }}
                        className="text-[12px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Cancel</button>
                    </div>
                  )}
                  {/* Where each claim stands. No claim yet says so in words - a
                      blank row would read as "nothing to do". */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {s.claims.length === 0 ? (
                      s.payerType === "SELF_PAY" ? (
                        <span className="rounded-full bg-[var(--p-border)]/40 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--p-muted)]">
                          No claim - the family paid
                        </span>
                      ) : (
                        <span className="rounded-full bg-[var(--p-rose-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--p-rose)]">
                          No claim raised
                        </span>
                      )
                    ) : s.claims.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-[var(--p-muted)]">
                          {c.stage === "PRE_AUTH" ? "Pre-auth" : "Final"}
                        </span>
                        <StatusPill s={c.status} />
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5">
                  <div className="pointer-events-none mr-1 text-right">
                    <div className="font-mono text-[15px] font-bold text-[var(--p-ink)]">{inr(s.amount)}</div>
                    <div className="text-[11px] text-[var(--p-muted)]">{s.dischargedAt ? "final bill" : "run up so far"}</div>
                  </div>
                  {/* Both tabs get this. A stay still in a bed prints the running
                      total, which is exactly what a pre-authorisation needs, and
                      a discharged one prints the closed stay. Same sheet, same
                      route; the only difference is whether an invoice exists
                      behind it yet. The sheet itself is headed IP BILL either
                      way - it does not caveat a running stay on the page. */}
                  <a href={`/print/bill/${s.admissionId}`} target="_blank" rel="noreferrer"
                    title={s.dischargedAt ? "Print the final claim bill" : "Print the bill as it stands - the stay is still running"}
                    className="relative inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] transition-colors hover:border-[var(--p-blue)]">
                    <Icon name="printer" size={13} />
                    {s.dischargedAt ? "Bill" : "Provisional"}
                  </a>

                  {/* ── BOTH STAGES, SIDE BY SIDE, ON THE ROW ──
                      Each one disappears once its own claim exists - which is
                      what takes "Pre-auth" away the moment the insurer approves
                      one, leaving the final claim as the only thing left to
                      send. See openPreAuth / openFinalClaim in final-claim.ts.

                      Outlined rather than filled, both of them. This is a list
                      the desk SCANS - the claim pills to the left already say
                      where each stay stands - and a column of solid blue buttons
                      turns every row into a call to action. The stay's own
                      screen is where one of the two gets emphasis. */}
                  {s.payerType === "INSURANCE" && !openPreAuth(s.claims) && (
                    <button onClick={() => raise(s, "PRE_AUTH")}
                      title="Raise a pre-authorisation on this stay - an estimate for the whole stay, sent before the insurer is billed"
                      className="relative inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-cyan-deep)] transition-colors hover:border-[var(--p-cyan)]">
                      <Icon name="shield" size={13} /> Pre-auth
                    </button>
                  )}
                  {s.payerType === "INSURANCE" && !openFinalClaim(s.claims) && (
                    <button onClick={() => raise(s, "FINAL")}
                      title="Raise the final claim on this stay - what is actually billed to the insurer"
                      className="relative inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue-deep)] transition-colors hover:border-[var(--p-blue)]">
                      <Icon name="receipt" size={13} /> Final
                    </button>
                  )}

                  {/* ── THE REIMBURSEMENT ──
                      Only on a self-paying stay, and only where no claim exists
                      yet. Prefilled from the row so the desk confirms rather
                      than re-types: re-keying an IP number and an amount off a
                      screen that already shows both is how the wrong admission
                      ends up attached to somebody's claim.

                      FINAL stage, not PRE_AUTH: there is nothing to
                      pre-authorize on treatment the family has already paid
                      for. And the money is NOT touched - the drawer really did
                      take that cash, the bill stays SELF_PAY, and this only
                      produces the paperwork the family claims with. */}
                  {s.payerType === "SELF_PAY" && s.claims.length === 0 && (
                    <button
                      onClick={() => setRaising({
                        patient: { ...s.patient, age: null },
                        stage: "FINAL",
                        type: "REIMBURSEMENT",
                        claimedAmount: s.amount,
                        admissionId: s.admissionId,
                        insurer: s.insurer ?? undefined,
                        policyNo: s.policyNo ?? undefined,
                      })}
                      title="Raise a reimbursement claim so the family can recover this from their own insurer"
                      className="relative inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-teal)] transition-colors hover:border-[var(--p-teal)]">
                      <Icon name="shield" size={13} /> Claim
                    </button>
                  )}
                  <Icon name="chevron" size={16} className="pointer-events-none" />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {raising && (
        <NewClaim
          apiBase="/insurance"
          insurers={insurers}
          prefill={raising}
          onClose={() => setRaising(null)}
          onCreated={(c) => {
            setRaising(null);
            setFlash(c.type === "REIMBURSEMENT"
              ? `${c.claimNo} raised for reimbursement. Nothing collected has changed - this is the paperwork the family claims with.`
              : `${c.stage === "PRE_AUTH" ? "Pre-auth" : "Final claim"} ${c.claimNo} raised for ₹${Number(c.claimedAmount).toLocaleString("en-IN")} - it is a draft until you send it to the insurer.`);
            load();
          }}
        />
      )}
    </PortalScroll>
  );
}
