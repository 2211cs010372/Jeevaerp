"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";
import { StatusPill } from "@/components/portal/insurance/claims-board";
import { bedLabel } from "@/lib/beds";

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
  insurer: string | null; policyNo: string | null;
  ward: string; bedNo: string;
  admittedAt: string; dischargedAt: string | null; days: number;
  amount: string;
  claims: { id: string; claimNo: string; stage: string; status: string; claimedAmount: string }[];
}

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
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setStays((await api.get<{ stays: Stay[] }>("/insurance/stays")).stays); setError(null); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load the list."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useLive([TOPICS.INSURANCE], load);

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

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-5 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Insurance stays</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-[var(--p-muted)]">
          Every patient admitted on a policy. Open one to price its bill against that
          policy&apos;s tariff, or to print the claim bill again.
        </p>
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

      {error && <div className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{error}</div>}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-20 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--p-border)] text-[var(--p-muted)]"><Icon name="bed" size={20} /></span>
            <p className="mt-3 text-[15px] font-semibold text-[var(--p-ink)]">
              {q ? "Nothing matches that." : tab === "IN_BED" ? "Nobody is in a bed on a policy right now." : "Nothing here."}
            </p>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--p-muted)]">
              A stay appears here the moment reception admits somebody and marks them as insurance.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {shown.map((s) => (
              // The whole row is the link. The bill is the only thing anybody
              // opens a stay for, so there is no second destination to choose.
              <Link key={s.admissionId} href={`/admissions/${s.admissionId}`}
                className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-[var(--p-bg)]">
                <div className="min-w-0 flex-1">
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
                    {s.insurer ?? "Insurer not recorded"}
                    {s.policyNo && <> · <span className="font-mono">{s.policyNo}</span></>}
                    {" · "}{bedLabel(s.ward, s.bedNo)}
                    {" · "}
                    {s.dischargedAt ? `discharged ${day(s.dischargedAt)}` : `admitted ${day(s.admittedAt)}`}
                  </div>
                  {/* Where each claim stands. No claim yet says so in words - a
                      blank row would read as "nothing to do". */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {s.claims.length === 0 ? (
                      <span className="rounded-full bg-[var(--p-rose-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--p-rose)]">
                        No claim raised
                      </span>
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
                <div className="flex shrink-0 items-center gap-5">
                  <div className="text-right">
                    <div className="font-mono text-[15px] font-bold text-[var(--p-ink)]">{inr(s.amount)}</div>
                    <div className="text-[11px] text-[var(--p-muted)]">{s.dischargedAt ? "final bill" : "run up so far"}</div>
                  </div>
                  <Icon name="chevron" size={16} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PortalScroll>
  );
}
