"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";

/**
 * The insurance room's landing screen.
 *
 * Answers two questions and stops: what is waiting on me, and what money is
 * owed to the hospital. Anything else the desk needs is one click away - a
 * dashboard that tries to be the whole portal is a dashboard nobody reads.
 */

interface Stats {
  counts: { draft: number; withInsurer: number; approved: number; settled: number; rejected: number };
  totalClaimed: string; totalApproved: string; totalSettled: string; pendingSettlement: string;
}
interface PendingItem { stage: "PRE_AUTH" | "FINAL"; waitingHours: number }

const inr = (v: string | number) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default function InsuranceHome() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        api.get<{ stats: Stats }>("/insurance?status=ALL"),
        api.get<{ items: PendingItem[] }>("/insurance/pending"),
      ]);
      setStats(c.stats); setPending(p.items);
    } catch { /* the cards below render their own empty state */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useLive([TOPICS.INSURANCE], load);

  const preAuth = pending.filter((p) => p.stage === "PRE_AUTH");
  // 48 hours is the line the pending list draws too - one definition of "late",
  // so the number here and the red tiles there can never disagree.
  const late = pending.filter((p) => p.stage === "PRE_AUTH" && p.waitingHours >= 48).length;

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-5 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Insurance desk</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-[var(--p-muted)]">
          Pre-authorizations, final claims, and what the insurers still owe.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : (
        <>
          {/* WHAT IS WAITING ON ME - first, and largest, because it is the only
              thing on this page that gets worse if it is ignored. */}
          <Link href="/pending" data-rise className="surface mb-5 flex flex-wrap items-center justify-between gap-4 px-6 py-5 transition-colors hover:border-[var(--p-blue)]">
            <div className="flex items-center gap-4">
              <span className={`grid h-12 w-12 place-items-center rounded-xl ${pending.length ? "bg-[var(--p-rose-soft)] text-[var(--p-rose)]" : "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"}`}>
                <Icon name={pending.length ? "alert" : "check"} size={22} />
              </span>
              <div>
                <div className="text-[15px] font-semibold text-[var(--p-ink)]">
                  {pending.length === 0
                    ? "Nothing waiting to be raised"
                    : `${pending.length} claim${pending.length === 1 ? "" : "s"} to raise`}
                </div>
                <div className="mt-0.5 text-[13px] text-[var(--p-muted)]">
                  {pending.length === 0
                    ? "Every insurance stay has a claim against it."
                    : <>{preAuth.length} pre-auth · {pending.length - preAuth.length} final{late > 0 && <b className="text-[var(--p-rose)]"> · {late} over 48h</b>}</>}
                </div>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--p-blue)]">
              Open the list <Icon name="chevron" size={15} />
            </span>
          </Link>

          <div data-rise className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="With insurer" value={String(stats?.counts.withInsurer ?? 0)} sub="submitted, awaiting a decision" />
            <Kpi label="Approved" value={String(stats?.counts.approved ?? 0)} sub="decided, money not in yet" />
            <Kpi label="Settled" value={inr(stats?.totalSettled ?? 0)} sub={`${stats?.counts.settled ?? 0} claims paid`} />
            <Kpi label="Awaiting settlement" value={inr(stats?.pendingSettlement ?? 0)} sub="approved and still unpaid" accent />
          </div>

          <Link href="/claims" data-rise className="surface flex items-center justify-between px-6 py-4 transition-colors hover:border-[var(--p-blue)]">
            <div className="flex items-center gap-3">
              <Icon name="shield" size={18} />
              <div>
                <div className="text-[14px] font-semibold text-[var(--p-ink)]">All claims</div>
                <div className="text-[12.5px] text-[var(--p-muted)]">Submit, record a decision, log a settlement.</div>
              </div>
            </div>
            <Icon name="chevron" size={16} />
          </Link>
        </>
      )}
    </PortalScroll>
  );
}

/** Tokens only - the accent tile wears the portal's primary, not a fixed hex. */
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="surface px-5 py-4" style={accent ? { background: "var(--p-blue)" } : undefined}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${accent ? "text-white/65" : "text-[var(--p-muted)]"}`}>{label}</div>
      <div className={`mt-1 font-mono text-[22px] font-bold ${accent ? "text-white" : "text-[var(--p-ink)]"}`}>{value}</div>
      <div className={`mt-0.5 text-[11px] ${accent ? "text-white/50" : "text-[var(--p-muted)]"}`}>{sub}</div>
    </div>
  );
}
