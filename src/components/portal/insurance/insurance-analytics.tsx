"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api } from "@/lib/api-client";

/**
 * THE INSURANCE BOOK, AS MONEY.
 *
 * Cashless is the one revenue stream where treating the patient and being paid
 * for it are months apart, so the day close cannot answer any of the questions
 * an owner actually has about it. This screen answers four:
 *
 *   how much of my money is sitting with insurers
 *   how much of what they agreed to has actually arrived
 *   who refuses, and who is slow
 *   is it getting better or worse
 *
 * Reported GROSS AND NET throughout, on purpose. "₹4L claimed" flatters;
 * "₹2.6L received" pays salaries. The gap between those two numbers is the
 * entire point of the page, so nothing here shows one without the other.
 */

interface Analytics {
  totals: { claims: number; claimed: string; approved: string; settled: string; awaiting: string; rejected: string; inFlight: string };
  funnel: { status: string; count: number; amount: string }[];
  byInsurer: { insurer: string; claims: number; claimed: string; approved: string; settled: string; awaiting: string; rejected: string; approvalPct: number }[];
  monthly: { month: string; label: string; claimed: string; settled: string; claims: number }[];
  ageing: { bucket: string; count: number; amount: string }[];
  billsWithInsurers: { count: number; amount: string };
}

const inr = (v: string | number) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", SUBMITTED: "With insurer", QUERIED: "Queried", APPROVED: "Approved",
  PARTIALLY_APPROVED: "Part-approved", SETTLED: "Settled", REJECTED: "Rejected", CLOSED: "Closed",
};

export function InsuranceAnalytics() {
  const [d, setD] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Analytics>("/admin/insurance/analytics")
      .then(setD).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center gap-2 py-16 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>;
  }
  if (!d || d.totals.claims === 0) {
    return (
      <section className="surface flex flex-col items-center px-6 py-16 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--p-border)] text-[var(--p-muted)]"><Icon name="shield" size={20} /></span>
        <p className="mt-3 text-[15px] font-semibold text-[var(--p-ink)]">No claims raised yet.</p>
        <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--p-muted)]">
          Figures appear here as soon as the insurance desk raises its first claim.
        </p>
      </section>
    );
  }

  // Every bar on the page is scaled against the largest CLAIMED month, not
  // against its own row - two charts with independent scales look comparable and
  // are not.
  const peak = Math.max(1, ...d.monthly.map((m) => Number(m.claimed)));

  return (
    <div className="space-y-5">
      {/* ── THE FOUR NUMBERS ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Claimed" value={inr(d.totals.claimed)} sub={`${d.totals.claims} claims raised`} />
        <Kpi label="Approved" value={inr(d.totals.approved)} sub="insurers agreed to pay" />
        <Kpi label="Received" value={inr(d.totals.settled)} sub="actually in the bank" tone="good" />
        <Kpi label="Owed to us" value={inr(d.totals.awaiting)} sub="approved, not yet paid" tone="warn" />
      </div>

      {/* Exposure that exists whether or not a claim covers it - bills pointed at
          an insurer with money still on them. This is the figure that catches a
          stay nobody has raised a claim for. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Small label="Still with insurers" value={inr(d.billsWithInsurers.amount)} sub={`${d.billsWithInsurers.count} unpaid bills`} />
        <Small label="Awaiting a decision" value={inr(d.totals.inFlight)} sub="raised or submitted" />
        <Small label="Refused" value={inr(d.totals.rejected)} sub="rejected outright" tone="bad" />
      </div>

      {/* ── CLAIMED vs RECEIVED, BY MONTH ──
          Two bars per month rather than a line: the question is not the trend of
          one number, it is the GAP between the two. */}
      <section className="surface overflow-hidden">
        <div className="border-b border-[var(--p-border)] px-5 py-3.5">
          <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Claimed vs received</h3>
          <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
            Last six months, by the month the claim was raised. The gap is money the hospital has
            treated for and not been paid for.
          </p>
        </div>
        <div className="flex items-end justify-between gap-3 px-5 pb-3 pt-6">
          {d.monthly.map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-[140px] w-full items-end justify-center gap-1">
                <div className="w-1/2 rounded-t bg-[var(--p-blue)]"
                  style={{ height: `${Math.max(2, (Number(m.claimed) / peak) * 100)}%` }}
                  title={`Claimed ${inr(m.claimed)}`} />
                <div className="w-1/2 rounded-t bg-[var(--p-cyan)]"
                  style={{ height: `${Math.max(2, (Number(m.settled) / peak) * 100)}%` }}
                  title={`Received ${inr(m.settled)}`} />
              </div>
              <div className="text-[11px] font-semibold text-[var(--p-muted)]">{m.label}</div>
              <div className="font-mono text-[10.5px] text-[var(--p-muted)]">{m.claims}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-[var(--p-border)] px-5 py-2.5 text-[11.5px] text-[var(--p-muted)]">
          <Legend colour="var(--p-blue)" label="Claimed" />
          <Legend colour="var(--p-cyan)" label="Received" />
          <span className="ml-auto">number under each month = claims raised</span>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── WHERE THE CLAIMS ARE ── */}
        <section className="surface overflow-hidden">
          <div className="border-b border-[var(--p-border)] px-5 py-3.5">
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Where the claims are</h3>
            <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Every claim by the stage it is stuck at.</p>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {d.funnel.map((f) => {
              const max = Math.max(1, ...d.funnel.map((x) => x.count));
              return (
                <div key={f.status} className="px-5 py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-[var(--p-text)]">{STATUS_LABEL[f.status] ?? f.status}</span>
                    <span className="font-mono text-[var(--p-ink)]">{f.count} · {inr(f.amount)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-[var(--p-border)]/50">
                    <div className="h-full rounded-full bg-[var(--p-blue)]" style={{ width: `${(f.count / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── HOW LONG THEY ARE TAKING ──
            Measured from the DECISION, not from when the claim was raised: the
            clock an insurer is judged on starts when they said yes. */}
        <section className="surface overflow-hidden">
          <div className="border-b border-[var(--p-border)] px-5 py-3.5">
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">How long they are taking</h3>
            <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Approved and still unpaid, counted from the day they approved it.</p>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {d.ageing.map((a, i) => (
              <div key={a.bucket} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className={`text-[13px] ${i >= 2 ? "font-semibold text-[var(--p-rose)]" : "text-[var(--p-text)]"}`}>{a.bucket}</span>
                <span className="text-right">
                  <span className={`font-mono text-[14px] font-semibold ${i >= 2 ? "text-[var(--p-rose)]" : "text-[var(--p-ink)]"}`}>{inr(a.amount)}</span>
                  <span className="ml-2 text-[11.5px] text-[var(--p-muted)]">{a.count} claim{a.count === 1 ? "" : "s"}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── BY INSURER ── worst payer first. */}
      <section className="surface overflow-hidden">
        <div className="border-b border-[var(--p-border)] px-5 py-3.5">
          <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">By insurer</h3>
          <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
            Ordered by what they still owe. &ldquo;Honours&rdquo; is how much of what was asked they agreed to.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--p-border)] text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                <th className="px-5 py-2 text-left">Insurer / TPA</th>
                <th className="px-3 py-2 text-right">Claims</th>
                <th className="px-3 py-2 text-right">Claimed</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">Owed</th>
                <th className="px-5 py-2 text-right">Honours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--p-border)]">
              {d.byInsurer.map((x) => (
                <tr key={x.insurer}>
                  <td className="px-5 py-2.5 font-medium text-[var(--p-ink)]">{x.insurer}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[var(--p-muted)]">{x.claims}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[var(--p-ink)]">{inr(x.claimed)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[var(--p-cyan-deep)]">{inr(x.settled)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono font-semibold ${Number(x.awaiting) > 0 ? "text-[var(--p-amber)]" : "text-[var(--p-muted)]"}`}>
                    {inr(x.awaiting)}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--p-border)]/60">
                        <span className="block h-full rounded-full bg-[var(--p-blue)]" style={{ width: `${Math.min(100, x.approvalPct)}%` }} />
                      </span>
                      <span className="font-mono text-[12px] text-[var(--p-muted)]">{x.approvalPct}%</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "warn" }) {
  const colour = tone === "good" ? "var(--p-cyan-deep)" : tone === "warn" ? "var(--p-amber)" : "var(--p-ink)";
  return (
    <div className="surface px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-bold" style={{ color: colour }}>{value}</div>
      <div className="mt-0.5 text-[11px] text-[var(--p-muted)]">{sub}</div>
    </div>
  );
}

function Small({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "bad" }) {
  return (
    <div className="surface px-5 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</div>
      <div className={`mt-0.5 font-mono text-[17px] font-bold ${tone === "bad" ? "text-[var(--p-rose)]" : "text-[var(--p-ink)]"}`}>{value}</div>
      <div className="text-[11px] text-[var(--p-muted)]">{sub}</div>
    </div>
  );
}

const Legend = ({ colour, label }: { colour: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colour }} /> {label}
  </span>
);
