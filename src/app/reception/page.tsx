"use client";

import { useCallback, useEffect, useState } from "react";
import { Kpi, Pill, statusTone } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { SvgArrow } from "@/components/portal/ui/svg-arrow";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { isSettled } from "@/lib/money-round";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";

interface Appt {
  id: string; opNumber: string; time: string; status: string; type: string; price: string;
  hasRx: boolean;
  checkedInAt?: string | null;
  patient: { id: string; displayId: string; name: string };
  /** NULL on an emergency/casualty visit taken before a consultant was named. */
  doctor: { id: string; name: string; department: string } | null;
}
interface Stats { total: number; expected: number; waiting: number; checkedIn: number; completed: number; newPatients: number; }
interface Slot { id: string; startTime: string; endTime: string; }
interface DoctorOption { id: string; name: string; department: string; fee: string; }

// BOOKED used to be labelled "Waiting" - but a booked patient hasn't walked in yet.
// Waiting means they're sitting in the lobby. That's the whole point of check-in.
const LABEL: Record<string, string> = { BOOKED: "Expected", CHECKED_IN: "Waiting", COMPLETED: "Completed", CANCELLED: "Cancelled" };
/** Visit types that take no slot, carry no mandatory doctor, and arrive at once. */
const EMERGENCY_TYPES = new Set(["EMERGENCY", "CASUALTY"]);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
/** A slot is "past" once its own start instant (date + time, local) is at or
 *  before now - robust across timezones, and works for any date. */
const slotPast = (startTime: string, date: string) => new Date(`${date}T${startTime}:00`).getTime() <= Date.now();

export default function ReceptionTodayPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [unpaid, setUnpaid] = useState(0);
  const [acting, setActing] = useState<string | null>(null);   // appointment id mid-flight
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Appt | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelDone, setCancelDone] = useState<{ opNumber: string; paidInvoice: { receiptNo: string; amountPaid: string } | null } | null>(null);
  const [resched, setResched] = useState<Appt | null>(null);
  const [rsDate, setRsDate] = useState("");
  const [rsSlots, setRsSlots] = useState<Slot[]>([]);
  const [rsSlotId, setRsSlotId] = useState("");
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  // Naming the doctor who attended an emergency visit, after the fact.
  const [assigning, setAssigning] = useState<Appt | null>(null);
  const [assignDocId, setAssignDocId] = useState("");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [queueFilter, setQueueFilter] = useState<"ALL" | "BOOKED" | "CHECKED_IN" | "COMPLETED">("ALL");

  const refresh = useCallback(async () => {
    const [s, a, b] = await Promise.all([
      api.get<{ stats: Stats }>("/reception/stats"),
      api.get<{ appointments: Appt[] }>("/reception/appointments"),
      // how much money is still owed - step 6 of the rail needs to be honest
      api.get<{ invoices: { totalAmount: string; amountPaid: string; status: string }[] }>("/reception/billing")
        .catch(() => ({ invoices: [] })),
    ]);
    setStats(s.stats);
    setAppts(a.appointments);
    setUnpaid(b.invoices.filter((i) =>
      // Under a rupee left is not a debt (lib/money-round).
      i.status !== "CANCELLED" && !isSettled(Number(i.totalAmount) - Number(i.amountPaid))).length);
  }, []);

  useEffect(() => { refresh().catch(() => { }).finally(() => setLoading(false)); }, [refresh]);

  // The desk's board follows the whole hospital: a doctor finishing a
  // consultation, the lab resulting a test, the pharmacy dispensing, a bill
  // being paid. Suspended while the assign-doctor dialog is open, because
  // reloading the list under an open form swaps the row out from under it.
  useLive([TOPICS.RECEPTION], refresh, { enabled: !assigning });

  /** The core front-desk verb: the patient physically walked in. */
  async function checkIn(a: Appt, undo = false) {
    setActing(a.id); setErr(null);
    try {
      if (undo) await api.del(`/reception/appointments/${a.id}/check-in`);
      else await api.post(`/reception/appointments/${a.id}/check-in`, {});
      await refresh();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not update arrival."); }
    finally { setActing(null); }
  }

  async function doCancel() {
    if (!cancelling || cancelReason.trim().length < 3) return;
    setActing(cancelling.id); setErr(null);
    try {
      const r = await api.post<{ opNumber: string; paidInvoice: { receiptNo: string; amountPaid: string } | null }>(
        `/reception/appointments/${cancelling.id}/cancel`, { reason: cancelReason.trim() });
      setCancelling(null); setCancelReason("");
      setCancelDone(r);
      await refresh();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not cancel."); }
    finally { setActing(null); }
  }

  async function loadRsSlots(a: Appt, date: string) {
    setRsDate(date); setRsSlotId(""); setRsSlots([]);
    if (!date || !a.doctor) return;
    try {
      const r = await api.get<{ slots: Slot[] }>(`/reception/slots?doctorId=${a.doctor.id}&date=${date}`);
      setRsSlots(r.slots);
    } catch { setRsSlots([]); }
  }

  /** Type back the name written on the sheet's "Attended by" line. */
  async function openAssign(a: Appt) {
    setAssigning(a); setAssignDocId(""); setErr(null);
    if (doctors.length) return;
    try {
      const r = await api.get<{ doctors: DoctorOption[] }>("/reception/doctors");
      setDoctors(r.doctors);
    } catch { setErr("Could not load the doctor list."); }
  }

  async function doAssign() {
    if (!assigning || !assignDocId) return;
    setActing(assigning.id); setErr(null);
    try {
      await api.put(`/reception/appointments/${assigning.id}/doctor`, { doctorId: assignDocId });
      setAssigning(null); setAssignDocId("");
      await refresh();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not set the attending doctor."); }
    finally { setActing(null); }
  }

  async function doReschedule() {
    if (!resched || !rsSlotId) return;
    setActing(resched.id); setErr(null);
    try {
      await api.post(`/reception/appointments/${resched.id}/reschedule`, { newSlotId: rsSlotId });
      setResched(null); setRsDate(""); setRsSlots([]); setRsSlotId("");
      await refresh();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not reschedule."); }
    finally { setActing(null); }
  }

  const revenue = appts.reduce((sum, a) => sum + Number(a.price || 0), 0);
  const nextUp = appts.find((a) => a.status === "BOOKED");
  const filteredAppts = queueFilter === "ALL" ? appts : appts.filter((a) => a.status === queueFilter);

  return (
    <PortalScroll>
      {/* ---- ElevenLabs Tier-1 Studio Top Toolbar & Breadcrumb Bar ---- */}
      <div data-rise className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e5e5e5] bg-white px-5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {/* Left: Breadcrumb hierarchy */}
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-semibold text-[#111111]">Front Desk Studio</span>
          <span className="text-[#d4d4d4]">/</span>
          <span className="text-[#737373]">Live Operations Deck</span>
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live Sync
          </span>
          <span className="hidden text-[12px] text-[#a3a3a3] lg:inline-block">· {today}</span>
        </div>

        {/* Right: Studio Action Buttons */}
        <div className="flex items-center gap-2">
          <a href="/print/opd/blank" target="_blank" rel="noopener noreferrer" title="Print a pad of empty case sheets"
            className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
            Blank sheet
          </a>
          <Link href="/register?emergency=1"
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12.5px] font-semibold text-rose-700 transition-colors hover:bg-rose-100">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-600 animate-pulse" />
            Emergency OP
          </Link>
          <Link href="/book" className="inline-flex items-center gap-1.5 rounded-full bg-[#111111] px-4 py-1.5 text-[12.5px] font-medium text-white transition-all hover:bg-[#262626] active:scale-[0.98]">
            <Icon name="plus" size={12} />
            <span>Book appointment</span>
            <SvgArrow size={12} className="opacity-70" />
          </Link>
        </div>
      </div>

      {/* ---- Studio Sectional Workbench Tabs ---- */}
      <div data-rise className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#e5e5e5] pb-1">
        <nav className="flex items-center gap-6 overflow-x-auto text-[13px]" aria-label="Desk sections">
          <span className="border-b-2 border-[#111111] pb-2 font-semibold text-[#111111] whitespace-nowrap">Overview Deck</span>
          <Link href="/register" className="border-b-2 border-transparent pb-2 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap">Patient Register</Link>
          <Link href="/prescriptions" className="border-b-2 border-transparent pb-2 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap">Prescriptions &amp; Rx</Link>
          <Link href="/ipd" className="border-b-2 border-transparent pb-2 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap">Bed Board Studio</Link>
          <Link href="/billing" className="border-b-2 border-transparent pb-2 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap">Billing &amp; Settlement</Link>
          <Link href="/patients" className="border-b-2 border-transparent pb-2 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap">Directory</Link>
        </nav>

        {stats && (
          <div className="hidden items-center gap-2 lg:flex">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#e5e5e5] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#404040] tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {stats.waiting} waiting in lobby
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#e5e5e5] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#404040] tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              {stats.expected} expected
            </span>
            {unpaid > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 tabular-nums">
                {unpaid} pending dues
              </span>
            )}
          </div>
        )}
      </div>

      {/* KPI band - ElevenLabs Minimal Studio Stat Cards */}
      <div data-rise className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="group relative overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white p-4.5 transition-all duration-200 hover:border-[#111111]/30 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#737373]">Appointments</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#e5e5e5] bg-[#fafafa] text-[#111111] transition-colors group-hover:border-[#111111] group-hover:bg-[#111111] group-hover:text-white">
              <Icon name="calendar" size={13} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[26px] font-semibold tracking-tight text-[#111111] tabular-nums">{stats?.total ?? 0}</span>
            <span className="text-[11.5px] font-medium text-emerald-600 tabular-nums">{stats?.completed ?? 0} done</span>
          </div>
          <div className="mt-1 text-[11.5px] text-[#737373]">Total booked today</div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white p-4.5 transition-all duration-200 hover:border-[#111111]/30 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#737373]">Waiting now</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#e5e5e5] bg-[#fafafa] text-[#111111] transition-colors group-hover:border-[#111111] group-hover:bg-[#111111] group-hover:text-white">
              <Icon name="clock" size={13} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[26px] font-semibold tracking-tight text-[#111111] tabular-nums">{stats?.waiting ?? 0}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.2 text-[10.5px] font-medium text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              Lobby
            </span>
          </div>
          <div className="mt-1 text-[11.5px] text-[#737373]">Checked-in &amp; waiting</div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white p-4.5 transition-all duration-200 hover:border-[#111111]/30 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#737373]">Yet to arrive</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#e5e5e5] bg-[#fafafa] text-[#111111] transition-colors group-hover:border-[#111111] group-hover:bg-[#111111] group-hover:text-white">
              <Icon name="users" size={13} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[26px] font-semibold tracking-tight text-[#111111] tabular-nums">{stats?.expected ?? 0}</span>
            <span className="text-[11.5px] text-[#737373]">upcoming</span>
          </div>
          <div className="mt-1 text-[11.5px] text-[#737373]">Expected for consult</div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white p-4.5 transition-all duration-200 hover:border-[#111111]/30 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#737373]">Booked revenue</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#e5e5e5] bg-[#fafafa] text-[#111111] transition-colors group-hover:border-[#111111] group-hover:bg-[#111111] group-hover:text-white">
              <Icon name="rupee" size={13} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-[15px] font-medium text-[#737373]">₹</span>
            <span className="text-[26px] font-semibold tracking-tight text-[#111111] tabular-nums">{revenue.toLocaleString("en-IN")}</span>
          </div>
          <div className="mt-1 text-[11.5px] text-[#737373]">Today&apos;s consult fees</div>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1.9fr_1fr]">
        {/* queue */}
        <section data-rise className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-[#f5f5f4] p-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[#e5e5e5] bg-white text-[#111111]">
                <Icon name="calendar" size={13} />
              </span>
              <h3 className="text-[13.5px] font-semibold text-[#111111]">Appointment queue</h3>
              <span className="rounded-full border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#525252]">{filteredAppts.length}</span>
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-[#e5e5e5] bg-white p-0.5 text-[12px]">
              {([
                { key: "ALL", label: "All" },
                { key: "BOOKED", label: "Expected" },
                { key: "CHECKED_IN", label: "Waiting" },
                { key: "COMPLETED", label: "Done" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setQueueFilter(t.key)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    queueFilter === t.key
                      ? "bg-[#111111] text-white"
                      : "text-[#737373] hover:text-[#111111]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-white">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[14px] text-[#737373]"><Spinner /> Loading queue…</div>
          ) : filteredAppts.length === 0 ? (
            <div className="dotgrid flex flex-col items-center py-16 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e5e5e5] bg-[#f5f5f4] text-[#737373]"><Icon name="calendar" size={18} /></span>
              <p className="mt-3 text-[13.5px] text-[#737373]">
                {appts.length === 0 ? "No appointments booked for today yet." : "No visits in this filter."}
              </p>
              {appts.length === 0 && (
                <Link href="/book" className="btn-primary mt-3 inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[13px] font-medium text-white"><Icon name="plus" size={13} /> Book the first one</Link>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[#f0f0f0]">
              {filteredAppts.map((a) => (
                <div key={a.id} role="link" tabIndex={0}
                  onClick={() => router.push(`/patients/${a.patient.displayId}`)}
                  onKeyDown={(e) => e.key === "Enter" && router.push(`/patients/${a.patient.displayId}`)}
                  className="group flex cursor-pointer items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-[#fafafa]">
                  <div className="flex items-center gap-3.5">
                    {/* Time & Visit Type Badge */}
                    <div className="flex w-16 shrink-0 flex-col items-start">
                      <span className="text-[13.5px] font-semibold tracking-tight text-[#111111] tabular-nums">{a.time}</span>
                      <span className={`mt-0.5 rounded px-1.5 py-0.2 text-[9.5px] font-medium tracking-wide ${
                        EMERGENCY_TYPES.has(a.type)
                          ? "border border-rose-200 bg-rose-50 text-rose-700 font-semibold"
                          : "border border-[#e5e5e5] bg-[#f5f5f4] text-[#525252]"
                      }`}>{a.type}</span>
                    </div>

                    <div className="h-7 w-px bg-[#e5e5e5]" />

                    {/* Patient & Doctor Details */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium text-[#111111] group-hover:text-black">{a.patient.name}</span>
                        <span className="rounded bg-[#f5f5f4] px-1.5 py-0.2 text-[11px] font-normal text-[#737373] tabular-nums">{a.patient.displayId}</span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-[#737373]">
                        {a.doctor ? (
                          <>Dr. {a.doctor.name} <span className="text-[#a3a3a3]">·</span> {a.doctor.department}</>
                        ) : (
                          <span className="font-medium text-rose-600">Duty doctor — not assigned</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions & Status */}
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {/* THE front-desk verb: mark the patient as physically here */}
                    {a.status === "BOOKED" && (
                      <button onClick={() => checkIn(a)} disabled={acting === a.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white transition-all hover:bg-[#262626] active:scale-[0.98] disabled:opacity-50">
                        {acting === a.id ? <Spinner size={12} /> : <Icon name="check" size={12} />} Check in
                      </button>
                    )}
                    {(a.status === "BOOKED" || a.status === "CHECKED_IN" || a.status === "COMPLETED") && (
                      <a href={`/print/opd/${a.id}`} target="_blank" rel="noopener noreferrer"
                        title="Print the OPD case sheet - the doctor writes on this"
                        className="inline-flex items-center gap-1 rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
                        <Icon name="file" size={12} /> OPD Sheet
                      </a>
                    )}
                    {/* An unattributed visit can never be COMPLETED - only the
                        assigned doctor may close one. This is how it gets one. */}
                    {!a.doctor && a.status !== "CANCELLED" && (
                      <button onClick={() => openAssign(a)}
                        title="Name the doctor who attended - the visit can't be completed until it has one"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12px] font-semibold text-rose-700 transition-colors hover:bg-rose-600 hover:text-white">
                        <Icon name="stethoscope" size={12} /> Set doctor
                      </button>
                    )}
                    {a.status === "CHECKED_IN" && (
                      <span className="hidden items-center gap-1.5 text-[12px] text-[#737373] sm:inline-flex">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {a.checkedInAt ? `Arrived ${hhmm(a.checkedInAt)}` : "Arrived"}
                        {!EMERGENCY_TYPES.has(a.type) && (
                          <button onClick={() => checkIn(a, true)} disabled={acting === a.id}
                            className="ml-1 text-[11px] text-[#a3a3a3] underline underline-offset-2 hover:text-rose-600">undo</button>
                        )}
                      </span>
                    )}
                    {a.status === "COMPLETED" && (
                      a.hasRx ? (
                        <a href={`/print/opd/${a.id}`} target="_blank" rel="noopener noreferrer"
                          title="The OPD sheet has been filed - open it"
                          className="hidden items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-[#f5f5f4] px-2.5 py-1 text-[12px] font-medium text-[#111111] transition-colors hover:border-[#111111] sm:inline-flex">
                          <Icon name="file" size={12} /> View sheet
                        </a>
                      ) : (
                        <Link href={`/prescriptions?patient=${a.patient.displayId}`}
                          className="group hidden items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1 text-[12px] font-medium text-[#111111] transition-colors hover:border-[#111111] sm:inline-flex">
                          <Icon name="file" size={12} />
                          <span>Upload Rx</span>
                          <SvgArrow size={11} className="transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      )
                    )}

                    {(a.status === "BOOKED" || a.status === "CHECKED_IN") && (
                      <>
                        {a.doctor && (
                          <button onClick={() => { setResched(a); setRsDate(""); setRsSlots([]); setRsSlotId(""); }}
                            className="hidden rounded-lg border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#525252] transition-colors hover:border-[#111111] hover:text-[#111111] md:inline-flex">
                            Move
                          </button>
                        )}
                        <button onClick={() => { setCancelling(a); setCancelReason(""); }}
                          className="hidden rounded-lg border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#737373] transition-colors hover:border-rose-200 hover:text-rose-600 md:inline-flex">
                          Cancel
                        </button>
                      </>
                    )}

                    <span className="hidden text-[12.5px] font-medium text-[#737373] tabular-nums lg:block">₹{a.price}</span>
                    
                    {/* Status Pill - ElevenLabs style */}
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${
                      a.status === "CHECKED_IN"
                        ? "border border-amber-200 bg-amber-50 text-amber-800"
                        : a.status === "COMPLETED"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                        : a.status === "CANCELLED"
                        ? "border border-rose-200 bg-rose-50 text-rose-700"
                        : "border border-[#e5e5e5] bg-[#f5f5f4] text-[#404040]"
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        a.status === "CHECKED_IN" ? "bg-amber-500 animate-pulse" :
                        a.status === "COMPLETED" ? "bg-emerald-500" :
                        a.status === "CANCELLED" ? "bg-rose-500" : "bg-[#a3a3a3]"
                      }`} />
                      {LABEL[a.status] ?? a.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </section>

        {/* side column */}
        <div className="space-y-5">
        {/* next up */}
        <section data-rise className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-[#f5f5f4] p-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[#e5e5e5] bg-white text-[#111111]">
              <Icon name="clock" size={13} />
            </span>
            <div>
              <h3 className="text-[13.5px] font-semibold text-[#111111]">Next up</h3>
            </div>
          </div>
          <div className="rounded-xl border border-[#e5e5e5] bg-white">
          {nextUp ? (
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e5e5e5] bg-[#f5f5f4] text-[13px] font-semibold text-[#111111]">{nextUp.patient.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}</div>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-[#111111]">{nextUp.patient.name}</div>
                  <div className="truncate text-[12.5px] tabular-nums text-[#737373]">{nextUp.time} · {nextUp.doctor?.name ?? "Duty doctor"}</div>
                </div>
              </div>
              <button
                onClick={() => checkIn(nextUp)}
                disabled={acting === nextUp.id}
                className="shrink-0 rounded-[9px] bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#262626] disabled:opacity-50"
              >
                {acting === nextUp.id ? <Spinner size={12} /> : "Check in"}
              </button>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-[#737373]">No one expected right now.</p>
          )}
          </div>
        </section>

        {/* quick actions */}
        <section data-rise className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-[#f5f5f4] p-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[#e5e5e5] bg-white text-[#111111]">
              <Icon name="activity" size={13} />
            </span>
            <h3 className="text-[13.5px] font-semibold text-[#111111]">Quick actions</h3>
          </div>
          <div className="divide-y divide-[#ececec] overflow-hidden rounded-xl border border-[#e5e5e5] bg-white">
            <ActionRow href="/register" icon="users" title="Register patient" sub="New walk-in & UHID" />
            <ActionRow href="/book" icon="calendar" title="Book appointment" sub="Doctor, slot & billing" />
            <ActionRow href="/prescriptions" icon="file" title="Prescriptions & OPD" sub="Upload Rx & vitals" />
            <ActionRow href="/ipd" icon="bed" title="Admit a patient" sub="Bed board & wards" />
            <ActionRow href="/patients" icon="search" title="Find a patient" sub="History, reports & bills" />
          </div>
        </section>
        </div>
      </div>

      {err && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[var(--p-rose)]/30 bg-[var(--p-rose-soft)] px-4 py-2.5 text-[14px] text-[var(--p-rose)] shadow-lg">
          {err} <button onClick={() => setErr(null)} className="ml-2 font-semibold">✕</button>
        </div>
      )}

      {/* CANCEL - releases the slot so someone else can take it */}
      {cancelling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white p-1.5 shadow-2xl">
            <div className="px-5 py-4">
              <h3 className="text-[14px] font-semibold text-[#111111]">Cancel this visit?</h3>
              <p className="mt-1 text-[12.5px] text-[#737373]">
                {cancelling.patient.name} · <span className="font-medium text-[#111111] tabular-nums">{cancelling.opNumber}</span> · {cancelling.time} with {cancelling.doctor?.name ?? "the duty doctor"}
              </p>
            </div>
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
              <label className="block text-[12px] font-medium text-[#525252]">Reason for cancellation</label>
              <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus
                placeholder="Patient couldn't come / doctor unavailable…"
                className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] outline-none focus:border-[#111111]" />
              <p className="rounded-lg border border-[#e5e5e5] bg-white p-3 text-[11.5px] leading-relaxed text-[#737373]">
                {cancelling.doctor
                  ? <>The <b className="font-medium text-[#111111]">{cancelling.time} slot goes back on sale</b> immediately. The visit record is kept, not deleted.</>
                  : <>An emergency visit holds no slot. The visit record is kept, not deleted.</>}
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setCancelling(null)} className="rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-[#525252] hover:text-[#111111]">Keep visit</button>
                <button onClick={doCancel} disabled={acting === cancelling.id || cancelReason.trim().length < 3}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-40">
                  {acting === cancelling.id ? <Spinner size={12} /> : null} Cancel visit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* cancelled, but money had already changed hands */}
      {cancelDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white p-6 text-center shadow-2xl">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200"><Icon name="check" size={20} /></span>
            <h3 className="mt-3 text-[15px] font-semibold text-[#111111]">{cancelDone.opNumber} cancelled</h3>
            <p className="mt-1 text-[12.5px] text-[#737373]">The slot is free for another patient.</p>
            {cancelDone.paidInvoice && (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-[12px] leading-relaxed text-amber-800">
                <b>This visit was already paid.</b> Receipt <span className="font-medium text-[#111111] tabular-nums">{cancelDone.paidInvoice.receiptNo}</span> holds ₹{cancelDone.paidInvoice.amountPaid}.
                Money is <b>not</b> refunded automatically. Void the bill from <b>Billing</b> if you&apos;re returning cash.
              </p>
            )}
            <button onClick={() => setCancelDone(null)} className="mt-5 w-full rounded-lg bg-[#111111] py-2 text-[13px] font-medium text-white hover:bg-[#262626]">Done</button>
          </div>
        </div>
      )}

      {/* SET ATTENDING DOCTOR */}
      {assigning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white p-1.5 shadow-2xl">
            <div className="px-5 py-4">
              <h3 className="text-[14px] font-semibold text-[#111111]">Who attended this emergency?</h3>
              <p className="mt-1 text-[12.5px] text-[#737373]">
                {assigning.patient.name} · <span className="font-medium text-[#111111] tabular-nums">{assigning.opNumber}</span> · {assigning.time}
              </p>
            </div>
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
              {doctors.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-[#737373]"><Spinner size={14} /> Loading doctors…</div>
              ) : (
                <div className="grid max-h-56 gap-2 overflow-y-auto">
                  {doctors.map((d) => (
                    <button key={d.id} onClick={() => setAssignDocId(assignDocId === d.id ? "" : d.id)}
                      className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
                        assignDocId === d.id ? "border-[#111111] bg-white shadow-sm ring-1 ring-[#111111]" : "border-[#e5e5e5] bg-white hover:border-[#111111]"}`}>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-[#111111]">{d.name}</span>
                        <span className="block truncate text-[11.5px] text-[#737373]">{d.department}</span>
                      </span>
                      <span className="shrink-0 text-[12.5px] font-medium text-[#111111] tabular-nums">₹{d.fee}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11.5px] text-[#737373] leading-relaxed">
                Assigning adds this visit to doctor&apos;s active list. Consultation fee will be added unless bill is already generated.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setAssigning(null)} className="rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-[#525252]">Cancel</button>
                <button onClick={doAssign} disabled={acting === assigning.id || !assignDocId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-4 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[#262626] disabled:opacity-40">
                  {acting === assigning.id ? <Spinner size={12} /> : null} Confirm doctor
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESCHEDULE */}
      {resched && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white p-1.5 shadow-2xl">
            <div className="px-5 py-4">
              <h3 className="text-[14px] font-semibold text-[#111111]">Move this visit</h3>
              <p className="mt-1 text-[12.5px] text-[#737373]">
                {resched.patient.name} · currently {resched.time} with Dr. {resched.doctor?.name ?? "Duty doctor"}
              </p>
            </div>
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-[#525252]">New date</label>
                <input type="date" value={rsDate} onChange={(e) => loadRsSlots(resched, e.target.value)}
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] outline-none focus:border-[#111111]" />
              </div>
              {rsDate && (
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-[#525252]">Available slots</label>
                  {rsSlots.length === 0 ? (
                    <p className="rounded-lg border border-[#e5e5e5] bg-white p-4 text-center text-[12.5px] text-[#737373]">
                      No free slots available on this date.
                    </p>
                  ) : (
                    <div className="grid max-h-40 grid-cols-3 gap-2 overflow-y-auto">
                      {rsSlots.map((sl) => {
                        const past = slotPast(sl.startTime, rsDate);
                        return (
                          <button key={sl.id} onClick={() => !past && setRsSlotId(sl.id)} disabled={past}
                            className={`rounded-lg border px-2 py-2 text-[12.5px] font-medium tabular-nums transition-all ${
                              past ? "cursor-not-allowed border-[#e5e5e5] bg-[#f5f5f4] text-[#a3a3a3] line-through opacity-50"
                              : rsSlotId === sl.id ? "border-[#111111] bg-[#111111] text-white"
                              : "border-[#e5e5e5] bg-white text-[#404040] hover:border-[#111111]"}`}>
                            {sl.startTime}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setResched(null)} className="rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-[#525252]">Cancel</button>
                <button onClick={doReschedule} disabled={acting === resched.id || !rsSlotId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-4 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[#262626] disabled:opacity-40">
                  {acting === resched.id ? <Spinner size={12} /> : null} Reschedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}

function ActionRow({ href, icon, title, sub }: { href: string; icon: "users" | "calendar" | "file" | "search" | "bed"; title: string; sub: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-[#fafafa]">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e5e5e5] bg-[#f5f5f4] text-[#111111] transition-colors group-hover:bg-white"><Icon name={icon} size={15} /></span>
      <div className="flex-1 min-w-0"><div className="text-[13.5px] font-medium text-[#111111]">{title}</div><div className="truncate text-[12px] text-[#737373]">{sub}</div></div>
      <SvgArrow size={13} className="text-[#737373] opacity-60 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100 group-hover:text-[#111111]" />
    </Link>
  );
}