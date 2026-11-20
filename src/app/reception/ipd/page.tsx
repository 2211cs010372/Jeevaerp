"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { SvgArrow } from "@/components/portal/ui/svg-arrow";
import { Req, Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";
import { useInsurers } from "@/lib/use-insurers";
import { bedLabel, bedShort } from "@/lib/beds";

interface Bed {
  id: string; bedNo: string; status: string;
  /** `days` counts started days from admission, minimum 1 - what the bill charges. */
  patient: {
    displayId: string; fullName: string; phone?: string; ipNumber: string; admissionId: string;
    admittedAt: string; days: number;
  } | null;
}
interface Ward {
  id: string; name: string; category: string; floor: string | null;
  dailyCharge: string; gstRatePct: string; available: number; total: number; beds: Bed[];
}
interface Board { summary: { total: number; available: number; occupied: number; maintenance: number }; wards: Ward[]; }
interface FreeWard {
  id: string; name: string; dailyCharge: string; gstRatePct: string;
  beds: { id: string; bedNo: string }[];
}
interface Doctor { id: string; name: string; department: string; }
interface Patient { id: string; displayId: string; fullName: string; phone: string; age?: number | null; gender?: string | null; }

/** The occupant panel is the admission sheet - no new endpoint needed. */
interface Sheet {
  admission: {
    id: string; ipNumber: string; status: string; admittedAt: string; reason: string | null;
    wardName: string; bedNo: string; dailyCharge: string; gstRatePct: string;
    attendantName: string | null; attendantPhone: string | null; attendantRelation: string | null;
    payerType: string; insurer: string | null; policyNo: string | null; memberId: string | null;
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
    doctor: { name: string; department: string };
  };
  days: number; bedTotal: string; chargesTotal: string; grandTotal: string;
  charges: { id: string }[];
}

function RealHospitalBedSvg({ className = "h-12 w-auto", muted = false }: { className?: string; muted?: boolean }) {
  const strokeColor = muted ? "#94a3b8" : "#64748b";
  const frameColor = muted ? "#cbd5e1" : "url(#bed-metal-grad)";
  const sheetColor = muted ? "#f1f5f9" : "url(#bed-sheet-grad)";
  const sheetBorder = muted ? "#cbd5e1" : "#10b981";

  return (
    <svg
      viewBox="0 0 108 58"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="bed-metal-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="45%" stopColor="#e2e8f0" />
          <stop offset="70%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
        <linearGradient id="bed-mattress-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e2e8f0" />
        </linearGradient>
        <linearGradient id="bed-sheet-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ecfdf5" />
          <stop offset="100%" stopColor="#d1fae5" />
        </linearGradient>
        <linearGradient id="bed-pillow-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f8fafc" />
        </linearGradient>
      </defs>

      {/* Ground soft shadow */}
      <ellipse cx="56" cy="53" rx="44" ry="2.5" fill="#0f172a" fillOpacity={muted ? "0.04" : "0.08"} />

      {/* IV Pole / Saline Stand (attached to headboard) */}
      {!muted && (
        <g opacity="0.9">
          <path d="M 17 8 L 17 48" stroke="#94a3b8" strokeWidth="1.25" strokeLinecap="round" />
          <path d="M 13 11 Q 17 9 21 11" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          {/* IV Bag */}
          <rect x="19" y="12" width="6" height="8.5" rx="1.5" fill="#e0f2fe" stroke="#38bdf8" strokeWidth="0.75" />
          <line x1="20.5" y1="16" x2="23.5" y2="16" stroke="#0284c7" strokeWidth="0.6" strokeLinecap="round" />
          {/* Drip Tubing */}
          <path d="M 22 20.5 L 22 28 Q 22 34 27 35" stroke="#7dd3fc" strokeWidth="0.75" strokeDasharray="1.5 1" fill="none" />
        </g>
      )}

      {/* Wheels / Casters */}
      {/* Front/Left Caster */}
      <rect x="25" y="47" width="2.5" height="3.5" rx="0.5" fill="#64748b" />
      <circle cx="26.2" cy="51.5" r="2.5" fill="#334155" />
      <circle cx="26.2" cy="51.5" r="0.9" fill="#e2e8f0" />
      {/* Back/Right Caster */}
      <rect x="87" y="47" width="2.5" height="3.5" rx="0.5" fill="#64748b" />
      <circle cx="88.2" cy="51.5" r="2.5" fill="#334155" />
      <circle cx="88.2" cy="51.5" r="0.9" fill="#e2e8f0" />

      {/* Lower Chassis Frame Beam */}
      <rect x="23" y="45.5" width="68" height="2.8" rx="1.4" fill={frameColor} stroke={strokeColor} strokeWidth="0.4" />
      {/* Scissor / lift struts */}
      <line x1="30" y1="45.5" x2="36" y2="38" stroke={strokeColor} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="83" y1="45.5" x2="77" y2="38" stroke={strokeColor} strokeWidth="1.4" strokeLinecap="round" />

      {/* Bed Base Deck Beam */}
      <path d="M 20 31.5 L 43 38 L 92 38" stroke="#334155" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* Headboard (Arched tubular metallic frame) */}
      <path d="M 16 48 L 16 18 C 16 15 22 15 22 18 L 22 48" stroke={frameColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="16" y1="25" x2="22" y2="25" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" />

      {/* Footboard (Shorter matching frame) */}
      <path d="M 91 48 L 91 28 C 91 25.5 96 25.5 96 28 L 96 48" stroke={frameColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="91" y1="33" x2="96" y2="33" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" />

      {/* Mattress 3D Contour */}
      {/* Elevated backrest section */}
      <path d="M 21 29.5 L 43 36.5 L 43 40 L 21 33 Z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.5" />
      <path d="M 21 28 L 43 35 L 43 37 L 21 30 Z" fill="url(#bed-mattress-grad)" stroke="#94a3b8" strokeWidth="0.5" />

      {/* Flat mattress section */}
      <path d="M 43 36.5 L 90 36.5 L 90 40 L 43 40 Z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="0.5" />
      <path d="M 43 35 L 90 35 L 90 37 L 43 37 Z" fill="url(#bed-mattress-grad)" stroke="#94a3b8" strokeWidth="0.5" />

      {/* Soft Pillow on the elevated backrest */}
      <path
        d="M 24 25 C 24 22.5 32 24.5 34 26.5 C 35 28.5 33.5 30.5 31.5 31.5 C 29 32.5 24 30.5 23 28.5 C 22 26.5 24 25.5 24 25 Z"
        fill="url(#bed-pillow-grad)"
        stroke="#94a3b8"
        strokeWidth="0.5"
      />
      <path d="M 26.5 26.5 Q 29 27.5 31 28.5" stroke="#cbd5e1" strokeWidth="0.6" strokeLinecap="round" fill="none" />

      {/* Hospital Sheet / Blanket neatly folded over lower half */}
      <path d="M 48 34.5 L 90 34.5 L 90 39.5 L 48 39.5 Z" fill={sheetColor} stroke={sheetBorder} strokeWidth="0.5" />
      <rect x="46.5" y="34" width="3" height="5.5" rx="1" fill={muted ? "#94a3b8" : "#10b981"} stroke={sheetBorder} strokeWidth="0.4" />

      {/* Safety Side Guard Rail */}
      <rect x="45" y="27" width="30" height="2.2" rx="1" fill="#cbd5e1" stroke={strokeColor} strokeWidth="0.5" />
      <line x1="50" y1="29.2" x2="50" y2="37" stroke={strokeColor} strokeWidth="1" strokeLinecap="round" />
      <line x1="60" y1="29.2" x2="60" y2="37" stroke={strokeColor} strokeWidth="1" strokeLinecap="round" />
      <line x1="70" y1="29.2" x2="70" y2="37" stroke={strokeColor} strokeWidth="1" strokeLinecap="round" />
      <line x1="45" y1="32.5" x2="75" y2="32.5" stroke="#94a3b8" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  );
}

const blank = {
  reason: "", attendantName: "", attendantPhone: "", attendantRelation: "", notes: "",
  // Self-pay is the default because it is the common case and because the wrong
  // default here is expensive in one direction only: an insurance patient marked
  // self-pay is caught at the counter when the family says "but it's cashless",
  // whereas a self-payer marked insurance sits on the claims desk forever.
  payerType: "SELF_PAY" as "SELF_PAY" | "INSURANCE",
  insurer: "",
};
const money = (v: string | number) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
/** "12 Aug" - the admission date, short enough to sit inside a bed tile. */
const sinceDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

function PatientFromUrl({ onFound }: { onFound: (p: Patient) => void }) {
  const params = useSearchParams();
  useEffect(() => {
    const pid = params.get("patient");
    if (!pid) return;
    api.get<{ patient: Patient }>(`/reception/patients/${encodeURIComponent(pid)}`)
      .then((r) => onFound(r.patient)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function BedBoardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [bedFilter, setBedFilter] = useState("");

  // The hospital's own insurer list, not the one compiled into this file. Falls
  // back to the built-in names until the fetch lands - see useInsurers.
  const insurerOptions = useInsurers();

  // ── admit panel (always on screen, like the demo) ──
  const [freeWards, setFreeWards] = useState<FreeWard[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [pq, setPq] = useState("");
  const [pResults, setPResults] = useState<Patient[]>([]);
  const [wardId, setWardId] = useState("");
  const [bedId, setBedId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);
  const [doneIp, setDoneIp] = useState<{ ipNumber: string; bedNo: string; ward: string } | null>(null);

  // ── occupant drawer ──
  const [occupant, setOccupant] = useState<Sheet | null>(null);
  const [occupantLoading, setOccupantLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, fw] = await Promise.all([
        api.get<Board>("/ipd/board"),
        api.get<{ wards: FreeWard[] }>("/ipd/beds/available"),
      ]);
      setBoard(b);
      const withBeds = fw.wards.filter((w) => w.beds.length > 0);
      setFreeWards(withBeds);
      setWardId((cur) => (withBeds.some((w) => w.id === cur) ? cur : withBeds[0]?.id ?? ""));
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load the board."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Beds free up and fill from the ward, not from this screen. An admission
  // list showing a bed that was vacated at noon is how two patients get sent to
  // the same bed.
  useLive([TOPICS.IPD], load);

  useEffect(() => {
    api.get<{ doctors: Doctor[] }>("/reception/doctors").then((r) => setDoctors(r.doctors)).catch(() => {});
  }, []);

  // keep the bed dropdown honest whenever the ward changes
  useEffect(() => {
    const w = freeWards.find((x) => x.id === wardId);
    setBedId((cur) => (w?.beds.some((b) => b.id === cur) ? cur : w?.beds[0]?.id ?? ""));
  }, [wardId, freeWards]);

  useEffect(() => {
    if (patient || !pq.trim()) { setPResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { patients } = await api.get<{ patients: Patient[] }>(`/reception/patients?q=${encodeURIComponent(pq)}`);
        setPResults(patients);
      } catch { setPResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [pq, patient]);

  const selectedWard = freeWards.find((w) => w.id === wardId) ?? null;

  /** Tap a bed: free → load it into the admit panel; occupied → who's in it. */
  async function tapBed(b: Bed, w: Ward) {
    if (b.status === "MAINTENANCE") return;
    if (b.status === "AVAILABLE") {
      const fw = freeWards.find((x) => x.id === w.id);
      if (fw?.beds.some((x) => x.id === b.id)) { setWardId(w.id); setBedId(b.id); }
      setOccupant(null);
      return;
    }
    if (!b.patient) return;
    setOccupantLoading(true); setOccupant(null);
    try { setOccupant(await api.get<Sheet>(`/ipd/admissions/${b.patient.admissionId}/sheet`)); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load the patient."); }
    finally { setOccupantLoading(false); }
  }

  /** An insurance admission is not complete without somebody to bill. */
  const insuranceReady = form.payerType === "SELF_PAY" || !!form.insurer.trim();

  async function admit() {
    if (!patient || !bedId || !doctorId || !insuranceReady) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ ipNumber: string; bedNo: string; ward: string }>("/ipd/admissions", {
        patientDisplayId: patient.displayId,
        bedId, doctorId,
        reason: form.reason || undefined,
        attendantName: form.attendantName || undefined,
        attendantPhone: form.attendantPhone || undefined,
        attendantRelation: form.attendantRelation || undefined,
        notes: form.notes || undefined,
        payerType: form.payerType,
        insurer: form.payerType === "INSURANCE" ? form.insurer || undefined : undefined,
      });
      setDoneIp(res);
      setPatient(null); setPq(""); setDoctorId(""); setForm({ ...blank }); setBedId("");
      await load();
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not admit."); }
    finally { setBusy(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-blue)]";
  const lbl = "mb-1.5 block text-[13px] font-medium text-[var(--p-text)]";

  return (
    <PortalScroll>
      <style>{CSS}</style>
      <Suspense fallback={null}>
        <PatientFromUrl onFound={(p) => { setPatient(p); setPq(""); }} />
      </Suspense>

      {/* ---- Studio Header & Tab Bar (ElevenLabs Light Studio) ---- */}
      <div data-rise className="mb-5 overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[12px] font-medium text-[#737373]">
              <span>Front desk</span>
              <span className="text-[#d4d4d4]">/</span>
              <span className="text-[#111111]">Admissions</span>
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight text-[#111111]">Inpatients &amp; beds</h1>
          </div>
          <Link href="/ipd/inpatients" className="btn-primary group inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-[13px] font-medium text-white transition-all">
            <Icon name="bed" size={14} />
            <span>Inpatients &amp; discharge</span>
            <SvgArrow size={13} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="flex items-center justify-between border-t border-[#ececec] px-6">
          <nav className="flex items-center gap-6 text-[13px]" aria-label="IPD sections">
            <span className="border-b-2 border-[#111111] py-2.5 font-medium text-[#111111] whitespace-nowrap">Bed board</span>
            <Link href="/ipd/inpatients" className="border-b-2 border-transparent py-2.5 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap">Inpatients list</Link>
            <Link href="/ipd/charges" className="border-b-2 border-transparent py-2.5 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap">IPD charges</Link>
            <Link href="/" className="border-b-2 border-transparent py-2.5 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap">Today</Link>
          </nav>
        </div>
      </div>

      <div data-rise className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat label="Total beds" value={board?.summary.total ?? 0} tone="ink" />
        <Stat label="Empty" value={board?.summary.available ?? 0} tone="ok" />
        <Stat label="Occupied" value={board?.summary.occupied ?? 0} tone="busy" />
        <Stat label="Out of service" value={board?.summary.maintenance ?? 0} tone="off" />
      </div>

      {flash && (
        <div data-rise className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13.5px] font-medium text-emerald-800">
          <span className="flex items-center gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button onClick={() => setFlash(null)} className="text-emerald-600 hover:text-emerald-900">✕</button>
        </div>
      )}
      {error && <div data-rise className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-700">{error}</div>}

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_380px]">
        {/* ───────── BED BOARD ───────── */}
        <section data-rise className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-[#f5f5f4] p-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[#e5e5e5] bg-white text-[#111111]">
                <Icon name="bed" size={13} />
              </span>
              <h2 className="text-[13.5px] font-semibold text-[#111111]">Ward &amp; bed board</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-full min-w-[220px] max-w-xs">
                <input
                  type="text"
                  value={bedFilter}
                  onChange={(e) => setBedFilter(e.target.value)}
                  placeholder="Search bed, IP, name, phone…"
                  className="w-full rounded-[10px] border border-[#e5e5e5] bg-white py-1.5 pl-8 pr-7 text-[12.5px] text-[#111111] outline-none focus:border-[#111111]"
                />
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#737373]">
                  <Icon name="search" size={13} />
                </span>
                {bedFilter && (
                  <button
                    onClick={() => setBedFilter("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-xs text-[#737373] hover:text-[#111111]"
                  >
                    ✕
                  </button>
                )}
              </div>
              {bedFilter && (
                <Link
                  href={`/ipd/inpatients?q=${encodeURIComponent(bedFilter)}`}
                  className="group inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#111111] hover:border-[#d4d4d4]"
                  title="Search this query in Inpatients list"
                >
                  <span>Inpatients list</span>
                  <SvgArrow size={12} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-[14px] text-[#737373]"><Spinner /> Loading wards…</div>
          ) : !board?.wards.length ? (
            <div className="flex flex-col items-center px-6 py-20 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full border border-[#e5e5e5] bg-white text-[#737373]"><Icon name="bed" size={20} /></span>
              <p className="mt-3 text-[14px] font-semibold text-[#111111]">No wards yet.</p>
              <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-[#737373]">
                An admin creates them under <b>Wards &amp; beds</b>.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {board.wards.map((w) => {
                const occCount = w.total - w.available;
                const occPct = w.total > 0 ? Math.round((occCount / w.total) * 100) : 0;
                return (
                  <div key={w.id} className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                    {/* ── SECTION HEADER BAR ── */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0f0f0] bg-[#fafafa] px-5 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-[#111111]" />
                          <h3 className="text-[14px] font-bold tracking-tight text-[#111111]">{w.name}</h3>
                        </div>
                        <span className="rounded-md border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#525252]">
                          {w.total}
                        </span>
                        {w.floor && (
                          <span className="rounded-md border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] font-medium text-[#737373]">
                            {w.floor}
                          </span>
                        )}
                        <span className="text-[12px] font-medium text-[#737373] tabular-nums">
                          ₹{money(w.dailyCharge)}/day{Number(w.gstRatePct) > 0 && ` + ${w.gstRatePct}% GST`}
                        </span>
                      </div>

                      {/* Right: Occupancy badge + Progress bar */}
                      <div className="flex items-center gap-3">
                        <div className="hidden sm:flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#e5e5e5]">
                            <div
                              className={`h-full rounded-full transition-all ${
                                w.available === 0 ? "bg-rose-500" : occPct > 75 ? "bg-amber-500" : "bg-[#111111]"
                              }`}
                              style={{ width: `${occPct}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-[#737373] tabular-nums">{occPct}%</span>
                        </div>

                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${
                          w.available === 0
                            ? "border border-rose-200 bg-rose-50 text-rose-700"
                            : "border border-[#e5e5e5] bg-white text-[#404040]"
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${w.available === 0 ? "bg-rose-500" : "bg-emerald-500"}`} />
                          {occCount}/{w.total} Occupied ({w.available} free)
                        </span>
                      </div>
                    </div>

                    {/* ── SECTION BEDS GRID ── */}
                    <div className="p-4">
                      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">
                        {w.beds.map((b) => {
                          const st = b.status.toLowerCase();
                          const picked = bedId === b.id;
                          const shown = occupant?.admission.id === b.patient?.admissionId && !!b.patient;
                          const bq = bedFilter.trim().toLowerCase();
                          const matches = !bq || (b.patient && (
                            b.patient.fullName.toLowerCase().includes(bq) ||
                            b.patient.ipNumber.toLowerCase().includes(bq) ||
                            b.patient.displayId.toLowerCase().includes(bq) ||
                            (b.patient.phone && b.patient.phone.includes(bq))
                          )) || b.bedNo.toLowerCase().includes(bq);

                          return (
                            <button
                              key={b.id}
                              onClick={() => tapBed(b, w)}
                              disabled={b.status === "MAINTENANCE"}
                              className={`group bed-card bed-${st} ${picked ? "is-picked" : ""} ${shown ? "is-shown" : ""} ${bq && matches ? "ring-2 ring-[#111111] shadow-md" : ""} ${bq && !matches ? "opacity-30" : ""}`}
                            >
                              {/* ── CARD TOP: Bed Number & Status Pill ── */}
                              <div className="flex w-full items-start justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold ${
                                    b.patient
                                      ? "border-blue-200 bg-blue-50 text-blue-700"
                                      : b.status === "MAINTENANCE"
                                      ? "border-[#e5e5e5] bg-[#fafafa] text-[#a3a3a3]"
                                      : "border-emerald-200 bg-emerald-100/10 text-emerald-800"
                                  }`}>
                                    <Icon name="bed" size={12} />
                                  </span>
                                  <div className="text-left leading-tight">
                                    <div className="bed-no font-bold text-[13px] text-[#111111]">{bedShort(b.bedNo)}</div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#8e8e8e]">{w.name}</div>
                                  </div>
                                </div>

                                {picked ? (
                                  <span className="bed-tick"><Icon name="check" size={11} /></span>
                                ) : b.patient ? (
                                  <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-300 bg-blue-100/90 px-1.5 py-0.5 text-[10.5px] font-bold text-blue-800 shadow-2xs">
                                    <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                                    Day {b.patient.days}
                                  </span>
                                ) : b.status === "MAINTENANCE" ? (
                                  <span className="rounded-full border border-[#e5e5e5] bg-[#f5f5f4] px-2 py-0.5 text-[10px] font-medium text-[#737373]">
                                    Out of service
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100/90 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-800 shadow-2xs">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                    Free
                                  </span>
                                )}
                              </div>

                              {/* ── CARD MIDDLE: Patient Details or Real Hospital Bed SVG ── */}
                              <div className="my-2 text-left w-full min-h-[48px] flex flex-col justify-center">
                                {b.patient ? (
                                  <div>
                                    <div className="text-[13.5px] font-bold text-[#111111] truncate">{b.patient.fullName}</div>
                                    <div className="mt-1 font-mono text-[11px] text-[#475569] leading-tight space-y-0.5">
                                      <div>{b.patient.displayId}</div>
                                      <div className="font-semibold text-[#1e293b]">{b.patient.ipNumber}</div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center py-0.5">
                                    <RealHospitalBedSvg
                                      muted={b.status === "MAINTENANCE"}
                                      className="h-12 w-auto max-w-[118px] drop-shadow-2xs transition-transform duration-200 group-hover:scale-105"
                                    />
                                  </div>
                                )}
                              </div>

                              {/* ── CARD BOTTOM: Base charge or Admitted Date ── */}
                              <div className={`flex w-full items-center justify-between border-t pt-2 text-[11px] ${
                                b.patient ? "border-slate-200 text-[#64748b]" : "border-emerald-200/80 text-emerald-800"
                              }`}>
                                {b.patient ? (
                                  <>
                                    <span>Admitted</span>
                                    <span className="font-semibold text-[#111111]">{sinceDay(b.patient.admittedAt)}</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="font-medium text-emerald-700">Base charge</span>
                                    <span className="font-mono font-bold text-emerald-900">₹{money(w.dailyCharge)}/day</span>
                                  </>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </section>

        {/* ───────── RIGHT RAIL ───────── */}
        <div className="space-y-5">
          {/* WHO'S IN THIS BED */}
          {(occupant || occupantLoading) && (
            <section data-rise className="rounded-2xl border border-[#e5e5e5] bg-[#f5f5f4] p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] xl:sticky xl:top-4">
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <h2 className="text-[13px] font-medium text-[#111111]">Who&apos;s in this bed</h2>
                <button
                  onClick={() => setOccupant(null)}
                  aria-label="Close bed details"
                  className="grid h-6 w-6 place-items-center rounded-md text-[#737373] transition-colors hover:bg-white hover:text-[#111111]"
                >
                  ✕
                </button>
              </div>
              <div className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-white">
                {occupantLoading || !occupant ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-[14px] text-[#737373]"><Spinner /> Loading…</div>
                ) : (
                  <>
                    <div className="border-b border-[#e5e5e5] px-4 py-3.5">
                      <p className="text-[15px] font-semibold tracking-tight text-[#111111]">{occupant.admission.patient.fullName}</p>
                      <p className="mt-0.5 text-[12.5px] text-[#737373]">
                        <span className="font-medium text-[#404040] tabular-nums">{occupant.admission.patient.displayId}</span>
                        {occupant.admission.patient.age != null && ` · ${occupant.admission.patient.age}y`}
                        {occupant.admission.patient.gender && ` · ${occupant.admission.patient.gender}`}
                      </p>
                      <a href={`tel:${occupant.admission.patient.phone}`} className="mt-1 inline-block text-[12.5px] font-medium text-[#111111] underline decoration-[#d4d4d4] underline-offset-2 hover:decoration-[#111111] tabular-nums">
                        {occupant.admission.patient.phone}
                      </a>
                    </div>

                    <dl className="divide-y divide-[#f0f0f0] text-[13px]">
                      <Row k="IP number" v={<span className="font-semibold text-[#111111] tabular-nums">{occupant.admission.ipNumber}</span>} />
                      <Row k="Bed" v={<b className="font-medium text-[#111111]">{bedLabel(occupant.admission.wardName, occupant.admission.bedNo)}</b>} />
                      <Row k="Attending" v={<>Dr. {occupant.admission.doctor.name} <span className="text-[#737373]">({occupant.admission.doctor.department})</span></>} />
                      <Row k="Admitted" v={<>{new Date(occupant.admission.admittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · <b className="font-medium text-[#111111]">day {occupant.days}</b></>} />
                    {/* The desk asks the family for money at discharge. It has to
                        know BEFORE it opens its mouth whether this is a bill they
                        owe or one going to an insurer. */}
                    <Row k="Paying" v={
                      occupant.admission.payerType === "INSURANCE" ? (
                        <>
                          <b className="text-[var(--p-blue-deep)]">Insurance</b>
                          <span className="block text-[13px] text-[var(--p-muted)]">
                            {occupant.admission.insurer}
                            {occupant.admission.policyNo && <> · <span className="font-mono">{occupant.admission.policyNo}</span></>}
                          </span>
                        </>
                      ) : <>Self-paying</>
                    } />
                    {occupant.admission.reason && <Row k="Reason" v={occupant.admission.reason} />}
                    {occupant.admission.attendantName && (
                      <Row k="Attendant" v={
                        <>
                          {occupant.admission.attendantName}
                          {occupant.admission.attendantRelation && <span className="text-[#737373]"> ({occupant.admission.attendantRelation})</span>}
                          {occupant.admission.attendantPhone && (
                            <a href={`tel:${occupant.admission.attendantPhone}`} className="ml-1 block text-[12.5px] font-medium text-[#111111] underline decoration-[#d4d4d4] underline-offset-2 tabular-nums">
                              {occupant.admission.attendantPhone}
                            </a>
                          )}
                        </>
                      } />
                    )}
                  </dl>

                  <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] text-[#737373]">Running bill</span>
                      <span className="text-[16px] font-semibold tracking-tight text-[#111111] tabular-nums">₹{money(occupant.grandTotal)}</span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-[#737373] tabular-nums">
                      bed ₹{money(occupant.bedTotal)} ({occupant.days}d)
                      {occupant.charges.length > 0 && <> + {occupant.charges.length} charge{occupant.charges.length === 1 ? "" : "s"} ₹{money(occupant.chargesTotal)}</>}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Link href={`/ipd/${occupant.admission.id}`}
                        className="flex-1 rounded-lg bg-[#111111] px-3 py-2 text-center text-[13px] font-medium text-white transition-colors hover:bg-[#262626]">
                        Open sheet
                      </Link>
                      <Link href="/ipd/inpatients"
                        className="flex-1 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-center text-[13px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
                        Discharge
                      </Link>
                    </div>
                  </div>
                </>
              )}
              </div>
            </section>
          )}

          {/* ADMIT */}
          <section data-rise className="rounded-2xl border border-[#e5e5e5] bg-[#f5f5f4] p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <div className="px-3.5 py-2.5">
              <h2 className="text-[13px] font-medium text-[#111111]">Admit a patient</h2>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[#737373]">
                Move an outpatient into a bed. Only <span className="font-medium text-[#111111]">empty</span> beds are offered.
              </p>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-white">
            {doneIp ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-[#ecfdf5] text-[#059669]"><Icon name="check" size={22} /></span>
                <h3 className="mt-3 text-[17px] font-semibold tracking-tight text-[#111111]">Admitted</h3>
                <p className="mt-1 text-[13px] text-[#737373]">
                  <span className="font-semibold text-[#111111] tabular-nums">{doneIp.ipNumber}</span><br />
                  {bedLabel(doneIp.ward, doneIp.bedNo)}
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-[#737373]">
                  Bed charges start today. Add procedures and prescriptions on the sheet.
                </p>
                <button onClick={() => setDoneIp(null)}
                  className="mt-5 w-full rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#262626]">
                  Admit someone else
                </button>
              </div>
            ) : (
              <div className="space-y-4 p-4">
                {/* patient */}
                <div>
                  <label className={lbl}>Patient<Req /></label>
                  {patient ? (
                    <div className="flex items-center justify-between rounded-xl border border-[#e5e5e5] bg-[#fafafa] px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold text-[#111111]">{patient.fullName}</div>
                        <div className="text-[12px] text-[#737373] tabular-nums">{patient.displayId}</div>
                      </div>
                      <button onClick={() => { setPatient(null); setPq(""); }} className="text-[12.5px] font-medium text-[#111111] underline decoration-[#d4d4d4] underline-offset-2 hover:decoration-[#111111]">Change</button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 focus-within:border-[#111111]">
                        <Icon name="search" size={15} />
                        <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Patient ID, name or phone…" className="w-full bg-transparent text-[13px] text-[#111111] placeholder:text-[#a3a3a3] outline-none" />
                      </div>
                      {pResults.length > 0 && (
                        <div className="mt-1.5 max-h-72 divide-y divide-[#f0f0f0] overflow-y-auto rounded-lg border border-[#e5e5e5] bg-white">
                          {pResults.map((p) => (
                            <button key={p.id} onClick={() => { setPatient(p); setPq(""); }}
                              className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-[#fafafa]">
                              <span className="truncate text-[13.5px] text-[#111111]">{p.fullName}</span>
                              <span className="ml-2 shrink-0 text-[12px] text-[#737373] tabular-nums">{p.displayId}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* ward + bed */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Ward<Req /></label>
                    <select className={fld} value={wardId} onChange={(e) => setWardId(e.target.value)}>
                      {freeWards.length === 0 && <option value="">No beds free</option>}
                      {freeWards.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.beds.length} free)</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Bed<Req /></label>
                    <select className={fld} value={bedId} onChange={(e) => setBedId(e.target.value)} disabled={!selectedWard}>
                      {!selectedWard && <option value="">-</option>}
                      {selectedWard?.beds.map((b) => <option key={b.id} value={b.id}>{bedShort(b.bedNo)}</option>)}
                    </select>
                  </div>
                </div>
                {selectedWard && (
                  <p className="-mt-2 text-[12px] text-[var(--p-muted)]">
                    ₹{money(selectedWard.dailyCharge)}/day{Number(selectedWard.gstRatePct) > 0 && ` + ${selectedWard.gstRatePct}% GST`} - locked at admission.
                  </p>
                )}

                <div>
                  <label className={lbl}>Attending doctor<Req /></label>
                  <select className={fld} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                    <option value="">Choose a doctor…</option>
                    {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} - {d.department}</option>)}
                  </select>
                </div>

                <div>
                  <label className={lbl}>Reason for admission</label>
                  <input className={fld} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Post-op observation…" />
                </div>

                {/* ── WHO IS PAYING ──
                    Asked here because here is the only moment the family, the
                    card and a member of staff are in the same place. Everything
                    downstream - the insurance desk's list, the discharge bill,
                    whether the day close counts this stay as money - reads the
                    answer given in these two clicks. */}
                <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
                  <p className="mb-2 text-[11.5px] font-medium text-[#737373]">Who is paying</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { k: "SELF_PAY", label: "Self-paying", sub: "Pays at the desk" },
                      { k: "INSURANCE", label: "Insurance", sub: "Billed to insurer" },
                    ] as const).map((o) => (
                      <button key={o.k} type="button"
                        onClick={() => setForm({ ...form, payerType: o.k })}
                        className={`payer-opt ${form.payerType === o.k ? "is-on" : ""}`}>
                        <span className="payer-label">{o.label}</span>
                        <span className="payer-sub">{o.sub}</span>
                      </button>
                    ))}
                  </div>

                  {form.payerType === "INSURANCE" && (
                    <div className="mt-3 space-y-2">
                      {/* THE INSURER IS THE ONLY THING ASKED FOR HERE.
                          Policy number and member ID used to sit alongside it and
                          the policy number was required, which stopped an
                          admission at the one moment nobody can afford to be
                          stopped: a patient is being wheeled in and the card is
                          in a bag somebody left at home. The insurance desk asks
                          for both anyway when it works the claim, and asks the
                          family directly - so collecting them at the bedside
                          bought nothing and blocked the bed. */}
                      <div>
                        <label className={lbl} htmlFor="admit-insurer">Insurer / TPA<Req /></label>
                        <input id="admit-insurer" className={fld} list="ins-list" value={form.insurer}
                          onChange={(e) => setForm({ ...form, insurer: e.target.value })}
                          placeholder="Star Health, Care, CGHS…" />
                        <datalist id="ins-list">{insurerOptions.map((x) => <option key={x} value={x} />)}</datalist>
                      </div>
                      <p className="text-[12px] leading-relaxed text-[#737373]">
                        This puts the stay on the <b className="font-medium text-[#111111]">insurance desk&apos;s</b> list straight away,
                        so the pre-authorization gets raised while the patient is still here.
                        They collect the policy and member number with the claim.
                      </p>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
                  <p className="mb-2 text-[11.5px] font-medium text-[#737373]">Caring person</p>
                  <div className="space-y-2">
                    <input className={fld} value={form.attendantName} onChange={(e) => setForm({ ...form, attendantName: e.target.value })} placeholder="Name" />
                    <div className="grid grid-cols-2 gap-2">
                      <input className={fld} value={form.attendantPhone} inputMode="numeric" onChange={(e) => setForm({ ...form, attendantPhone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="Phone" />
                      <input className={fld} value={form.attendantRelation} onChange={(e) => setForm({ ...form, attendantRelation: e.target.value })} placeholder="Relation" />
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-[#737373]">Who the hospital rings at 3am.</p>
                </div>

                <button onClick={admit} disabled={busy || !patient || !bedId || !doctorId || !insuranceReady}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#262626] disabled:opacity-40">
                  {busy ? <><Spinner /> Admitting…</> : <><Icon name="bed" size={15} /> Admit &amp; assign bed</>}
                </button>
                {!patient && <p className="text-center text-[12px] text-[#737373]">Find the patient first.</p>}
                {patient && !insuranceReady && (
                  <p className="text-center text-[12px] text-[#737373]">
                    Name the insurer, or switch to self-paying.
                  </p>
                )}
              </div>
            )}
            </div>
          </section>
        </div>
      </div>
    </PortalScroll>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5">
      <dt className="shrink-0 text-[12.5px] text-[#737373]">{k}</dt>
      <dd className="text-right text-[13px] text-[#111111]">{v}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ink" | "ok" | "busy" | "off" }) {
  const c = { ink: "#111111", ok: "#059669", busy: "#111111", off: "#737373" }[tone];
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="text-[12px] font-medium text-[#737373]">{label}</div>
      <div className="mt-1 text-[24px] font-semibold tracking-tight tabular-nums" style={{ color: c }}>{value}</div>
    </div>
  );
}

const CSS = `
.bed-card { position: relative; display: flex; flex-direction: column; align-items: stretch; justify-content: space-between;
  min-height: 136px; border-radius: 14px; border: 1px solid #e5e5e5; background: #ffffff;
  padding: 12px 14px; text-align: left; transition: all .14s ease; }
.bed-card:not(:disabled):hover { border-color: #111111; box-shadow: 0 4px 14px rgba(0,0,0,.05); }
.bed-no { font-size: 13px; font-weight: 700; color: #111111; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.bed-who { font-size: 13.5px; font-weight: 700; color: #111111; }

/* ── VACANT / AVAILABLE BED (Fresh Soft Mint/Emerald Shade) ── */
.bed-available {
  border-color: #86efac;
  background: linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(16, 185, 129, 0.06);
}
.bed-available:hover {
  border-color: #10b981;
  background: #ecfdf5;
  box-shadow: 0 6px 18px rgba(16, 185, 129, 0.14);
}

/* ── OCCUPIED / ADMITTED BED (Calm Crisp Sky/Blue Shade) ── */
.bed-occupied {
  border-color: #93c5fd;
  background: linear-gradient(180deg, #ffffff 0%, #eff6ff 100%);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(59, 130, 246, 0.06);
}
.bed-occupied:hover {
  border-color: #2563eb;
  background: #f0f7ff;
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.14);
}

.bed-maintenance { border-style: dashed; border-color: #e5e5e5; background: #fafafa; cursor: not-allowed; opacity: .6; }

/* Selected in the admit panel */
.is-picked { border: 2px solid #111111 !important; background: #ffffff !important; box-shadow: none !important; }
.bed-tick { display: grid; place-items: center;
  height: 18px; width: 18px; border-radius: 999px; background: #111111; color: #ffffff; }

/* Whose details are open on the right */
.is-shown { border: 2px solid #111111 !important; background: #ffffff !important; box-shadow: none !important; }

/* Who is paying - crisp studio selection pills */
.payer-opt { display: flex; flex-direction: column; gap: 1px; border-radius: 10px;
  border: 1px solid #e5e5e5; background: #ffffff; padding: 8px 10px; text-align: left;
  transition: border-color .14s ease, background .14s ease, box-shadow .14s ease; }
.payer-opt:hover { border-color: #a3a3a3; }
.payer-label { font-size: 13px; font-weight: 500; color: #404040; }
.payer-sub { font-size: 11px; color: #737373; }
.payer-opt.is-on { border-color: #111111; background: #f5f5f4;
  box-shadow: 0 0 0 1px #111111; }
.payer-opt.is-on .payer-label { font-weight: 600; color: #111111; }

@media (prefers-reduced-motion: reduce) { .bed-card:hover { transform: none; } }
`;
