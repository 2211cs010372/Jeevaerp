"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, Phone } from "@/components/ui/hugeicons";
import { allowedDays, clockLabel, isByAppointment } from "@/lib/opd";
import { HOSPITAL } from "@/lib/data";

/**
 * Live slot booking, on the profile itself.
 *
 * The grid is not generated in the browser - it is read from
 * /api/v1/public/slots, which calls the same `listAvailableSlots` the reception
 * desk uses. So a time shown here is a real, still-open slot in the ERP, and a
 * slot reception filled a minute ago is already gone from this page.
 *
 * Three states matter and each says something different:
 *   · slots        - pick one
 *   · none today   - fully booked, try another day
 *   · not-on-roster- this consultant's diary isn't published online yet
 * Collapsing those into one empty grid would tell a patient "fully booked" when
 * the truth is "we never published it", and they'd stop trying.
 */

interface Slot { id: string; startTime: string; endTime: string }
type Reason = "ok" | "none" | "not-on-roster" | "error";

/** What the ERP hands back once the appointment row exists. */
interface Booking {
  opNumber: string; displayId: string; patientName: string;
  doctorName: string; department: string; date: string; time: string;
  fee: string; smsSent: boolean; existingPatient: boolean;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Minutes since midnight, for grouping. */
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

const BANDS = [
  { key: "Morning", from: 0, to: 12 * 60 },
  { key: "Afternoon", from: 12 * 60, to: 16 * 60 },
  { key: "Evening", from: 16 * 60, to: 24 * 60 },
] as const;

export function DoctorSlots({
  doctorName, days, fee, opd = "",
}: { doctorName: string; days: string; fee: number; opd?: string }) {
  // Anaesthetists and the like have no online diary - offer a call, not a grid
  // that would forever read "fully booked".
  const byAppointment = isByAppointment(opd);

  // The next fortnight, filtered to days this doctor actually consults.
  const dates = useMemo(() => {
    const open = allowedDays(days);
    const out: Date[] = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 21 && out.length < 8; i++) {
      const c = new Date(d);
      c.setDate(d.getDate() + i);
      if (open.has(c.getDay())) out.push(c);
    }
    return out;
  }, [days]);

  const [date, setDate] = useState(() => (dates[0] ? isoOf(dates[0]) : ""));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [reason, setReason] = useState<Reason>("ok");
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Slot | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // details -> code -> booked. The code step is what makes this safe to expose
  // without a login: nothing is written until the number is proven.
  const [step, setStep] = useState<"details" | "code" | "done">("details");
  const [otpCode, setOtpCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);

  const load = useCallback(async () => {
    if (!date || byAppointment) return;   // no diary to fetch for these
    setLoading(true); setPicked(null);
    try {
      const r = await fetch(`/api/v1/public/slots?doctor=${encodeURIComponent(doctorName)}&date=${date}`);
      const body = await r.json();
      if (!r.ok) { setSlots([]); setReason("error"); return; }
      setSlots(body.slots ?? []);
      setReason(body.reason === "not-on-roster" ? "not-on-roster" : (body.slots ?? []).length ? "ok" : "none");
    } catch {
      setSlots([]); setReason("error");
    } finally { setLoading(false); }
  }, [doctorName, date]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(
    () => BANDS.map((b) => ({ ...b, list: slots.filter((s) => mins(s.startTime) >= b.from && mins(s.startTime) < b.to) }))
              .filter((b) => b.list.length > 0),
    [slots]
  );

  const ready = picked && name.trim().length > 1 && phone.trim().length === 10;

  /** Step 1 - ask the ERP to text a code to this number. */
  async function sendCode() {
    if (!ready || !picked) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/v1/public/appointments/otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: picked.id, name, phone }),
      });
      const b = await r.json();
      if (!r.ok) { setErr(b.error ?? "Couldn't send the code."); return; }
      setSentTo(b.sentTo); setStep("code");
    } catch { setErr("Network problem. Please try again."); }
    finally { setBusy(false); }
  }

  /** Step 2 - verify and book. This is the write. */
  async function confirm() {
    if (!picked || otpCode.length !== 6) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/v1/public/appointments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: picked.id, name, phone, code: otpCode }),
      });
      const b = await r.json();
      if (!r.ok) {
        setErr(b.error ?? "Couldn't complete the booking.");
        // The slot went to someone else mid-flow - send them back to a fresh grid.
        if (r.status === 409) { setStep("details"); setPicked(null); load(); }
        return;
      }
      setBooking(b.booking); setStep("done");
    } catch { setErr("Network problem. Please try again."); }
    finally { setBusy(false); }
  }

  function reset() {
    setStep("details"); setPicked(null); setName(""); setPhone("");
    setOtpCode(""); setBooking(null); setErr(null); load();
  }

  // ── by appointment: no online diary, offer a call ─────────────────────────
  if (byAppointment) {
    const tel = HOSPITAL.phone.replace(/\s/g, "");
    return (
      <div className="rounded-[16px] bg-[var(--paper)]">
        <div className="p-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal)]">
            <Phone className="h-5 w-5" />
          </span>
          <h3 className="display mt-4 text-[20px] text-[var(--ink)]">Booked by appointment</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
            {doctorName.replace(/^Dr\.?\s*/, "Dr ")} is arranged through the front desk and the
            treating team, not an online slot. Call and we&apos;ll set a time that works.
          </p>
          <a href={`tel:${tel}`}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-6 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-black">
            <Phone className="h-4 w-4" /> {HOSPITAL.phone}
          </a>
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            Emergency? Call <a href={`tel:${HOSPITAL.emergency.replace(/\s/g, "")}`} className="font-semibold text-[var(--alert)]">{HOSPITAL.emergency}</a> · 24×7
          </p>
        </div>
      </div>
    );
  }

  // ── booked ───────────────────────────────────────────────────────────────
  if (step === "done" && booking) {
    return (
      <div className="rounded-[16px] bg-[var(--paper)]">
        <div className="p-7 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--teal)] text-white">
            <Check className="h-6 w-6" />
          </span>
          <h3 className="display mt-4 text-[22px] text-[var(--ink)]">Appointment confirmed</h3>

          {/* the OP number IS the receipt - shown big, because the SMS may not arrive */}
          <div className="mt-4 rounded-[1rem] bg-[var(--pine-ink)] px-4 py-3.5 text-white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">Your OP number</p>
            <p className="font-mono text-[22px] font-bold tracking-tight">{booking.opNumber}</p>
          </div>

          <dl className="mt-4 space-y-2 text-left">
            <Row k="Patient" v={`${booking.patientName} · ${booking.displayId}`} />
            <Row k="Doctor" v={`${booking.doctorName} · ${booking.department}`} />
            <Row k="When" v={`${DOW[new Date(`${booking.date}T00:00:00`).getDay()]}, ${new Date(`${booking.date}T00:00:00`).getDate()} ${MON[new Date(`${booking.date}T00:00:00`).getMonth()]} at ${clockLabel(mins(booking.time))}`} />
            <Row k="Fee" v={`₹${booking.fee}, paid at the hospital`} />
          </dl>

          <p className="mt-4 rounded-[1rem] bg-white/70 px-4 py-3 text-[12.5px] leading-relaxed text-[var(--muted)]">
            {booking.smsSent
              ? <>A confirmation has been sent to <span className="font-mono text-[var(--ink)]">{phone}</span>. </>
              : <>Please note your OP number down - we couldn&apos;t send the confirmation text. </>}
            Arrive 10 minutes early and quote the OP number at the desk.
            {!booking.existingPatient && " Bring a photo ID on your first visit."}
          </p>

          <button onClick={reset} className="mt-5 text-[13px] font-semibold text-[var(--teal)] underline underline-offset-2">
            Book another time
          </button>
        </div>
      </div>
    );
  }

  // ── verify the number ────────────────────────────────────────────────────
  if (step === "code" && picked) {
    return (
      <div className="rounded-[16px] bg-[var(--paper)]">
        <div className="p-6">
          <button onClick={() => { setStep("details"); setOtpCode(""); setErr(null); }}
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] hover:text-[var(--teal)]">
            ← Change details
          </button>

          <h3 className="display mt-3 text-[20px] text-[var(--ink)]">Enter the code</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">
            We sent a 6-digit code to <span className="font-mono text-[var(--ink)]">{sentTo}</span>.
            Your time is held until you enter it.
          </p>

          <input
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" autoFocus
            aria-label="6-digit code" placeholder="······"
            className="mt-4 w-full rounded-[0.9rem] border border-[var(--line-strong)] bg-white px-4 py-3 text-center font-mono text-[24px] tracking-[0.4em] outline-none focus:border-[var(--teal)]"
          />

          {err && <p className="mt-2.5 text-[12.5px] font-medium text-[var(--alert)]">{err}</p>}

          <button onClick={confirm} disabled={busy || otpCode.length !== 6}
            className="mt-3 w-full rounded-full bg-[var(--ink)] px-5 py-3.5 text-[14px] font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-[var(--line-strong)] disabled:text-[var(--muted)]">
            {busy ? "Booking…" : "Confirm appointment"}
          </button>

          <button onClick={sendCode} disabled={busy}
            className="mt-2.5 w-full text-[12.5px] font-medium text-[var(--muted)] hover:text-[var(--teal)]">
            Didn&apos;t get it? Send again
          </button>
        </div>
      </div>
    );
  }

  return (
    /* min-w-0 twice over: a grid/flex item defaults to min-width:auto, which
       lets the day strip's fixed-width buttons force the whole PAGE wider
       instead of scrolling inside their own overflow-x-auto box. */
    <div className="flex h-full min-w-0 flex-col rounded-[16px] bg-[var(--paper)]">
      <div className="flex h-full min-w-0 flex-col p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="display text-[20px] text-[var(--ink)]">Pick a time</h2>
          <span className="font-mono text-[12px] text-[var(--muted)]">₹{fee} at the desk</span>
        </div>
        <p className="mt-1 text-[12.5px] text-[var(--muted)]">
          Live availability from the hospital's own diary.
        </p>

        {/* ── which day ─────────────────────────────────────────────────────── */}
        <div className="mt-5 min-w-0">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">Day</p>
          <div className="mt-2.5 flex min-w-0 gap-2 overflow-x-auto pb-1.5" role="group" aria-label="Choose a day">
            {dates.map((d, i) => {
              const iso = isoOf(d);
              const on = iso === date;
              return (
                <button
                  key={iso}
                  onClick={() => setDate(iso)}
                  aria-pressed={on}
                  className={`flex min-w-[58px] flex-none flex-col items-center rounded-[0.9rem] border px-2.5 py-2 transition-colors ${
                    on
                      ? "border-transparent bg-[var(--teal)] text-white"
                      : "border-[var(--line-strong)] bg-white text-[var(--ink)] hover:border-[var(--teal)]"
                  }`}
                >
                  <span className={`text-[10.5px] font-semibold uppercase tracking-wide ${on ? "text-white/75" : "text-[var(--muted)]"}`}>
                    {i === 0 ? "Today" : DOW[d.getDay()]}
                  </span>
                  <span className="font-mono text-[15px] font-bold leading-tight">{d.getDate()}</span>
                  <span className={`text-[9.5px] ${on ? "text-white/70" : "text-[var(--muted)]"}`}>{MON[d.getMonth()]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── which time ────────────────────────────────────────────────────── */}
        <div className="mt-5 flex-1 border-t border-[var(--line)] pt-5">
          {loading ? (
            <div className="space-y-3" aria-live="polite" aria-busy="true">
              <div className="h-3 w-24 animate-pulse rounded-full bg-[var(--bone-deep)]" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-9 animate-pulse rounded-full bg-[var(--bone-deep)]" />
                ))}
              </div>
            </div>
          ) : reason === "not-on-roster" ? (
            <Empty
              title="Not bookable online yet"
              body={`${doctorName}'s diary isn't published to the website. The front desk books this clinic by phone.`}
            />
          ) : reason === "error" ? (
            <Empty title="Couldn't load times" body="Something went wrong reading the diary. Try again, or call the desk." onRetry={load} />
          ) : reason === "none" ? (
            // "Fully booked" and "the clinic already finished for today" are
            // different facts, and only one of them means try another day.
            date === isoOf(new Date()) ? (
              <Empty
                title="Today's clinic has finished"
                body={`${doctorName.replace(/^Dr\.?\s*/, "Dr ")} is done for the day. Pick the next day above, or call the desk if it can't wait.`}
              />
            ) : (
              <Empty title="Fully booked that day" body="Every slot has gone. Try the next day on the strip above, or call the desk." />
            )
          ) : (
            <div className="space-y-4" aria-live="polite">
              {grouped.map((b) => (
                <div key={b.key}>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    {b.key} <span className="text-[var(--muted)]/60">· {b.list.length} open</span>
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {b.list.map((s) => {
                      const on = picked?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setPicked(on ? null : s)}
                          aria-pressed={on}
                          className={`rounded-full border py-2 font-mono text-[12px] transition-colors ${
                            on
                              ? "border-transparent bg-[var(--teal)] text-white"
                              : "border-[var(--line-strong)] bg-white text-[var(--ink)] hover:border-[var(--teal)] hover:text-[var(--teal)]"
                          }`}
                        >
                          {s.startTime}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── who's coming ──────────────────────────────────────────────────── */}
        {picked && (
          <div className="mt-5 border-t border-[var(--line)] pt-5">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">Your details</p>
            <div className="mt-2.5 space-y-2.5">
              <input
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Patient name" aria-label="Patient name"
                className="w-full rounded-[0.9rem] border border-[var(--line-strong)] bg-white px-4 py-2.5 text-[13.5px] outline-none transition-colors focus:border-[var(--teal)]"
              />
              <input
                value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="10-digit mobile" aria-label="Mobile number" inputMode="numeric"
                className="w-full rounded-[0.9rem] border border-[var(--line-strong)] bg-white px-4 py-2.5 font-mono text-[13.5px] outline-none transition-colors focus:border-[var(--teal)]"
              />
            </div>
            {err && <p className="mt-2.5 text-[12.5px] font-medium text-[var(--alert)]">{err}</p>}

            <button
              onClick={sendCode}
              disabled={!ready || busy}
              className="group mt-3 flex w-full items-center justify-between gap-3 rounded-full bg-[var(--ink)] px-5 py-3.5 text-[14px] font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-[var(--line-strong)] disabled:text-[var(--muted)]"
            >
              {busy ? "Sending code…" : `Book ${clockLabel(mins(picked.startTime))}`}
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15 transition-transform duration-200 group-hover:rotate-45 group-disabled:bg-transparent">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </button>
            <p className="mt-2 text-center text-[11px] leading-relaxed text-[var(--muted)]">
              We&apos;ll text a code to confirm it&apos;s you. No payment now - ₹{fee} at the hospital.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2 last:border-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">{k}</dt>
      <dd className="text-right text-[12.5px] font-medium text-[var(--ink)]">{v}</dd>
    </div>
  );
}

function Empty({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  const tel = HOSPITAL.emergency.replace(/\s/g, "");
  return (
    <div className="flex flex-col items-center rounded-[1.1rem] border border-dashed border-[var(--line-strong)] px-5 py-8 text-center">
      <p className="text-[14px] font-semibold text-[var(--ink)]">{title}</p>
      <p className="mt-1.5 max-w-[260px] text-[12.5px] leading-relaxed text-[var(--muted)]">{body}</p>
      {onRetry ? (
        <button onClick={onRetry} className="mt-4 rounded-full border border-[var(--line-strong)] px-4 py-2 text-[12.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]">
          Try again
        </button>
      ) : (
        <a href={`tel:${tel}`} className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] px-4 py-2 text-[12.5px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]">
          <Phone className="h-3.5 w-3.5" /> Call the desk
        </a>
      )}
    </div>
  );
}
