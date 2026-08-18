"use client";

import { useState } from "react";
import { PhoneCall, Check, ArrowRight, Loader2 } from "@/components/ui/hugeicons";
import { DOCTORS } from "@/lib/data";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * "Ring me back" - the lighter door beside slot booking.
 *
 * The slot grid asks a patient to commit to an exact minute before they have
 * spoken to anyone, and a lot of people won't: they don't know how long the
 * traffic takes, whether their son can drive them, or which doctor they even
 * need. Those people currently close the tab and telephone instead, and the
 * website did nothing for them.
 *
 * This asks for the least a hospital needs in order to call someone back: a
 * name, a mobile, and optionally who they want to see. Reception owns the
 * diary; this only raises an intent.
 *
 * The number is verified by one-time code BEFORE anything is written, for the
 * same reason the slot path does it - this is an unauthenticated endpoint that
 * creates rows, and an unverified one is a queue anybody can flood. No patient
 * record is created either way; reception opens the file properly at the desk.
 */

const label = "font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]";

/**
 * The required marker, in the PUBLIC site's palette.
 *
 * Deliberately not the portal's `Req` atom: this page is themed by
 * site-theme.css, which has no `--p-rose` at all, so borrowing the staff-side
 * component would render an asterisk in whatever colour it happened to inherit.
 * `--alert` is the token the errors under these very inputs already use.
 */
function Req() {
  return (
    <>
      <span aria-hidden className="ml-0.5 text-[var(--alert)]">*</span>
      <span className="sr-only"> (required)</span>
    </>
  );
}
const field =
  "w-full rounded-xl border border-[var(--line-strong)] bg-white px-4 py-3 text-[14px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--teal)] disabled:bg-[var(--bone)] disabled:text-[var(--muted)]";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface Raised {
  refNo: string;
  patientName: string;
  doctorName: string | null;
  preferredDate: string | null;
}

export function RequestCallbackForm({ initialDoctorId = "" }: { initialDoctorId?: string }) {
  const [step, setStep] = useState<"details" | "code" | "done">("details");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [doctorId, setDoctorId] = useState(initialDoctorId);
  const [preferredDate, setPreferredDate] = useState("");
  const [note, setNote] = useState("");

  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [raised, setRaised] = useState<Raised | null>(null);

  const nameOk = name.trim().length >= 2;
  const phoneOk = /^[6-9]\d{9}$/.test(phone);

  async function sendCode() {
    if (!nameOk || !phoneOk) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ sentTo: string }>("/public/appointment-requests/otp", { phone });
      setSentTo(r.sentTo);
      setCode("");
      setStep("code");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Couldn't send the code. Please try again.");
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (code.length !== 6) return;
    setBusy(true); setErr(null);
    try {
      const { request } = await api.post<{ request: Raised }>("/public/appointment-requests", {
        name: name.trim(),
        phone,
        code,
        doctorId: doctorId || undefined,
        preferredDate: preferredDate || undefined,
        note: note.trim() || undefined,
      });
      setRaised(request);
      setStep("done");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Couldn't send your request. Please try again.");
    } finally { setBusy(false); }
  }

  function startOver() {
    setStep("details"); setName(""); setPhone(""); setDoctorId(initialDoctorId);
    setPreferredDate(""); setNote(""); setCode(""); setErr(null); setRaised(null);
  }

  /* ── done ─────────────────────────────────────────────────────────────── */
  if (step === "done" && raised) {
    return (
      <div className="rounded-[1.75rem] bg-white p-7 ring-1 ring-black/5 sm:p-9">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal)]">
          <Check size={22} />
        </span>
        <p className="display mt-4 text-[24px] text-[var(--ink)]">We&apos;ll call you back.</p>
        <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-[var(--ink-soft)]">
          Your request is with our front desk. Someone will ring <span className="font-semibold">{phone}</span> to
          confirm a time{raised.doctorName ? ` with ${raised.doctorName}` : ""}.
        </p>

        <div className="mt-5 inline-flex flex-col gap-1 rounded-xl bg-[var(--bone)] px-5 py-3">
          <span className={label}>Reference</span>
          <span className="font-mono text-[18px] font-bold text-[var(--teal)]">{raised.refNo}</span>
        </div>

        <p className="mt-5 text-[13px] leading-relaxed text-[var(--muted)]">
          Quote that reference if you call us first. This is a request, not a confirmed
          appointment - your time is fixed once we speak to you.
        </p>

        <button onClick={startOver} className="mt-6 text-[13px] font-semibold text-[var(--teal)] hover:underline">
          Raise another request
        </button>
      </div>
    );
  }

  /* ── code ─────────────────────────────────────────────────────────────── */
  if (step === "code") {
    return (
      <div className="rounded-[1.75rem] bg-white p-7 ring-1 ring-black/5 sm:p-9">
        <p className={label}>02 - Verify your number</p>
        <p className="display mt-3 text-[22px] text-[var(--ink)]">Enter the 6-digit code</p>
        <p className="mt-2 text-[14px] text-[var(--ink-soft)]">Sent to {sentTo}. It expires in five minutes.</p>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="6-digit code"
          className={`${field} mt-5 max-w-[220px] text-center font-mono text-[22px] tracking-[0.4em]`}
          autoFocus
        />

        {err && <p className="mt-3 text-[13px] font-medium text-[var(--alert)]">{err}</p>}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={confirm}
            disabled={busy || code.length !== 6}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--teal)] px-6 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--teal-deep)] disabled:opacity-45"
          >
            {busy ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : <>Send my request <ArrowRight size={15} /></>}
          </button>
          <button onClick={() => { setStep("details"); setErr(null); }} className="text-[13px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]">
            Change my details
          </button>
          <button onClick={sendCode} disabled={busy} className="text-[13px] font-semibold text-[var(--teal)] hover:underline disabled:opacity-45">
            Resend code
          </button>
        </div>
      </div>
    );
  }

  /* ── details ──────────────────────────────────────────────────────────── */
  return (
    <div className="rounded-[1.75rem] bg-white p-7 ring-1 ring-black/5 sm:p-9">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal)]">
          <PhoneCall size={17} />
        </span>
        <div>
          <p className="display text-[22px] leading-tight text-[var(--ink)]">Don&apos;t want to pick a time?</p>
          <p className="mt-1.5 max-w-[52ch] text-[14px] leading-relaxed text-[var(--ink-soft)]">
            Leave your number and we&apos;ll ring you back to fix one. Only your name and mobile are needed -
            everything else helps us come prepared.
          </p>
        </div>
      </div>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="cb-name" className={label}>Patient name<Req /></label>
          <input id="cb-name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Full name of the patient" className={`${field} mt-2.5`} />
        </div>

        <div>
          <label htmlFor="cb-phone" className={label}>Mobile number<Req /></label>
          <input id="cb-phone" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric" placeholder="10-digit mobile" className={`${field} mt-2.5 font-mono`} />
          {phone.length > 0 && !phoneOk && (
            <p className="mt-1.5 text-[12px] text-[var(--alert)]">Enter a valid 10-digit Indian mobile number.</p>
          )}
        </div>

        <div>
          <label htmlFor="cb-doctor" className={label}>Doctor</label>
          <select id="cb-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={`${field} mt-2.5`}>
            {/* "Any" first and selected by default - forcing a choice makes
                people pick the wrong speciality, and the desk then re-routes. */}
            <option value="">Any available doctor</option>
            {DOCTORS.map((d) => (
              <option key={d.id} value={d.id}>{d.name} · {d.specialization}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cb-date" className={label}>Preferred day</label>
          <input id="cb-date" type="date" value={preferredDate} min={todayISO()}
            onChange={(e) => setPreferredDate(e.target.value)} className={`${field} mt-2.5`} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="cb-note" className={label}>What&apos;s it about?</label>
          <textarea id="cb-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={3}
            placeholder="Chest pain since Monday · morning if possible · calling for my mother"
            className={`${field} mt-2.5 resize-y`} />
          <p className="mt-1.5 text-[12px] text-[var(--muted)]">{note.length}/500</p>
        </div>
      </div>

      {err && <p className="mt-4 text-[13px] font-medium text-[var(--alert)]">{err}</p>}

      <div className="mt-7 flex flex-wrap items-center gap-4">
        <button
          onClick={sendCode}
          disabled={busy || !nameOk || !phoneOk}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--teal)] px-6 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--teal-deep)] disabled:opacity-45"
        >
          {busy ? <><Loader2 size={15} className="animate-spin" /> Sending code…</> : <>Send me a code <ArrowRight size={15} /></>}
        </button>
        <p className="text-[12.5px] text-[var(--muted)]">
          We verify your mobile before sending the request to the desk.
        </p>
      </div>
    </div>
  );
}
