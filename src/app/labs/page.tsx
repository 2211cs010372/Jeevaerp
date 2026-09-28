"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Kpi, Pill, statusTone } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";

/**
 * The bench's numbers only. `/labs/stats` also returns the day's lab revenue
 * and collections; the lab takes no money any more (reception bills lab
 * tests), so this screen does not read them.
 */
interface Stats {
  pending: number; completedToday: number; totalToday: number;
  unbilled: number; reportsPending: number; ipdTests: number;
}
interface Test {
  id: string; testName: string; status: string; price: string | null; createdAt: string;
  completedAt: string | null; reportFileUrl: string | null;
  patient: { id: string; displayId: string; fullName: string; phone: string } | null;
  appointment: { opNumber: string; doctorName: string; visitDate: string } | null;
  billed: boolean;
}

const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
const dayMonth = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "-");

export default function LabsDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tests, setTests] = useState<Test[]>([]);
  const [completed, setCompleted] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [s, t, c] = await Promise.all([
      api.get<{ stats: Stats }>("/labs/stats"),
      api.get<{ tests: Test[] }>("/labs/tests?status=PENDING"),
      api.get<{ tests: Test[] }>("/labs/tests?status=COMPLETED").catch(() => ({ tests: [] as Test[] })),
    ]);
    setStats(s.stats); setTests(t.tests.slice(0, 8)); setCompleted(c.tests);
  }, []);

  useEffect(() => { load().catch(() => {}).finally(() => setLoading(false)); }, [load]);

  // An order raised at the front desk lands on this dashboard immediately - the
  // bench can start collecting without anyone walking over to say so.
  useLive([TOPICS.LABS], load);

  // Finished on the bench but the report file never got attached - the loose ends.
  const awaitingReport = completed.filter((t) => !t.reportFileUrl).slice(0, 6);
  const recentlyDone = completed.slice(0, 6);

  return (
    <PortalScroll>
      {/* ---- hero ---- */}
      <div data-rise className="surface dotgrid mb-6 rounded-[28px] px-7 py-7 sm:px-9">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--p-teal)]">Laboratory · {today}</p>
        <h1 className="mt-2 font-serif-p text-[clamp(24px,3vw,32px)] font-semibold text-[var(--p-ink)]">Lab overview</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--p-muted)]">
          Samples come in, results go out. Tests are ordered here and paid for at reception - an
          inpatient&apos;s go onto their stay as a bill due at discharge.
        </p>

        {stats && (
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-black/[0.06] px-3.5 py-1.5 font-mono text-[11.5px] text-[var(--p-ink)]">{stats.pending} on the bench</span>
            <span className="rounded-full bg-black/[0.06] px-3.5 py-1.5 font-mono text-[11.5px] text-[var(--p-ink)]">{stats.completedToday} done today</span>
            {stats.reportsPending > 0 && <span className="rounded-full bg-[var(--p-amber-soft)] px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-[#8a6414]">{stats.reportsPending} report{stats.reportsPending === 1 ? "" : "s"} to upload</span>}
            {stats.unbilled > 0 && <span className="rounded-full bg-[var(--p-amber-soft)] px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-[#8a6414]">{stats.unbilled} waiting at reception to be billed</span>}
            {stats.ipdTests > 0 && <span className="rounded-full bg-[var(--p-blue-soft)] px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-[var(--p-blue-deep)]">{stats.ipdTests} for the ward</span>}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/order" className="rounded-full border border-black/15 px-3.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:bg-black/[0.05]">Order tests</Link>
          <Link href="/queue" className="inline-flex items-center gap-2 rounded-full bg-[var(--p-teal)] px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)]"><Icon name="flask" size={13} /> Test queue</Link>
        </div>
      </div>

      {/* ---- 01 numbers ---- */}
      <SectionHead index="01 · Today in numbers" title="The bench at a glance"
        desc="What is waiting, what is finished, and what still needs a report attached." />
      <div data-rise className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon="flask" label="Pending tests" value={stats?.pending ?? 0} sub="awaiting results" delay={0} />
        <Kpi icon="check" label="Completed today" value={stats?.completedToday ?? 0} sub={`of ${stats?.totalToday ?? 0} ordered`} delay={60} />
        <Kpi icon="file" label="Reports to upload" value={stats?.reportsPending ?? 0} sub="finished, no file yet" delay={120} />
        <Kpi icon="bed" label="For the ward" value={stats?.ipdTests ?? 0} sub="inpatient tests pending" delay={180} />
      </div>

      {/* ---- 02 the bench ---- */}
      <SectionHead index="02 · The bench" title="Samples waiting on a result"
        desc="Work through these in the queue - upload the report and the test closes itself." />
      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section data-rise className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Pending tests</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Samples awaiting results.</p>
            </div>
            <Link href="/queue" className="text-[12px] font-medium text-[var(--p-teal)] hover:underline">View all →</Link>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
          ) : tests.length === 0 ? (
            <div className="dotgrid flex flex-col items-center py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--p-border)] bg-white text-[var(--p-muted)]"><Icon name="flask" size={20} /></span>
              <p className="mt-3 text-[13px] text-[var(--p-muted)]">No pending tests. All caught up.</p>
              <Link href="/order" className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[12px] font-semibold text-white"><Icon name="plus" size={13} /> Order a test</Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--p-border)]">
              {tests.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-6 py-3.5 transition-colors hover:bg-[var(--p-bg)]">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-[var(--p-ink)]">{t.testName}</div>
                    <div className="truncate text-[12px] text-[var(--p-muted)]">
                      {t.patient?.fullName ?? "-"} · <span className="tabular">{t.patient?.displayId}</span>
                      {t.appointment && ` · ${t.appointment.doctorName}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {t.price && <span className="font-mono text-[12px] text-[var(--p-muted)]">₹{t.price}</span>}
                    <Pill tone={statusTone("Waiting")}>Pending</Pill>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section data-rise className="surface h-fit overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4"><h3 className="text-[13px] font-semibold text-[var(--p-ink)]">Quick actions</h3></div>
            <div className="divide-y divide-[var(--p-border)]">
              <Action href="/order" icon="plus" title="Order tests" sub="Walk-in or from a visit" />
              <Action href="/queue" icon="flask" title="Test queue" sub="Upload reports, complete tests" />
              <Action href="/patients" icon="search" title="Patient history" sub="Last visit, tests, results" />
            </div>
          </section>
        </div>
      </div>

      {/* ---- 03 reports ---- */}
      <SectionHead index="03 · Reports" title="Loose ends and finished work"
        desc="A result given on paper still needs its report attached - until then the patient can't see it in their portal." />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section data-rise className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Awaiting a report file</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Completed, but nothing uploaded yet.</p>
            </div>
            <span className="badge">{stats?.reportsPending ?? 0}</span>
          </div>
          {awaitingReport.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-[var(--p-muted)]">Every finished test has its report. Nothing loose.</p>
          ) : (
            <div className="divide-y divide-[var(--p-border)]">
              {awaitingReport.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{t.testName}</div>
                    <div className="truncate text-[12px] text-[var(--p-muted)]">{t.patient?.fullName ?? "-"} · {dayMonth(t.completedAt)}</div>
                  </div>
                  <Link href="/queue" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--p-amber)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"><Icon name="file" size={13} /> Upload</Link>
                </div>
              ))}
            </div>
          )}
        </section>

        <section data-rise className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Recently completed</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">The last results off the bench.</p>
            </div>
            <span className="badge">{completed.length}</span>
          </div>
          {recentlyDone.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-[var(--p-muted)]">Nothing completed yet.</p>
          ) : (
            <div className="divide-y divide-[var(--p-border)]">
              {recentlyDone.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{t.testName}</div>
                    <div className="truncate text-[12px] text-[var(--p-muted)]">{t.patient?.fullName ?? "-"} · {dayMonth(t.completedAt)}{!t.billed && <span className="text-[var(--p-rose)]"> · unbilled</span>}</div>
                  </div>
                  {t.reportFileUrl ? (
                    <a href={t.reportFileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-teal)] hover:border-[var(--p-teal)]"><Icon name="file" size={13} /> Report</a>
                  ) : (
                    <span className="shrink-0 text-[11.5px] text-[var(--p-muted)]">No file</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PortalScroll>
  );
}

/** Numbered section header - the dashboard teaches as it lists. */
function SectionHead({ index, title, desc }: { index: string; title: string; desc?: string }) {
  return (
    <div className="mb-4 mt-8 first:mt-0">
      <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--p-muted)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--p-teal)]" aria-hidden />
        {index}
      </p>
      <h2 className="mt-1.5 font-serif-p text-[19px] font-semibold text-[var(--p-ink)]">{title}</h2>
      {desc && <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--p-muted)]">{desc}</p>}
    </div>
  );
}

function Action({ href, icon, title, sub }: { href: string; icon: "plus" | "flask" | "search"; title: string; sub: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--p-bg)]">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--p-teal-soft)] text-[var(--p-teal)]"><Icon name={icon} size={17} /></span>
      <div className="flex-1"><div className="text-[13px] font-medium text-[var(--p-ink)]">{title}</div><div className="text-[11px] text-[var(--p-muted)]">{sub}</div></div>
      <Icon name="chevron" size={15} />
    </Link>
  );
}
