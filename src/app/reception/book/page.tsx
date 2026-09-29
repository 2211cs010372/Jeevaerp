"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { Spinner, SuccessCheck, Field } from "@/components/portal/ui/form-atoms";
import { DiscountInput, PaymentSection, type Tender } from "@/components/portal/ui/bill-fields";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { roundBill } from "@/lib/money-round";
import PortalDatePicker from "@/components/portal/ui/datepicker";
import { isAfterHours, minutesOfDay, opFeeFor, prettyTime, type AfterHoursPolicy } from "@/lib/after-hours";
import { DuplicatePatientDialog, PhoneOnFileHint } from "@/components/portal/duplicate-patient-dialog";
import { notAPatientPhone } from "@/lib/phone";
import { phoneOnFile, type PhoneOnFile } from "@/lib/patient-duplicates";

interface Patient { id: string; displayId: string; fullName: string; age: number | null; phone: string; gender?: string | null; bloodGroup?: string | null; }
interface Doctor { id: string; name: string; specialization: string; department: string; fee: string; qualification: string | null; experienceYears: number | null; age: number | null; languages: string | null; photoUrl: string | null; bio: string | null; }
interface Slot { id: string; startTime: string; endTime: string; }
/** The after-hours policy, plus the clock the SERVER will price against. */
interface OpPricing extends AfterHoursPolicy { serverTime: string; }
interface Booked {
  id: string; opNumber: string; time: string; price: string;
  patient: { name: string; displayId: string };
  /** NULL on an emergency/casualty visit taken with no consultant named. */
  doctor: { name: string; department: string } | null;
  invoice?: { id: string; receiptNo: string; totalAmount: string; status: string };
}

// LOCAL calendar date (not UTC) - `toISOString()` would roll to yesterday during
// the early hours in a +offset timezone (e.g. IST 00:00-05:30), defaulting the
// booking grid to the wrong day.
/** 1230 -> "20:30". Wraps within the day; the caller does the modulo. */
const hhmmFromMinutes = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const inits = (n: string) => n.split(" ").map((x) => x[0]).slice(0, 2).join("");
const prettyDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

/** A slot is "past" once its own start instant (date + time, local) is at or
 *  before now. Robust across timezones: past dates read fully past, future dates
 *  never do, and today's slots flip exactly as the clock reaches them. */
const slotPast = (startTime: string, date: string) => new Date(`${date}T${startTime}:00`).getTime() <= Date.now();

const BLOODS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const emptyNp = { firstName: "", lastName: "", phone: "", age: "", gender: "FEMALE", blood: "O+", city: "" };

/**
 * Reads ?patient=JMH... and hands the resolved patient up. Lets Register,
 * the patient file, and the Today queue drop straight into this form with the
 * patient already chosen - reception never searches the same person twice.
 * (Own component so useSearchParams sits under <Suspense>; Next 15 requires it.)
 */
function PatientFromUrl({ onFound }: { onFound: (p: Patient) => void }) {
  const params = useSearchParams();
  useEffect(() => {
    const pid = params.get("patient");
    if (!pid) return;
    api.get<{ patient: Patient }>(`/reception/patients/${encodeURIComponent(pid)}`)
      .then((r) => onFound(r.patient)).catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Reads ?req= - the callback request this booking came from.
 *
 * Reception clicks "Book" on the queue and lands here; once the visit exists,
 * the request is marked BOOKED and linked to it. Without this the desk would
 * have to remember to go back and tick the queue, and it would fill with
 * requests that were actually dealt with weeks ago.
 */
function RequestFromUrl({ onFound }: { onFound: (id: string) => void }) {
  const params = useSearchParams();
  const req = params.get("req");
  useEffect(() => { if (req) onFound(req); }, [req, onFound]);
  return null;
}

export default function BookAppointmentPage() {
  const [patientMode, setPatientMode] = useState<"existing" | "new">("existing");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [recent, setRecent] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);

  // Inline "register a new patient" - the essentials only (firstName + phone are
  // all the API requires); fuller details can be added later from the file.
  const [np, setNp] = useState({ ...emptyNp });
  const [creating, setCreating] = useState(false);
  const [npError, setNpError] = useState<string | null>(null);
  const [npFieldErr, setNpFieldErr] = useState<{ firstName?: string; phone?: string; age?: string }>({});
  /** The server's "this mobile is already on file" - see createPatient. */
  const [dupe, setDupe] = useState<PhoneOnFile | null>(null);

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const [referredBy, setReferredBy] = useState("");
  const [referralSource, setReferralSource] = useState("");

  const [opPricing, setOpPricing] = useState<OpPricing | null>(null);
  /** Server-anchored wall clock, advanced locally - see the ticker below. */
  const [nowHHMM, setNowHHMM] = useState<string | null>(null);
  /** Set only when a human typed a different fee; null = charge the policy figure. */
  const [feeEdit, setFeeEdit] = useState<number | null>(null);
  const [editingFee, setEditingFee] = useState(false);

  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  /** Set when this booking was started from a website callback request. */
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ doctors: Doctor[]; opPricing?: OpPricing }>("/reception/doctors")
      .then((r) => { setDoctors(r.doctors); if (r.opPricing) setOpPricing(r.opPricing); })
      .catch(() => { });
    api.get<{ patients: Patient[] }>("/reception/patients/recent").then((r) => setRecent(r.patients)).catch(() => { });
  }, []);

  // Tick a clock so a desk left open across the cutoff starts quoting the
  // emergency fee on its own. Anchored to the SERVER's minute, not the PC's:
  // the server is what prices the booking, and a desk clock twenty minutes slow
  // would otherwise quote ₹600 and hand over a ₹1,200 bill.
  useEffect(() => {
    if (!opPricing) return;
    const anchor = minutesOfDay(opPricing.serverTime);
    if (anchor === null) return;
    const loadedAt = Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - loadedAt) / 60_000);
      setNowHHMM(hhmmFromMinutes((anchor + elapsed) % 1440));
    };
    tick();
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, [opPricing]);

  useEffect(() => {
    if (patient || !query.trim()) { setResults([]); return; }
    let active = true; setSearching(true);
    const t = setTimeout(async () => {
      try { const { patients } = await api.get<{ patients: Patient[] }>(`/reception/patients?q=${encodeURIComponent(query)}&limit=6`); if (active) setResults(patients); }
      catch { if (active) setResults([]); } finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [query, patient]);

  useEffect(() => {
    if (!doctorId) { setSlots([]); return; }
    let active = true; setLoadingSlots(true); setSlotId("");
    api.get<{ slots: Slot[] }>(`/reception/slots?doctorId=${doctorId}&date=${date}`)
      .then((r) => { if (active) setSlots(r.slots); }).catch(() => { if (active) setSlots([]); }).finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [doctorId, date]);

  // Rebuild the whole future grid at a 10-minute cadence, then refresh this view.
  async function regenerateSlots() {
    setRegenerating(true);
    try {
      await api.post("/reception/slots/regenerate");
      if (doctorId) {
        const { slots } = await api.get<{ slots: Slot[] }>(`/reception/slots?doctorId=${doctorId}&date=${date}`);
        setSlots(slots); setSlotId("");
      }
    } catch { /* ignore */ } finally { setRegenerating(false); }
  }

  const [visitType, setVisitType] = useState<"WALKIN" | "EMERGENCY" | "CASUALTY">("WALKIN");
  /** Set the moment the desk picks a visit type, so the cutoff stops choosing for them. */
  const [typeTouched, setTypeTouched] = useState(false);
  const [billNow, setBillNow] = useState(true);
  const [bookDisc, setBookDisc] = useState(0);
  const [payments, setPayments] = useState<Tender[]>([]);
  const [payValid, setPayValid] = useState(true);

  async function book() {
    if (!patient) return;
    // A scheduled visit without a slot is rejected by the API anyway; stop it here.
    if (!unscheduled && (!slotId || !doctorId)) return;
    setError(null); setBooking(true);
    try {
      const { appointment } = await api.post<{ appointment: Booked }>("/reception/appointments", {
        patientId: patient.id,
        // An emergency visit takes no slot even if one was left selected from a
        // previous walk-in attempt - sending it would burn someone's booking.
        slotId: unscheduled ? undefined : slotId,
        doctorId: doctorId || undefined,
        type: visitType,
        // Only sent when a human actually changed the figure. Absent means
        // "charge the policy fee", which the server recomputes for itself.
        ...(feeEdit !== null && doctorId ? { feeOverride: feeEdit } : {}),
        referredByName: referredBy || undefined, referralSource: referralSource || undefined,
        ...(canBill && billNow ? { billNow: { discountAmount: bookDisc || undefined, payments: payments.length ? payments : undefined } } : {}),
      });
      setBooked(appointment);

      // Close the loop on the callback queue. Deliberately after the booking
      // and deliberately swallowed: the visit is real either way, and failing
      // the whole booking because a queue tick didn't save would be worse.
      if (requestId) {
        try {
          await api.patch(`/reception/appointment-requests/${requestId}`, {
            status: "BOOKED", appointmentId: appointment.id,
          });
        } catch { /* the desk can close it by hand from the queue */ }
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not book. Please try again.");
      // Someone else may have taken the slot mid-flight - reload the grid so the
      // desk sees the truth rather than the stale list they just failed against.
      if (doctorId && !unscheduled) {
        try {
          const { slots } = await api.get<{ slots: Slot[] }>(`/reception/slots?doctorId=${doctorId}&date=${date}`);
          setSlots(slots); setSlotId("");
        } catch { /* the booking error above is the one that matters */ }
      }
    } finally { setBooking(false); }
  }

  /**
   * Register a brand-new patient inline, then carry them straight into step 2.
   * A number already on file comes back as a 409 and opens the duplicate
   * dialog; `reason` is what the desk typed there for a different person.
   */
  async function createPatient(reason?: string) {
    const e: typeof npFieldErr = {};
    if (np.firstName.trim().length < 1) e.firstName = "First name is required";
    if (!/^\d{10}$/.test(np.phone)) e.phone = "Must be a 10-digit mobile number";
    else if (notAPatientPhone(np.phone)) e.phone = "Not the patient's number - see below";
    if (np.age && (Number(np.age) < 0 || Number(np.age) > 120)) e.age = "Enter a valid age";
    setNpFieldErr(e);
    if (Object.keys(e).length) return;
    setNpError(null); setCreating(true);
    try {
      const { patient: created } = await api.post<{ patient: Patient }>("/reception/patients", {
        firstName: np.firstName.trim(), lastName: np.lastName.trim() || undefined,
        phone: np.phone, age: np.age ? Number(np.age) : undefined,
        gender: np.gender, bloodGroup: np.blood, city: np.city.trim() || undefined,
        sharedPhoneReason: reason,
      });
      setDupe(null);
      setPatient(created);
      setNp({ ...emptyNp }); setNpFieldErr({}); setPatientMode("existing");
    } catch (err) {
      const onFile = phoneOnFile(err);
      if (onFile) { setDupe(onFile); return; }
      setDupe(null);
      setNpError(err instanceof ApiClientError ? err.message : "Could not register. Please try again.");
    } finally { setCreating(false); }
  }

  /** The patient was already on file - book them, don't register them again. */
  function pickFiled(p: Patient) {
    setDupe(null);
    setPatient(p);
    setNp({ ...emptyNp }); setNpFieldErr({}); setNpError(null); setPatientMode("existing");
  }

  function reset() {
    setBooked(null); setPatient(null); setPatientMode("existing"); setVisitType("WALKIN"); setQuery(""); setResults([]); setDoctorId(""); setSlotId(""); setSlots([]); setError(null); setReferredBy(""); setReferralSource(""); setBookDisc(0); setPayments([]); setPayValid(true);
    // Back to a clean slate for the next patient: the previous one's negotiated
    // fee must not carry over, and the cutoff gets to pick the visit type again.
    setFeeEdit(null); setEditingFee(false); setTypeTouched(false);
    setNp({ ...emptyNp }); setNpError(null); setNpFieldErr({});
  }

  const doctor = doctors.find((d) => d.id === doctorId);
  const slot = slots.find((s) => s.id === slotId);
  const dayFee = Number(doctor?.fee ?? 0);
  /** No slot, no mandatory doctor - emergency and casualty only. */
  const unscheduled = visitType !== "WALKIN";

  // The clock this visit is priced against. A booked slot carries its own time -
  // an 8:30 PM slot is an after-hours visit whenever it was booked, and a slot
  // for tomorrow morning is a daytime one even if booked at midnight. Only a
  // walk-in or emergency, which happens now, is priced off the current time.
  const priceTime = !unscheduled && slot ? slot.startTime : nowHHMM;
  const policyFee = opPricing && priceTime
    ? opFeeFor(dayFee, priceTime, opPricing)
    : { fee: Math.round(dayFee), afterHours: false };
  /** The doubled/emergency rate is in force for this visit's time. */
  const afterHours = policyFee.afterHours;
  const bookFee = feeEdit ?? policyFee.fee;
  // Whole rupees - the same rounding the server bills with (lib/money-round),
  // so the payment box asks for exactly what the bill will be.
  const bookTotal = roundBill(Math.max(0, bookFee - bookDisc));
  /** Nothing is billable until a consultant (and therefore a fee) is named. */
  const canBill = bookFee > 0;
  /** True once the clinic day has closed, whatever visit is being booked. */
  const nowAfterHours = !!(opPricing && nowHHMM && isAfterHours(nowHHMM, opPricing));

  // After the cutoff the clinic isn't running an OP list any more - a doctor who
  // sees this patient is being called in, so the visit is an emergency. Selected
  // for the desk rather than left as a walk-in they must remember to change, but
  // only until they pick a type themselves: once they have, the clock stops
  // overruling them.
  useEffect(() => {
    if (nowAfterHours && !typeTouched && visitType === "WALKIN") setVisitType("EMERGENCY");
  }, [nowAfterHours, typeTouched, visitType]);

  // A typed-in fee belongs to the doctor and time it was typed for. Leaving it in
  // place while either changes is how a ₹1,200 night fee ends up on a ₹400
  // morning slot.
  useEffect(() => { setFeeEdit(null); setEditingFee(false); }, [doctorId, slotId, visitType, afterHours]);
  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3.5 py-2.5 text-sm text-[var(--p-ink)] ring";
  const npCls = (e?: string) => `w-full rounded-lg border bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none transition-all duration-200 focus:ring-2 focus:ring-[var(--p-teal)]/15 ${e ? "border-[var(--p-rose)] focus:border-[var(--p-rose)]" : "border-[var(--p-border)] focus:border-[var(--p-teal)]"}`;
  const seg = (on: boolean) => `inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${on ? "bg-[var(--p-teal)] text-white shadow-sm" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`;

  const step1Done = !!patient;
  const step2Done = !!patient && (unscheduled || (!!doctor && !!slotId));

  if (booked) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="surface overflow-hidden">
          <div className="dotgrid flex flex-col items-center border-b border-[var(--p-border)] px-8 py-10 text-center">
            <SuccessCheck size={52} />
            <h3 className="mt-4 font-serif-p text-[24px] font-semibold text-[var(--p-ink)]">Appointment confirmed</h3>
            <p className="mt-1 text-[14px] text-[var(--p-muted)]">
              {booked.doctor ? `Added to ${booked.doctor.name}'s queue.` : "Casualty OP open - the patient is already marked as arrived."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-[var(--p-border)]">
            <Cell k="OP number" v={booked.opNumber} mono />
            <Cell k="Consultation fee" v={`₹${booked.price}`} mono />
            <Cell k="Patient" v={booked.patient.name} />
            <Cell k="Jeeva ID" v={booked.patient.displayId} mono />
            <Cell k="Doctor" v={booked.doctor?.name ?? "Duty doctor — not yet assigned"} />
            <Cell k="Time" v={booked.time} mono />
            {booked.invoice && <Cell k="Receipt" v={booked.invoice.receiptNo} mono />}
            {booked.invoice && <Cell k="Paid" v={`₹${booked.invoice.totalAmount}`} mono />}
          </div>
          {booked.invoice && (
            <p className="border-t border-[var(--p-border)] bg-[var(--p-cyan-soft)] px-5 py-2.5 text-[13px] font-medium text-[var(--p-cyan-deep)]">
              Booked and billed in one go - the patient walks straight to the doctor. ✓
            </p>
          )}
          <div className="border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3 text-[13px] leading-relaxed text-[var(--p-muted)]">
            <span className="font-semibold text-[var(--p-ink)]">What happens next:</span> the patient sees the doctor → the doctor hands them a paper prescription → they come back to you → upload it from the button below or the Today queue.
          </div>
          <div className="flex flex-wrap gap-3 p-5">
            <a href={`/print/opd/${booked.id}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)]">
              <Icon name="file" size={15} /> Print OPD sheet
            </a>
            {booked.invoice && (
              <a href={`/print/invoice/${booked.invoice.id}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                <Icon name="receipt" size={14} /> Print bill
              </a>
            )}
            <PrimaryButton onClick={reset}><Icon name="plus" size={15} /> Book another</PrimaryButton>
            <a href={`/prescriptions?patient=${booked.patient.displayId}`} className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
              <Icon name="file" size={14} /> Upload Rx (after consult)
            </a>
            <a href="/" className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
              Back to today
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PortalScroll>
      <Suspense fallback={null}>
        <PatientFromUrl onFound={(p) => { setPatient(p); setPrefilled(true); }} />
        <RequestFromUrl onFound={setRequestId} />
      </Suspense>
      {/* page header band */}
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Book an appointment</h1>
          <p className="mt-1 max-w-lg text-[14px] leading-relaxed text-[var(--p-muted)]">
            Find a patient, choose a doctor and an open slot. Booked visits appear in the doctor&apos;s queue instantly.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="badge"><Icon name="users" size={12} /> {recent.length} recent</span>
          <span className="badge"><Icon name="stethoscope" size={12} /> {doctors.length} doctors</span>
        </div>
      </div>

      {prefilled && patient && !booked && (
        <div data-rise className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--p-teal)]/25 bg-[var(--p-teal-soft)] px-4 py-2.5 text-[14px] text-[var(--p-teal-deep)]">
          <Icon name="check" size={14} />
          <span><span className="font-semibold">{patient.fullName}</span> carried over - go straight to choosing the doctor.</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-6">
          {/* STEP 1 */}
          <section data-rise className="surface surface-hover overflow-hidden">
            <Head n={1} done={step1Done} title="Patient" hint="Search for an existing patient, or register a new one on the spot." />
            <div className="p-6 pt-5">
              {!patient ? (
                <>
                  {/* choose: existing (search) or new (register inline) */}
                  <div className="mb-4 inline-flex rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] p-1">
                    <button type="button" onClick={() => { setPatientMode("existing"); setNpError(null); setNpFieldErr({}); }} aria-pressed={patientMode === "existing"} className={seg(patientMode === "existing")}>
                      <Icon name="search" size={14} /> Existing patient
                    </button>
                    <button type="button" onClick={() => { setPatientMode("new"); setQuery(""); setResults([]); }} aria-pressed={patientMode === "new"} className={seg(patientMode === "new")}>
                      <Icon name="plus" size={14} /> New patient
                    </button>
                  </div>

                  {patientMode === "existing" ? (
                    <>
                      <div className="flex items-center gap-2 rounded-md border border-[var(--p-border)] px-3 py-2 ">
                        <span className="text-[var(--p-muted)]"><Icon name="search" size={16} /></span>
                        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or JMH2026OP00123…" className="w-full bg-transparent text-sm text-[var(--p-ink)] outline-none" autoFocus />
                        {searching && <Spinner size={14} />}
                      </div>
                      {query && results.length > 0 && <div className="mt-3 space-y-2">{results.map((p) => <PRow key={p.id} p={p} onPick={() => { setPatient(p); setQuery(""); }} />)}</div>}
                      {query && !searching && results.length === 0 && (
                        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--p-muted)]">
                          No patient found.
                          <button type="button" onClick={() => { setPatientMode("new"); setNp((s) => ({ ...s, firstName: /^\d/.test(query) ? s.firstName : query })); setQuery(""); setResults([]); }} className="font-semibold text-[var(--p-teal)] hover:underline">Register them as a new patient →</button>
                        </p>
                      )}
                      {!query && recent.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--p-muted)]">Recently registered</p>
                          <div className="space-y-2">{recent.map((p) => <PRow key={p.id} p={p} onPick={() => setPatient(p)} />)}</div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="First name" icon="users" required error={npFieldErr.firstName}>
                          <input className={npCls(npFieldErr.firstName)} value={np.firstName} onChange={(e) => { setNp({ ...np, firstName: e.target.value }); setNpFieldErr((p) => ({ ...p, firstName: undefined })); }} placeholder="Divya" autoFocus />
                        </Field>
                        <Field label="Last name">
                          <input className={npCls()} value={np.lastName} onChange={(e) => setNp({ ...np, lastName: e.target.value })} placeholder="Prasad" />
                        </Field>
                        <Field label="Phone" required error={npFieldErr.phone}>
                          <input className={npCls(npFieldErr.phone)} value={np.phone} onChange={(e) => { setNp({ ...np, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }); setNpFieldErr((p) => ({ ...p, phone: undefined })); }} inputMode="numeric" placeholder="9000012345" />
                        </Field>
                        <Field label="Age" error={npFieldErr.age}>
                          <input className={npCls(npFieldErr.age)} value={np.age} onChange={(e) => { setNp({ ...np, age: e.target.value.replace(/\D/g, "").slice(0, 3) }); setNpFieldErr((p) => ({ ...p, age: undefined })); }} inputMode="numeric" placeholder="29" />
                        </Field>
                        <Field label="Gender">
                          <select className={npCls()} value={np.gender} onChange={(e) => setNp({ ...np, gender: e.target.value })}>
                            <option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option>
                          </select>
                        </Field>
                        <Field label="Blood group">
                          <select className={npCls()} value={np.blood} onChange={(e) => setNp({ ...np, blood: e.target.value })}>
                            {BLOODS.map((b) => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </Field>
                      </div>

                      <PhoneOnFileHint phone={np.phone} name={`${np.firstName} ${np.lastName}`}
                        onUse={pickFiled} useLabel="Book for this record" className="mt-4" />
                      {dupe && (
                        <DuplicatePatientDialog
                          onFile={dupe} phone={np.phone} newName={`${np.firstName} ${np.lastName}`.trim()} busy={creating}
                          onUse={pickFiled}
                          onDifferentPerson={(reason) => createPatient(reason)}
                          onClose={() => setDupe(null)}
                        />
                      )}

                      {npError && (
                        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">
                          <Icon name="alert" size={15} /> <span>{npError}</span>
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <PrimaryButton onClick={() => createPatient()} disabled={creating}>
                          {creating ? <><Spinner /> Registering…</> : <><Icon name="plus" size={15} /> Register &amp; continue</>}
                        </PrimaryButton>
                        <p className="text-[12px] text-[var(--p-muted)]">Only first name &amp; phone are required - add fuller details later from the patient file.</p>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-[var(--p-teal)] bg-[var(--p-teal-soft)]/40 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--p-teal)] font-serif-p text-[14px] font-semibold text-white">{inits(patient.fullName)}</div>
                    <div>
                      <div className="text-[14px] font-semibold text-[var(--p-ink)]">{patient.fullName}</div>
                      <div className="text-[12px] text-[var(--p-muted)]"><span className="tabular">{patient.displayId}</span> · {patient.phone}{patient.age != null && ` · ${patient.age}y`}</div>
                    </div>
                  </div>
                  <button onClick={() => setPatient(null)} className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--p-teal)] transition-colors hover:border-[var(--p-teal)]">Change</button>
                </div>
              )}
            </div>
          </section>

          {/* STEP 2 */}
          <section data-rise className={`surface overflow-hidden transition-opacity ${patient ? "surface-hover" : "pointer-events-none opacity-55"}`}>
            <Head n={2} done={step2Done}
              title={unscheduled ? "Emergency / casualty visit" : "Doctor & time"}
              hint={unscheduled ? "Issued for right now. Name a doctor only if one has already taken the case." : "Pick a doctor and an available slot for the day."} />
            <div className="p-6 pt-5">
              <div className="mb-5">
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]">Visit Type / Category</label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setTypeTouched(true); setVisitType("WALKIN"); }} className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-colors ${visitType === "WALKIN" ? "border-[#0b5f55] bg-[#0b5f55] text-white shadow-sm" : "border-[var(--p-border)] text-[var(--p-ink)] hover:border-[#0b5f55]"}`}>
                    Regular OP (Walk-in)
                  </button>
                  <button type="button" onClick={() => { setTypeTouched(true); setVisitType("EMERGENCY"); setSlotId(""); }} className={`rounded-lg  border px-3.5 py-2 text-[13px] font-semibold transition-colors ${visitType === "EMERGENCY" ? "border-[#dc2626] bg-[#dc2626] text-white shadow-sm" : "border-[var(--p-border)] text-[#dc2626] hover:border-[#dc2626]"}`}>
                    <Icon name="alert" size={13} className="inline mr-1" /> Emergency OP
                  </button>
                  <button type="button" onClick={() => { setTypeTouched(true); setVisitType("CASUALTY"); setSlotId(""); }} className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-colors ${visitType === "CASUALTY" ? "border-[#9333ea] bg-[#9333ea] text-white shadow-sm" : "border-[var(--p-border)] text-[#9333ea] hover:border-[#9333ea]"}`}>
                    Casualty OP
                  </button>
                </div>

                {/* The clinic day is over: say so, and say what it does to the fee. */}
                {nowAfterHours && opPricing && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12.5px] leading-relaxed text-amber-900">
                    <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                    <span>
                      <b>After hours</b> ({prettyTime(opPricing.start)}&ndash;{prettyTime(opPricing.end)}).
                      OP is taken as an <b>emergency</b> and the consultation is charged at{" "}
                      <b>{opPricing.multiplier}&times; the day fee</b>. You can change the amount below if a
                      different fee was agreed.
                    </span>
                  </div>
                )}
                {visitType !== "WALKIN" && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] leading-relaxed text-red-800">
                    <span className="font-bold">{visitType === "CASUALTY" ? "Casualty" : "Emergency"} visit:</span> no slot is taken and a doctor is optional.
                    The patient is recorded as <b>already arrived</b>, and the OPD sheet prints an <b>{visitType} OP</b> band with a
                    blank &ldquo;attended by&rdquo; line for whoever sees them. Naming a doctor here bills their consultation fee as usual.
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]">
                  Doctor {unscheduled && <span className="font-normal normal-case text-[var(--p-muted)]">· optional — leave blank and the sheet prints a duty-doctor block</span>}
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {doctors.map((d) => {
                    const active = doctorId === d.id;
                    return (
                      <button key={d.id} type="button" onClick={() => setDoctorId(active ? "" : d.id)} aria-pressed={active}
                        className={`flex items-center gap-3 rounded-[10px] border p-2.5 text-left transition-colors ${active ? "border-[var(--p-teal)] bg-[var(--p-teal-soft)]" : "border-[var(--p-border)] hover:border-[var(--p-border-strong)] hover:bg-[var(--p-bg)]"}`}>
                        <DoctorAvatar name={d.name} image={d.photoUrl ?? undefined} className="h-11 w-11 flex-none rounded-full text-[12px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-[var(--p-ink)]">{d.name}</span>
                          <span className="block truncate text-[11.5px] text-[var(--p-teal-deep)]">{d.specialization}</span>
                          <span className="mt-0.5 block font-mono text-[10.5px] text-[var(--p-muted)]">{d.department} · ₹{d.fee}</span>
                        </span>
                        {active && <span className="shrink-0 text-[var(--p-teal)]"><Icon name="check" size={16} /></span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* An emergency visit is stamped with the wall clock server-side,
                  so offering a date to pick would be a lie. */}
              {!unscheduled && (
                <div className="mt-4 max-w-[240px]">
                  <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]">Date</label>
                  <PortalDatePicker value={date} min={todayISO()} onChange={setDate} accent="teal" />
                </div>
              )}

              {/* selected doctor info card */}
              {doctor && (
                <div className="mt-4 rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[var(--p-teal)] to-[var(--p-cyan)] text-[15px] font-bold text-white">
                        {doctor.name.replace(/^Dr\.?\s*/i, "").split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                        {doctor.photoUrl && <img src={doctor.photoUrl} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} className="absolute inset-0 h-full w-full object-cover" />}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-[var(--p-ink)]">{doctor.name}</div>
                        <div className="text-[13px] font-medium text-[var(--p-teal-deep)]">{doctor.specialization}</div>
                        {doctor.qualification && <div className="text-[12px] text-[var(--p-muted)]">{doctor.qualification}</div>}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {doctor.experienceYears != null && <span className="rounded-full border border-[var(--p-border)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--p-muted)]">{doctor.experienceYears}+ yrs exp</span>}
                          {doctor.age != null && <span className="rounded-full border border-[var(--p-border)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--p-muted)]">Age {doctor.age}</span>}
                          <span className="rounded-full border border-[var(--p-border)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--p-muted)]">{doctor.department}</span>
                          {doctor.languages && <span className="rounded-full border border-[var(--p-border)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--p-muted)]">{doctor.languages}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {afterHours ? (
                        <>
                          {/* Both figures, because "why is it 1200" is the first
                              thing the patient asks and the desk needs the answer
                              on screen, not in a policy document. */}
                          <div className="font-mono text-[13px] text-[var(--p-muted)] line-through">₹{doctor.fee}</div>
                          <div className="font-mono text-[15px] font-semibold text-amber-700">₹{policyFee.fee}</div>
                          <div className="text-[11px] uppercase tracking-wide text-amber-700">after hours ×{opPricing?.multiplier}</div>
                        </>
                      ) : (
                        <>
                          <div className="font-mono text-[15px] font-semibold text-[var(--p-ink)]">₹{doctor.fee}</div>
                          <div className="text-[11px] uppercase tracking-wide text-[var(--p-muted)]">consultation</div>
                        </>
                      )}
                    </div>
                  </div>
                  {doctor.bio && <p className="mt-3 border-t border-[var(--p-border)] pt-3 text-[12px] leading-relaxed text-[var(--p-muted)]">{doctor.bio}</p>}
                </div>
              )}

              {doctorId && !unscheduled && (
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]">Available slots · {prettyDate(date)}</p>
                    <div className="flex items-center gap-3">
                      {!loadingSlots && <span className="text-[12px] text-[var(--p-muted)]">{slots.filter((s) => !slotPast(s.startTime, date)).length} bookable</span>}
                      <button type="button" onClick={regenerateSlots} disabled={regenerating} title="Rebuild the booking grid at 10-minute gaps" className="text-[11px] font-semibold text-[var(--p-teal)] hover:underline disabled:opacity-50">{regenerating ? "Regenerating…" : "Regenerate 10-min"}</button>
                    </div>
                  </div>
                  {loadingSlots ? (
                    <div className="flex items-center gap-2 py-4 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Loading slots…</div>
                  ) : slots.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--p-border)] py-6 text-center text-[13px] text-[var(--p-muted)]">No free slots for this day. Try another date.</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                        {slots.map((s) => {
                          const past = slotPast(s.startTime, date);
                          return (
                            <button key={s.id} type="button" onClick={() => !past && setSlotId(s.id)} disabled={past}
                              title={past ? "This time has already passed" : undefined}
                              className={`rounded-lg border px-2 py-2.5 font-mono text-[13px] transition-all ${
                                past ? "cursor-not-allowed border-[var(--p-border)] bg-[var(--p-bg)] text-[var(--p-muted)] line-through opacity-60"
                                : slotId === s.id ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white shadow-[0_4px_12px_-4px_rgba(13,125,130,.5)]"
                                : "border-[var(--p-border)] text-[var(--p-ink)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]"}`}>
                              {s.startTime}
                            </button>
                          );
                        })}
                      </div>
                      {slots.every((s) => slotPast(s.startTime, date)) && (
                        <p className="mt-3 rounded-lg border border-dashed border-[var(--p-border)] py-3 text-center text-[13px] text-[var(--p-muted)]">
                          All of today&apos;s slots have passed. Pick a later date to book.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="my-5 rule" />

              <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--p-muted)]">
                Referral <span className="badge !py-0.5 !text-[11px]"><Icon name="alert" size={10} /> admin-only</span>
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Referred by"><input className={fld} value={referredBy} onChange={(e) => setReferredBy(e.target.value)} placeholder="Dr. Anil, City Clinic" /></Field>
                <Field label="Source"><input className={fld} value={referralSource} onChange={(e) => setReferralSource(e.target.value)} placeholder="Camp / online / walk-in" /></Field>
              </div>

              {error && (
                <div data-rise className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">
                  <Icon name="alert" size={15} /> <span>{error}</span>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* SUMMARY rail (sticky) */}
        <aside data-rise className="lg:sticky lg:top-24 lg:self-start">
          <div className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--p-ink)]">Booking summary</p>
            </div>
            <div className="divide-y divide-[var(--p-border)]">
              <SumRow k="Visit type" v={visitType === "EMERGENCY" ? "EMERGENCY OP" : visitType === "CASUALTY" ? "CASUALTY OP" : "Walk-in OP"} />
              <SumRow k="Patient" v={patient?.fullName} />
              <SumRow k="Jeeva ID" v={patient?.displayId} mono />
              <SumRow k="Doctor" v={doctor?.name ?? (unscheduled ? "Duty doctor — assigned on arrival" : undefined)} />
              <SumRow k="Department" v={doctor?.department ?? (unscheduled ? "Emergency & Casualty" : undefined)} />
              <SumRow k="Date" v={prettyDate(unscheduled ? todayISO() : date)} />
              <SumRow k="Time" v={slot?.startTime ?? (unscheduled ? "Now" : undefined)} mono />
              <div className="px-5 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-[var(--p-ink)]">
                    Fee
                    {afterHours && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                        after hours ×{opPricing?.multiplier}
                      </span>
                    )}
                  </span>
                  {editingFee ? (
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[14px] text-[var(--p-muted)]">₹</span>
                      <input
                        autoFocus inputMode="numeric" aria-label="Consultation fee"
                        value={feeEdit ?? policyFee.fee}
                        onChange={(e) => setFeeEdit(Number(e.target.value.replace(/\D/g, "") || 0))}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingFee(false); }}
                        className="w-24 rounded-lg border border-[var(--p-blue)] bg-white px-2 py-1 text-right font-mono text-[15px] font-semibold text-[var(--p-ink)] outline-none"
                      />
                      <button type="button" onClick={() => setEditingFee(false)}
                        className="rounded-md px-1.5 py-1 text-[12px] font-semibold text-[var(--p-blue)] hover:underline">Done</button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className={`font-mono text-[15px] font-semibold ${afterHours ? "text-amber-700" : "text-[var(--p-teal)]"}`}>
                        ₹{doctor || feeEdit !== null ? bookFee : 0}
                      </span>
                      {/* Editable whatever the hour: a daytime fee gets negotiated
                          too, and a control that only appears after 8 PM is one
                          the desk has to relearn every night.

                          Only once a doctor is named, though - the server ignores
                          an override on a doctorless casualty case, whose charges
                          are raised from Billing later. Offering the control there
                          would let the desk type a fee that silently vanished. */}
                      {doctor && (
                        <button type="button" onClick={() => setEditingFee(true)}
                          className="rounded-md border border-[var(--p-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]">
                          Edit
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {/* What the policy would have charged, kept visible so an override
                    is never mistaken for the standard rate. */}
                {feeEdit !== null && feeEdit !== policyFee.fee && (
                  <p className="mt-1.5 text-right text-[11px] text-[var(--p-muted)]">
                    edited · {afterHours ? "after-hours rate" : "standard fee"} was ₹{policyFee.fee}
                    <button type="button" onClick={() => setFeeEdit(null)} className="ml-2 font-semibold text-[var(--p-blue)] hover:underline">reset</button>
                  </p>
                )}
                {afterHours && feeEdit === null && dayFee > 0 && (
                  <p className="mt-1.5 text-right text-[11px] text-[var(--p-muted)]">day fee ₹{Math.round(dayFee)} ×{opPricing?.multiplier}</p>
                )}
              </div>
            </div>
            <div className="space-y-3 border-t border-[var(--p-border)] px-5 pt-4">
              {/* Nothing to charge until a consultant is named, so there is
                  nothing to collect either. Offering a ₹0 receipt would just
                  leave a phantom unpaid bill on the billing screen. */}
              {canBill ? (
                <>
                  <label className="flex items-center gap-2.5 text-[14px] font-medium text-[var(--p-ink)]">
                    <input type="checkbox" checked={billNow} onChange={(e) => setBillNow(e.target.checked)} className="h-4 w-4 accent-[var(--p-blue)]" />
                    Generate bill &amp; collect fee now
                  </label>
                  {billNow && (
                    <div className="space-y-3">
                      <DiscountInput subtotal={bookFee} accent="blue" onChange={(d) => setBookDisc(d.amount)} />
                      <div className="flex justify-between text-[13px]">
                        <span className="text-[var(--p-muted)]">To collect</span>
                        <span className="font-mono font-semibold text-[var(--p-blue)]">₹{bookTotal.toFixed(2)}</span>
                      </div>
                      <PaymentSection total={bookTotal} accent="blue" onChange={(r) => { setPayments(r.payments); setPayValid(r.valid); }} />
                    </div>
                  )}
                  <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
                    {billNow ? "One motion: OP number + GST receipt together. No second queue at billing." : "Booking only - bill later from the patient's page."}
                  </p>
                </>
              ) : (
                <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
                  No consultation fee to collect yet - casualty charges are raised from <b>Billing</b> once the
                  patient has been seen and the procedures are known.
                </p>
              )}
            </div>
            <div className="p-5 pt-3">
              <PrimaryButton onClick={book} disabled={!step2Done || booking || (canBill && billNow && bookTotal > 0 && !payValid)} full>
                {booking
                  ? <><Spinner /> {unscheduled ? "Issuing OP…" : "Booking…"}</>
                  : <><Icon name="calendar" size={15} /> {unscheduled ? "Issue emergency OP" : canBill && billNow ? "Confirm & bill" : "Confirm booking"}</>}
              </PrimaryButton>
              <p className="mt-3 text-center text-[12px] leading-relaxed text-[var(--p-muted)]">
                {!step2Done ? "Complete both steps to confirm."
                  : unscheduled ? "Ready - issues an OP number now and marks the patient as arrived."
                  : "Ready - this books instantly into the doctor's queue."}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </PortalScroll>
  );
}

function Head({ n, title, hint, done }: { n: number; title: string; hint: string; done: boolean }) {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--p-border)] px-6 py-4">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-colors ${done ? "bg-[var(--p-teal)] text-white" : "border border-[var(--p-border)] text-[var(--p-muted)]"}`}>
        {done ? <Icon name="check" size={14} /> : n}
      </div>
      <div>
        <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">{title}</h3>
        <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">{hint}</p>
      </div>
    </div>
  );
}
function PRow({ p, onPick }: { p: Patient; onPick: () => void }) {
  return (
    <button onClick={onPick} className="surface-hover flex w-full items-center justify-between rounded-lg border border-[var(--p-border)] p-3 text-left">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--p-teal-soft)] font-serif-p text-[13px] font-semibold text-[var(--p-teal)]">{inits(p.fullName)}</div>
        <div><div className="text-[14px] font-medium text-[var(--p-ink)]">{p.fullName}</div><div className="text-[12px] text-[var(--p-muted)]"><span className="tabular">{p.displayId}</span> · {p.phone}</div></div>
      </div>
      <Icon name="chevron" size={16} />
    </button>
  );
}
function SumRow({ k, v, mono }: { k: string; v?: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-[13px] text-[var(--p-muted)]">{k}</span>
      <span className={`text-right text-[14px] ${v ? "text-[var(--p-ink)]" : "text-[var(--p-muted)]"} ${mono ? "font-mono text-[13px]" : ""}`}>{v ?? "-"}</span>
    </div>
  );
}
function Cell({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{k}</p>
      <p className={`mt-1 text-[14px] text-[var(--p-ink)] ${mono ? "font-mono text-[14px]" : ""}`}>{v}</p>
    </div>
  );
}
