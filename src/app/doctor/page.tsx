"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Kpi, Pill, statusTone } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { AbnormalPill, LabResultTable, type LabResultRow } from "@/components/portal/ui/lab-results";
import { api, ApiClientError } from "@/lib/api-client";

interface Q {
  appointmentId: string; opNumber: string; time: string; status: string;
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null; phone: string; bloodGroup: string | null };
}
interface LabResult {
  id: string; testName: string; reportReady: boolean; reportUrl: string | null;
  completedAt: string; source: "OPD" | "IPD";
  patient: { displayId: string; fullName: string };
  results: LabResultRow[]; abnormal: number; impression: string | null;
}
interface Inpatient {
  admissionId: string; ipNumber: string; wardName: string; bedNo: string; days: number; admittedAt: string;
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null };
}
interface Today {
  doctor: { name: string; department: string };
  stats: { booked: number; checkedIn: number; completed: number; total: number };
  queue: Q[]; labResults: LabResult[]; inpatients: Inpatient[];
}

const LABEL: Record<string, string> = { BOOKED: "Booked", CHECKED_IN: "Checked-in", COMPLETED: "Completed" };
const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
const inits = (n: string) => n.split(" ").map((x) => x[0]).slice(0, 2).join("");
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

export default function DoctorToday() {
  const [d, setD] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which result sheets are open. Collapsed by default: this is a list to scan,
  // and ten expanded sheets is a page nobody reads. The abnormal count sits on
  // the row itself, so the decision to open one is already informed.
  const [openSheets, setOpenSheets] = useState<Set<string>>(new Set());

  const toggleSheet = (id: string) =>
    setOpenSheets((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    try { setD(await api.get<Today>("/doctor/today")); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load today's list."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function complete(id: string) {
    setBusy(id); setError(null);
    try { await api.post("/doctor/today", { appointmentId: id }); await load(); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not update."); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>;

  // Whoever the doctor should call next: someone already waiting beats someone
  // who hasn't walked in yet.
  const nextUp = d?.queue.find((q) => q.status === "CHECKED_IN") ?? d?.queue.find((q) => q.status === "BOOKED") ?? null;
  const unreadLabs = d?.labResults.filter((l) => l.reportReady).length ?? 0;

  return (
    <PortalScroll>
      {/* ---- hero ---- */}
      <div data-rise className="surface dotgrid mb-6 rounded-[28px] px-7 py-7 sm:px-9">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--p-cyan-deep)]">Consulting room · {today}</p>
        <h1 className="mt-2 font-serif-p text-[clamp(24px,3vw,32px)] font-semibold text-[var(--p-ink)]">{d?.doctor.name ?? "Today"}</h1>
        <p className="mt-1 text-[13px] text-[var(--p-muted)]">{d?.doctor.department} · your clinic list for today</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full bg-black/[0.06] px-3.5 py-1.5 font-mono text-[11.5px] text-[var(--p-ink)]">{d?.stats.checkedIn ?? 0} waiting</span>
          <span className="rounded-full bg-black/[0.06] px-3.5 py-1.5 font-mono text-[11.5px] text-[var(--p-ink)]">{d?.stats.booked ?? 0} yet to arrive</span>
          <span className="rounded-full bg-black/[0.06] px-3.5 py-1.5 font-mono text-[11.5px] text-[var(--p-ink)]">{d?.stats.completed ?? 0} seen</span>
          {unreadLabs > 0 && <span className="rounded-full bg-[var(--p-cyan-soft)] px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-[var(--p-cyan-deep)]">{unreadLabs} result{unreadLabs === 1 ? "" : "s"} back</span>}
          {(d?.inpatients.length ?? 0) > 0 && <span className="rounded-full bg-[var(--p-blue-soft)] px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-[var(--p-blue-deep)]">{d?.inpatients.length} in a bed</span>}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/patients" className="rounded-full border border-black/15 px-3.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:bg-black/[0.05]">Patient chart</Link>
          <a href="/print/opd/blank" target="_blank" rel="noopener noreferrer" title="A blank case sheet to write on" className="rounded-full border border-black/15 px-3.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] transition-colors hover:bg-black/[0.05]">Blank sheet</a>
        </div>
      </div>

      {error && <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]">{error}</div>}

      {/* ---- 01 numbers ---- */}
      <SectionHead index="01 · Today in numbers" title="Your day at a glance"
        desc="Who is booked, who is sitting outside, and how many you have already seen." />
      <div data-rise className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon="calendar" label="Booked" value={d?.stats.booked ?? 0} sub="yet to arrive" delay={0} />
        <Kpi icon="clock" label="Waiting" value={d?.stats.checkedIn ?? 0} sub="checked in, outside" delay={60} />
        <Kpi icon="check" label="Seen" value={d?.stats.completed ?? 0} sub={`of ${d?.stats.total ?? 0} today`} delay={120} />
        <Kpi icon="bed" label="Inpatients" value={d?.inpatients.length ?? 0} sub="admitted under you" delay={180} />
      </div>

      {/* ---- 02 clinic list ---- */}
      <SectionHead index="02 · The clinic list" title="Everyone on today's list"
        desc="Open the chart before you call them in; print the case sheet to write on." />
      <div className="grid items-start gap-6 lg:grid-cols-[1.9fr_1fr]">
        <section data-rise className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Patient queue</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Chart shows history, results and past prescriptions.</p>
            </div>
            <span className="badge">{d?.queue.length ?? 0} today</span>
          </div>
          {!d?.queue.length ? (
            <div className="dotgrid flex flex-col items-center py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--p-border)] bg-white text-[var(--p-muted)]"><Icon name="calendar" size={20} /></span>
              <p className="mt-3 text-[13px] text-[var(--p-muted)]">No appointments today.</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--p-border)]">
              {d.queue.map((q) => (
                <div key={q.appointmentId} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 transition-colors hover:bg-[var(--p-bg)]">
                  <div className="flex items-center gap-3">
                    <div className="w-16 font-mono text-[12px] font-semibold text-[var(--p-blue)]">{q.time}</div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--p-cyan-soft)] font-serif-p text-[12px] font-semibold text-[var(--p-cyan-deep)]">{inits(q.patient.fullName)}</div>
                    <div>
                      <div className="text-[14px] font-medium text-[var(--p-ink)]">{q.patient.fullName}</div>
                      <div className="text-[12px] text-[var(--p-muted)]">
                        <span className="tabular">{q.patient.displayId}</span>
                        {q.patient.age != null && ` · ${q.patient.age}y`}
                        {q.patient.gender && ` · ${q.patient.gender[0]}`}
                        {q.patient.bloodGroup && ` · ${q.patient.bloodGroup}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill tone={statusTone(LABEL[q.status] ?? q.status)}>{LABEL[q.status] ?? q.status}</Pill>
                    <a href={`/print/opd/${q.appointmentId}`} target="_blank" rel="noopener noreferrer"
                      title="The OPD case sheet for this visit"
                      className="hidden items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)] sm:inline-flex">
                      <Icon name="printer" size={13} /> Sheet
                    </a>
                    <Link href={`/patients?id=${q.patient.displayId}`}
                      className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]">
                      Chart
                    </Link>
                    {q.status !== "COMPLETED" && (
                      <button onClick={() => complete(q.appointmentId)} disabled={busy === q.appointmentId}
                        className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
                        {busy === q.appointmentId ? <Spinner size={12} /> : <Icon name="check" size={13} />} Seen
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-6">
          {/* next up */}
          <section data-rise className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Next patient</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Whoever is waiting comes before whoever is booked.</p>
            </div>
            {nextUp ? (
              <div className="p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--p-cyan-soft)] font-serif-p text-[14px] font-semibold text-[var(--p-cyan-deep)]">{inits(nextUp.patient.fullName)}</div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-[var(--p-ink)]">{nextUp.patient.fullName}</div>
                    <div className="text-[12px] text-[var(--p-muted)]">{nextUp.time} · <span className="tabular">{nextUp.patient.displayId}</span></div>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Link href={`/patients?id=${nextUp.patient.displayId}`} className="flex-1 rounded-lg border border-[var(--p-border)] px-3 py-2 text-center text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]">Open chart</Link>
                  <a href={`/print/opd/${nextUp.appointmentId}`} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg bg-[var(--p-blue)] px-3 py-2 text-center text-[12px] font-semibold text-white hover:opacity-90">Case sheet</a>
                </div>
              </div>
            ) : (
              <p className="px-5 py-6 text-center text-[13px] text-[var(--p-muted)]">Nobody waiting right now.</p>
            )}
          </section>

          {/* quick actions */}
          <section data-rise className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4"><h3 className="text-[13px] font-semibold text-[var(--p-ink)]">Quick actions</h3></div>
            <div className="divide-y divide-[var(--p-border)]">
              <Action href="/patients" icon="search" title="Patient chart" sub="History, results, past prescriptions" />
              <Action href="/print/opd/blank" icon="printer" title="Blank case sheet" sub="Print a pad to write on" external />
            </div>
          </section>
        </div>
      </div>

      {/* ---- 03 results & ward ---- */}
      <SectionHead index="03 · Results & the ward" title="What came back, and who is upstairs"
        desc="Investigations finished in the last fortnight on your patients, and your admitted patients." />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section data-rise className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Results back</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Completed investigations on your patients.</p>
            </div>
            <span className="badge">{d?.labResults.length ?? 0}</span>
          </div>
          {!d?.labResults.length ? (
            <p className="px-5 py-10 text-center text-[13px] text-[var(--p-muted)]">No results in the last two weeks.</p>
          ) : (
            <div className="divide-y divide-[var(--p-border)]">
              {d.labResults.map((l) => {
                const open = openSheets.has(l.id);
                const hasValues = l.results.length > 0;
                return (
                  <div key={l.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{l.testName}</span>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${l.source === "IPD" ? "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]" : "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"}`}>{l.source}</span>
                          {hasValues && <AbnormalPill count={l.abnormal} compact />}
                        </div>
                        <div className="text-[12px] text-[var(--p-muted)]">{l.patient.fullName} · <span className="tabular">{l.patient.displayId}</span> · {dayMonth(l.completedAt)}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {hasValues && (
                          <button
                            type="button"
                            onClick={() => toggleSheet(l.id)}
                            aria-expanded={open}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]"
                          >
                            {open ? "Hide" : "Values"} ({l.results.length})
                          </button>
                        )}
                        {l.reportUrl ? (
                          <a href={l.reportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--p-cyan)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"><Icon name="file" size={13} /> Report</a>
                        ) : !hasValues && (
                          <span className="shrink-0 text-[11.5px] text-[var(--p-muted)]">Result on paper</span>
                        )}
                      </div>
                    </div>
                    {/* The lab's own read, always visible - it is the shortest
                        path from a flagged number to a decision. */}
                    {l.impression && (
                      <p className="mt-1.5 border-l-2 border-[var(--p-teal)] pl-2.5 text-[12.5px] italic leading-snug text-[var(--p-teal-deep)]">
                        {l.impression}
                        <span className="ml-1 not-italic text-[11px] text-[var(--p-muted)]">— lab</span>
                      </p>
                    )}
                    {hasValues && open && <LabResultTable results={l.results} className="mt-2.5" />}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section data-rise className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Your inpatients</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Admitted under you right now.</p>
            </div>
            <span className="badge">{d?.inpatients.length ?? 0}</span>
          </div>
          {!d?.inpatients.length ? (
            <p className="px-5 py-10 text-center text-[13px] text-[var(--p-muted)]">Nobody admitted under you.</p>
          ) : (
            <div className="divide-y divide-[var(--p-border)]">
              {d.inpatients.map((i) => (
                <div key={i.admissionId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{i.patient.fullName}</span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--p-blue)]">{i.ipNumber}</span>
                    </div>
                    <div className="text-[12px] text-[var(--p-muted)]">{i.wardName} · {i.bedNo} · day {i.days} · <span className="tabular">{i.patient.displayId}</span></div>
                  </div>
                  <Link href={`/patients?id=${i.patient.displayId}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]">Chart</Link>
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
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--p-cyan)]" aria-hidden />
        {index}
      </p>
      <h2 className="mt-1.5 font-serif-p text-[19px] font-semibold text-[var(--p-ink)]">{title}</h2>
      {desc && <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--p-muted)]">{desc}</p>}
    </div>
  );
}

function Action({ href, icon, title, sub, external }: { href: string; icon: "search" | "printer"; title: string; sub: string; external?: boolean }) {
  const body = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"><Icon name={icon} size={17} /></span>
      <span className="flex-1"><span className="block text-[13px] font-medium text-[var(--p-ink)]">{title}</span><span className="block text-[11px] text-[var(--p-muted)]">{sub}</span></span>
      <Icon name="chevron" size={15} />
    </>
  );
  const cls = "flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--p-bg)]";
  return external
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{body}</a>
    : <Link href={href} className={cls}>{body}</Link>;
}
