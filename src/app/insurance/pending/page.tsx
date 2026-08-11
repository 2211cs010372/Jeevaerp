"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";
import { NewClaim, type ClaimPrefill } from "@/components/portal/insurance/claims-board";
import { bedLabel } from "@/lib/beds";

/**
 * TO RAISE - stays that reception flagged as insurance and nobody has claimed for.
 *
 * This screen is the reason the portal exists. Everything else here (the claims
 * board, the timeline) was already built; what was missing was the list that says
 * WHO IS WAITING, and the answer had been living in somebody's memory.
 *
 * Sorted by how long each has been waiting, worst first, because a pre-auth that
 * is six hours old and one that is three days old are not the same problem and a
 * list sorted by name hides that completely.
 */

interface PendingItem {
  admissionId: string;
  ipNumber: string;
  patient: { id: string; displayId: string; fullName: string; phone: string };
  insurer: string; policyNo: string; memberId: string | null;
  ward: string; bedNo: string;
  admittedAt: string; dischargedAt: string | null;
  days: number;
  stage: "PRE_AUTH" | "FINAL";
  amount: string;
  invoiceId: string | null; invoiceNo: string | null;
  waitingHours: number;
  claimId: string | null; claimNo: string | null;
  /** What is actually missing on this row - see PendingWorkDTO. */
  need: "SET_AMOUNT" | "SUBMIT" | "RAISE";
}

const inr = (v: string | number) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * How long it has been waiting, in the units a person would use out loud.
 * "52h" makes somebody do arithmetic before they can feel it; "2 days" does not.
 */
function waited(hours: number) {
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/**
 * Urgency, and only three steps of it.
 *
 * A pre-auth is graded in hours because an unauthorized stay is accruing cost
 * that the insurer can still refuse. A final claim is graded in days - the money
 * is already spent, so lateness costs interest and goodwill, not the claim.
 */
function urgency(it: PendingItem): { cls: string; label: string } {
  const h = it.waitingHours;
  if (it.stage === "PRE_AUTH") {
    if (h >= 48) return { cls: "urg-late", label: "Overdue" };
    if (h >= 12) return { cls: "urg-soon", label: "Due" };
    return { cls: "urg-ok", label: "New" };
  }
  if (h >= 24 * 14) return { cls: "urg-late", label: "Overdue" };
  if (h >= 24 * 3) return { cls: "urg-soon", label: "Due" };
  return { cls: "urg-ok", label: "New" };
}

export default function PendingPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [insurers, setInsurers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [raising, setRaising] = useState<ClaimPrefill | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: PendingItem[]; count: number }>("/insurance/pending");
      setItems(r.items);
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load the list."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // The insurer directory, so the claim form's picker is populated before the
  // desk opens it rather than a beat afterwards.
  useEffect(() => {
    api.get<{ insurers: string[] }>("/insurance?status=ALL").then((r) => setInsurers(r.insurers)).catch(() => {});
  }, []);

  // Somebody being admitted two floors away is what puts work on this screen.
  // Without this the desk finds out at the end of the shift, or not at all.
  useLive([TOPICS.INSURANCE], load);

  const preAuth = items.filter((i) => i.stage === "PRE_AUTH");
  const final = items.filter((i) => i.stage === "FINAL");

  function raise(it: PendingItem) {
    setRaising({
      patient: { ...it.patient, age: null },
      insurer: it.insurer === "-" ? "" : it.insurer,
      policyNo: it.policyNo === "-" ? "" : it.policyNo,
      memberId: it.memberId ?? "",
      stage: it.stage,
      // Pre-filled from what the stay has actually run up. Still editable: a
      // pre-auth is an estimate of the WHOLE stay, and only the desk knows what
      // the surgeon has planned for tomorrow.
      claimedAmount: String(Math.round(Number(it.amount))),
      admissionId: it.admissionId,
      invoiceId: it.invoiceId ?? undefined,
    });
  }

  return (
    <PortalScroll>
      <style>{CSS}</style>

      <div data-rise className="surface dotgrid mb-5 flex flex-wrap items-end justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">To raise</h1>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-[var(--p-muted)]">
            Stays the front desk marked as <b className="text-[var(--p-ink)]">insurance</b> that have no claim
            against them yet. Longest wait first - work down from the top.
          </p>
        </div>
        <div className="flex gap-2">
          <Count n={preAuth.length} label="pre-auth" tone={preAuth.length ? "rose" : "quiet"} />
          <Count n={final.length} label="final claim" tone={final.length ? "amber" : "quiet"} />
        </div>
      </div>

      {flash && (
        <div data-rise className="mb-4 flex items-center justify-between rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[14px] font-medium text-[var(--p-cyan-deep)]">
          <span className="flex items-center gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button onClick={() => setFlash(null)}>✕</button>
        </div>
      )}
      {error && <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : items.length === 0 ? (
        <section data-rise className="surface flex flex-col items-center px-6 py-20 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"><Icon name="check" size={22} /></span>
          <p className="mt-3 text-[15px] font-semibold text-[var(--p-ink)]">Nothing waiting.</p>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--p-muted)]">
            Every insurance stay has a claim against it. New ones appear here the moment
            reception admits somebody on a policy - you don&apos;t need to refresh.
          </p>
        </section>
      ) : (
        <div className="space-y-5">
          {preAuth.length > 0 && (
            <Group
              title="Pre-authorization"
              blurb="In a bed right now, treatment not yet authorized. The insurer can refuse an unauthorized stay in full."
              items={preAuth} onRaise={raise}
            />
          )}
          {final.length > 0 && (
            <Group
              title="Final claim"
              blurb="Discharged and billed. The money is already spent - this is the hospital asking for it back."
              items={final} onRaise={raise}
            />
          )}
        </div>
      )}

      {raising && (
        <NewClaim
          apiBase="/insurance"
          insurers={insurers}
          prefill={raising}
          onClose={() => setRaising(null)}
          onCreated={(c) => {
            setRaising(null);
            setFlash(`Claim ${c.claimNo} raised for ${c.patient.fullName}. Submit it to the insurer from Claims.`);
            load();
          }}
        />
      )}
    </PortalScroll>
  );
}

function Group({ title, blurb, items, onRaise }: {
  title: string; blurb: string; items: PendingItem[]; onRaise: (it: PendingItem) => void;
}) {
  return (
    <section data-rise className="surface overflow-hidden">
      <div className="border-b border-[var(--p-border)] px-6 py-4">
        <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">{title} <span className="ml-1 font-mono text-[12px] font-normal text-[var(--p-muted)]">({items.length})</span></h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--p-muted)]">{blurb}</p>
      </div>
      <div className="divide-y divide-[var(--p-border)]">
        {items.map((it) => {
          const u = urgency(it);
          return (
            <div key={`${it.admissionId}:${it.stage}`} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
              <div className="flex min-w-0 items-center gap-4">
                <span className={`urg ${u.cls}`} title={`${u.label} · waiting ${waited(it.waitingHours)}`}>
                  <span className="urg-n">{waited(it.waitingHours)}</span>
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The name is always a way in to the bill, whatever the
                        action button on the right happens to be. Reaching a
                        stay's charges must not depend on whether a claim has
                        been raised yet - repricing the bill is usually the FIRST
                        thing the desk does, before it knows what to claim. */}
                    <Link href={`/admissions/${it.admissionId}`}
                      className="text-[14px] font-semibold text-[var(--p-ink)] underline-offset-2 hover:text-[var(--p-blue)] hover:underline">
                      {it.patient.fullName}
                    </Link>
                    <span className="font-mono text-[11.5px] text-[var(--p-muted)]">{it.patient.displayId}</span>
                    <span className="font-mono text-[11.5px] font-semibold text-[var(--p-blue-deep)]">{it.ipNumber}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-[var(--p-muted)]">
                    {it.insurer} · policy <span className="font-mono">{it.policyNo}</span>
                    {" · "}{bedLabel(it.ward, it.bedNo)}
                    {" · "}
                    {it.dischargedAt
                      ? <>discharged {day(it.dischargedAt)}{it.invoiceNo && <> · bill <span className="font-mono">{it.invoiceNo}</span></>}</>
                      : <>admitted {day(it.admittedAt)} · day {it.days}</>}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-5">
                <div className="text-right">
                  <div className="font-mono text-[15px] font-bold text-[var(--p-ink)]">{inr(it.amount)}</div>
                  <div className="text-[11px] text-[var(--p-muted)]">{it.dischargedAt ? "final bill" : "run up so far"}</div>
                </div>
                {/* ONE button, and it does the next thing. A row that needs a
                    figure opens the bill; a row with no claim at all opens the
                    form. Offering both on every row would make the desk work out
                    which applies to this particular stay, every time. */}
                {it.need === "RAISE" ? (
                  <div className="flex items-center gap-2">
                    <Link href={`/admissions/${it.admissionId}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                      <Icon name="receipt" size={15} /> Bill
                    </Link>
                    <button onClick={() => onRaise(it)}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]">
                      <Icon name="shield" size={15} /> Raise
                    </button>
                  </div>
                ) : (
                  <Link href={`/admissions/${it.admissionId}`}
                    className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]">
                    <Icon name="receipt" size={15} />
                    {it.need === "SET_AMOUNT" ? "Price the bill" : "Open"}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: "rose" | "amber" | "quiet" }) {
  const cls = tone === "rose"
    ? "bg-[var(--p-rose-soft)] text-[var(--p-rose)]"
    : tone === "amber"
      ? "bg-[var(--p-amber-soft)] text-[#8a5a14]"
      : "bg-[var(--p-border)]/40 text-[var(--p-muted)]";
  return (
    <div className={`rounded-lg px-4 py-2.5 text-center ${cls}`}>
      <div className="font-mono text-[20px] font-bold leading-none">{n}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide">{label}</div>
    </div>
  );
}

const CSS = `
.urg { display: grid; place-items: center; height: 46px; width: 46px; flex: none;
  border-radius: 12px; border: 1px solid transparent; }
.urg-n { font-family: var(--font-mono); font-size: 11px; font-weight: 700; line-height: 1; text-align: center; }
.urg-ok   { background: var(--p-cyan-soft);  color: var(--p-cyan-deep); border-color: rgba(0,188,199,.3); }
.urg-soon { background: var(--p-amber-soft); color: #8a5a14;            border-color: rgba(245,158,11,.35); }
.urg-late { background: var(--p-rose-soft);  color: var(--p-rose);      border-color: rgba(225,29,72,.35); }
`;
