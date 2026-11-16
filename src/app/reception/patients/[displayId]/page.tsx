"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PrimaryButton, Pill, statusTone } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { DiscountInput, PaymentSection, type Tender } from "@/components/portal/ui/bill-fields";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { roundBill } from "@/lib/money-round";
import { RepeatConfirmDialog } from "@/components/portal/repeat-confirm-dialog";
import { repeatBlock, type RepeatBlock } from "@/lib/repeat-guard";
import { bedLabel } from "@/lib/beds";

interface Patient {
  id: string; displayId: string; fullName: string; firstName: string; middleName?: string | null; lastName: string | null;
  dob: string | null; age: number | null; gender: string | null; bloodGroup: string | null; maritalStatus?: string | null;
  phone: string; alternatePhone?: string | null; email?: string | null;
  address?: string | null; city: string | null; state?: string | null; country?: string | null; postalCode?: string | null;
  occupation?: string | null; nationality?: string | null; preferredLanguage?: string | null;
  isVip?: boolean; remarks?: string | null; createdAt: string;
}

interface Appt {
  id: string; opNumber: string; visitDate: string; time: string; status: string;
  doctorName: string; department: string; price: string;
}

interface Rx {
  id: string; fileUrl: string; fileName: string; title: string | null; createdAt: string;
  appointmentId: string | null;
  appointment?: { opNumber: string; visitDate: string; doctorName: string } | null;
}

interface Invoice {
  id: string; receiptNo: string; source: string; status: string; totalAmount: string;
  amountPaid: string; createdAt: string; billDate: string | null; payer?: string;
}

interface AdmissionSummary {
  id: string;
  ipNumber: string;
  status: "ADMITTED" | "DISCHARGED" | "CANCELLED";
  admittedAt: string;
  dischargedAt: string | null;
  wardName: string;
  bedNo: string;
  doctorName: string;
  department: string;
  reason: string | null;
  payerType: string;
  insurer: string | null;
  policyNo: string | null;
  totalDays: number;
  invoicesCount: number;
  totalInvoiced: string;
  legs?: { id: string; wardName: string; bedNo: string; rate: number; days: number }[];
}

const BLOODS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const LABEL: Record<string, string> = { BOOKED: "Booked", CHECKED_IN: "Checked-in", COMPLETED: "Completed", CANCELLED: "Cancelled" };

const money = (n: number | string) =>
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PatientDetailPage() {
  const { displayId } = useParams<{ displayId: string }>();
  const router = useRouter();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [rx, setRx] = useState<Rx[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [activeAdmission, setActiveAdmission] = useState<AdmissionSummary | null>(null);
  const [admissions, setAdmissions] = useState<AdmissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<{ block: RepeatBlock; message: string } | null>(null);

  // Tab navigation
  const [activeTab, setActiveTab] = useState<"overview" | "ipd" | "bills" | "prescriptions" | "visits">("overview");

  // Invoices category filter
  const [billFilter, setBillFilter] = useState<"ALL" | "IPD" | "LAB" | "PHARMACY" | "CONSULTATION">("ALL");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Record<string, string | boolean>>({});

  // Billing dialog
  const [billOpen, setBillOpen] = useState(false);
  const [billDesc, setBillDesc] = useState("Doctor consultation");
  const [billAmt, setBillAmt] = useState("");
  const [billGst, setBillGst] = useState("0");
  const [billDisc, setBillDisc] = useState(0);
  const [payNow, setPayNow] = useState(true);
  const [payments, setPayments] = useState<Tender[]>([]);
  const [payValid, setPayValid] = useState(true);
  const [billing, setBilling] = useState(false);

  const billTotal = roundBill(Math.max(0, Number(billAmt || 0) - billDisc) * (1 + (Number(billGst) || 0) / 100));

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [p, a, r, inv, admData] = await Promise.all([
        api.get<{ patient: Patient }>(`/reception/patients/${displayId}`),
        api.get<{ appointments: Appt[] }>(`/reception/patients/${displayId}/appointments`),
        api.get<{ prescriptions: Rx[] }>(`/reception/patients/${displayId}/prescriptions`),
        api.get<{ invoices: Invoice[] }>(`/reception/patients/${displayId}/invoices`),
        api.get<{ admission: AdmissionSummary | null; admissions: AdmissionSummary[] }>(`/reception/patients/${displayId}/admission`).catch(() => ({ admission: null, admissions: [] })),
      ]);
      setPatient(p.patient);
      setAppts(a.appointments);
      setRx(r.prescriptions);
      setInvoices(inv.invoices);
      setActiveAdmission(admData.admission);
      const allAdms = admData.admissions ?? (admData.admission ? [admData.admission] : []);
      setAdmissions(allAdms);
      seed(p.patient);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load this patient.");
    } finally {
      setLoading(false);
    }
  }, [displayId]);

  useEffect(() => { load(); }, [load]);

  function seed(p: Patient) {
    setF({
      firstName: p.firstName ?? "", middleName: p.middleName ?? "", lastName: p.lastName ?? "",
      dob: p.dob ?? "", age: p.age != null ? String(p.age) : "", gender: p.gender ?? "",
      bloodGroup: p.bloodGroup ?? "", maritalStatus: p.maritalStatus ?? "",
      phone: p.phone ?? "", alternatePhone: p.alternatePhone ?? "", email: p.email ?? "",
      address: p.address ?? "", city: p.city ?? "", state: p.state ?? "", country: p.country ?? "",
      postalCode: p.postalCode ?? "", occupation: p.occupation ?? "", nationality: p.nationality ?? "",
      preferredLanguage: p.preferredLanguage ?? "", isVip: p.isVip ?? false, remarks: p.remarks ?? "",
    });
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = { ...f };
      body.age = f.age ? Number(f.age) : undefined;
      for (const k of Object.keys(body)) if (body[k] === "") body[k] = undefined;
      await api.patch(`/reception/patients/${displayId}`, body);
      setEditing(false); await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function generateBill(confirmRepeat = false) {
    if (!patient || !billAmt) return;
    setBilling(true); setError(null);
    try {
      const amount = Number(billAmt);
      await api.post("/billing/consultation", {
        patientId: patient.id,
        description: billDesc,
        amount,
        gstRatePct: Number(billGst) || 0,
        discountAmount: billDisc || undefined,
        payments: payNow && payments.length ? payments : undefined,
        confirmRepeat: confirmRepeat || undefined,
      });
      setRepeat(null);
      setBillOpen(false); setBillAmt(""); setBillDisc(0); setPayments([]); await load();
    } catch (e) {
      const again = repeatBlock(e);
      if (again) { setRepeat({ block: again, message: (e as Error).message }); return; }
      setError(e instanceof ApiClientError ? e.message : "Could not generate the bill.");
    } finally {
      setBilling(false);
    }
  }

  // Financial aggregates
  const totalBilled = useMemo(
    () => invoices.reduce((s, i) => s + (i.status === "CANCELLED" ? 0 : Number(i.totalAmount || 0)), 0),
    [invoices]
  );
  const totalPaid = useMemo(
    () => invoices.reduce((s, i) => s + (i.status === "CANCELLED" ? 0 : Number(i.amountPaid || 0)), 0),
    [invoices]
  );
  const totalDue = Math.max(0, totalBilled - totalPaid);

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    if (billFilter === "ALL") return invoices;
    if (billFilter === "IPD") return invoices.filter((i) => i.source === "IPD");
    if (billFilter === "LAB") return invoices.filter((i) => i.source === "LAB");
    if (billFilter === "PHARMACY") return invoices.filter((i) => i.source === "PHARMACY");
    return invoices.filter((i) => !["IPD", "LAB", "PHARMACY"].includes(i.source));
  }, [invoices, billFilter]);

  const fld = "w-full rounded-xl border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] outline-none transition-all focus:border-[#111111] focus:ring-1 focus:ring-[#111111]";
  const set = (k: string) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[14px] text-[#737373]">
        <Spinner /> Loading patient profile…
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-[#e5e5e5] bg-white p-10 text-center shadow-sm">
        <p className="text-[14px] text-[#737373]">{error ?? "Patient not found."}</p>
        <button
          onClick={() => router.push("/patients")}
          className="mt-4 rounded-xl border border-[#e5e5e5] px-4 py-2 text-[13px] font-medium text-[#111111] hover:border-[#111111]"
        >
          Back to Patients
        </button>
      </div>
    );
  }

  return (
    <PortalScroll>
      {/* ── TOP HERO CARD ─────────────────────────────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <button
              onClick={() => router.push("/patients")}
              aria-label="Back"
              className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl border border-[#e5e5e5] text-[#525252] transition-colors hover:border-[#111111] hover:text-[#111111]"
            >
              ←
            </button>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1b4332] text-[18px] font-bold text-white shadow-sm">
              {patient.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-[22px] font-bold text-[#111111] leading-tight">{patient.fullName}</h1>
                {patient.isVip && (
                  <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-amber-900">
                    VIP
                  </span>
                )}
                {activeAdmission && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-300 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                    Currently Admitted · {activeAdmission.wardName} {activeAdmission.bedNo}
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12.5px] text-[#737373]">
                <span className="font-mono font-semibold text-[#111111] bg-[#f5f5f4] px-2 py-0.5 rounded-md border border-[#e5e5e5]">
                  {patient.displayId}
                </span>
                <span>·</span>
                <span>{cap(patient.gender)}</span>
                {patient.age != null && (
                  <>
                    <span>·</span>
                    <span>{patient.age} yrs</span>
                  </>
                )}
                {patient.bloodGroup && (
                  <>
                    <span>·</span>
                    <span className="font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                      {patient.bloodGroup}
                    </span>
                  </>
                )}
                <span>·</span>
                <span className="font-mono">{patient.phone}</span>
                {patient.city && (
                  <>
                    <span>·</span>
                    <span>{patient.city}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {activeAdmission ? (
              <Link
                href={`/reception/ipd/${activeAdmission.id}`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#111111] px-4 py-2 text-[13px] font-semibold text-white hover:bg-black transition-colors shadow-xs"
              >
                <Icon name="bed" size={14} /> Open IP Sheet
              </Link>
            ) : (
              <a
                href={`/ipd?patient=${patient.displayId}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#111111] bg-[#111111] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-black transition-colors shadow-xs"
              >
                <Icon name="bed" size={14} /> Admit to IPD
              </a>
            )}
            <a
              href={`/book?patient=${patient.displayId}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#111111] hover:border-[#111111] transition-colors shadow-2xs"
            >
              <Icon name="calendar" size={14} /> Book Visit
            </a>
            <a
              href={`/prescriptions?patient=${patient.displayId}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#111111] hover:border-[#111111] transition-colors shadow-2xs"
            >
              <Icon name="file" size={14} /> Upload Rx
            </a>
            <a
              href={`/print/opd/blank?patient=${patient.displayId}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Print blank OPD sheet with patient header"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#111111] hover:border-[#111111] transition-colors shadow-2xs"
            >
              <Icon name="printer" size={14} /> Blank OPD
            </a>
            <button
              onClick={() => setBillOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#111111] hover:border-[#111111] transition-colors shadow-2xs"
            >
              <Icon name="rupee" size={14} /> Generate Bill
            </button>
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#525252] hover:border-[#111111] hover:text-[#111111] transition-colors shadow-2xs"
              >
                <Icon name="settings" size={14} /> Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(false); seed(patient); }}
                  className="rounded-xl border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#737373] hover:text-[#111111]"
                >
                  Cancel
                </button>
                <PrimaryButton onClick={save} disabled={saving}>
                  {saving ? <><Spinner /> Saving…</> : <><Icon name="check" size={14} /> Save</>}
                </PrimaryButton>
              </div>
            )}
          </div>
        </div>

        {/* ── METRIC STATS TILES ────────────────────────────────────────────── */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* IP Stays */}
          <div
            onClick={() => setActiveTab("ipd")}
            className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
              activeTab === "ipd" ? "border-[#111111] bg-[#fafafa]" : "border-[#e5e5e5] bg-[#fafafa] hover:border-[#d4d4d4]"
            }`}
          >
            <div className="flex items-center justify-between text-[#737373]">
              <span className="text-[11px] font-bold uppercase tracking-wider">IP Stays</span>
              <Icon name="bed" size={14} />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[20px] font-bold text-[#111111]">{admissions.length}</span>
              <span className="text-[11.5px] text-[#737373]">
                {activeAdmission ? "1 Active now" : "All discharged"}
              </span>
            </div>
          </div>

          {/* OPD Visits */}
          <div
            onClick={() => setActiveTab("visits")}
            className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
              activeTab === "visits" ? "border-[#111111] bg-[#fafafa]" : "border-[#e5e5e5] bg-[#fafafa] hover:border-[#d4d4d4]"
            }`}
          >
            <div className="flex items-center justify-between text-[#737373]">
              <span className="text-[11px] font-bold uppercase tracking-wider">OPD Visits</span>
              <Icon name="calendar" size={14} />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[20px] font-bold text-[#111111]">{appts.length}</span>
              <span className="text-[11.5px] text-[#737373]">consultations</span>
            </div>
          </div>

          {/* Prescriptions */}
          <div
            onClick={() => setActiveTab("prescriptions")}
            className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
              activeTab === "prescriptions" ? "border-[#111111] bg-[#fafafa]" : "border-[#e5e5e5] bg-[#fafafa] hover:border-[#d4d4d4]"
            }`}
          >
            <div className="flex items-center justify-between text-[#737373]">
              <span className="text-[11px] font-bold uppercase tracking-wider">Prescriptions</span>
              <Icon name="file" size={14} />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[20px] font-bold text-[#111111]">{rx.length}</span>
              <span className="text-[11.5px] text-[#737373]">recorded</span>
            </div>
          </div>

          {/* Invoices & Dues */}
          <div
            onClick={() => setActiveTab("bills")}
            className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
              activeTab === "bills" ? "border-[#111111] bg-[#fafafa]" : "border-[#e5e5e5] bg-[#fafafa] hover:border-[#d4d4d4]"
            }`}
          >
            <div className="flex items-center justify-between text-[#737373]">
              <span className="text-[11px] font-bold uppercase tracking-wider">Billing Total</span>
              <Icon name="receipt" size={14} />
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-mono text-[18px] font-bold text-[#111111]">₹{money(totalBilled)}</span>
              {totalDue > 0 ? (
                <span className="rounded bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[10.5px] font-bold text-rose-700">
                  ₹{money(totalDue)} Due
                </span>
              ) : (
                <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10.5px] font-bold text-emerald-700">
                  Paid
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-800">
          <Icon name="alert" size={16} /> <span>{error}</span>
        </div>
      )}

      {/* ── TAB BAR ───────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center gap-1.5 border-b border-[#e5e5e5] pb-2">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all ${
            activeTab === "overview"
              ? "bg-[#111111] text-white shadow-xs font-semibold"
              : "text-[#525252] hover:bg-[#f5f5f4] hover:text-[#111111]"
          }`}
        >
          <Icon name="users" size={14} /> Patient Overview
        </button>

        <button
          onClick={() => setActiveTab("ipd")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all ${
            activeTab === "ipd"
              ? "bg-[#111111] text-white shadow-xs font-semibold"
              : "text-[#525252] hover:bg-[#f5f5f4] hover:text-[#111111]"
          }`}
        >
          <Icon name="bed" size={14} />
          <span>Inpatient Stays</span>
          <span className={`rounded-full px-1.5 py-0.2 text-[10.5px] font-bold ${activeTab === "ipd" ? "bg-white text-[#111111]" : "bg-[#e5e5e5] text-[#525252]"}`}>
            {admissions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("bills")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all ${
            activeTab === "bills"
              ? "bg-[#111111] text-white shadow-xs font-semibold"
              : "text-[#525252] hover:bg-[#f5f5f4] hover:text-[#111111]"
          }`}
        >
          <Icon name="receipt" size={14} />
          <span>Bills &amp; Invoices</span>
          <span className={`rounded-full px-1.5 py-0.2 text-[10.5px] font-bold ${activeTab === "bills" ? "bg-white text-[#111111]" : "bg-[#e5e5e5] text-[#525252]"}`}>
            {invoices.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("prescriptions")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all ${
            activeTab === "prescriptions"
              ? "bg-[#111111] text-white shadow-xs font-semibold"
              : "text-[#525252] hover:bg-[#f5f5f4] hover:text-[#111111]"
          }`}
        >
          <Icon name="file" size={14} />
          <span>Prescriptions</span>
          <span className={`rounded-full px-1.5 py-0.2 text-[10.5px] font-bold ${activeTab === "prescriptions" ? "bg-white text-[#111111]" : "bg-[#e5e5e5] text-[#525252]"}`}>
            {rx.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("visits")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all ${
            activeTab === "visits"
              ? "bg-[#111111] text-white shadow-xs font-semibold"
              : "text-[#525252] hover:bg-[#f5f5f4] hover:text-[#111111]"
          }`}
        >
          <Icon name="calendar" size={14} />
          <span>Visits</span>
          <span className={`rounded-full px-1.5 py-0.2 text-[10.5px] font-bold ${activeTab === "visits" ? "bg-white text-[#111111]" : "bg-[#e5e5e5] text-[#525252]"}`}>
            {appts.length}
          </span>
        </button>
      </div>

      {/* ── TAB 1: OVERVIEW & DEMOGRAPHICS ─────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-2xl border border-[#e5e5e5] bg-white overflow-hidden shadow-sm">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[#111111]">Demographics &amp; Patient Record</h3>
                <p className="text-[12px] text-[#737373]">Personal contact details, registration metadata and emergency info</p>
              </div>
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-[12px] font-medium text-[#111111] hover:border-[#111111] transition-colors"
                >
                  Edit details
                </button>
              )}
            </div>

            {!editing ? (
              <div className="grid grid-cols-2 gap-px bg-[#f0f0f0]">
                <D k="Full name" v={patient.fullName} />
                <D k="UHID (Hospital ID)" v={patient.displayId} mono />
                <D k="Primary phone" v={patient.phone} mono />
                <D k="Alternate phone" v={patient.alternatePhone ?? "-"} mono />
                <D k="Age / Gender" v={`${patient.age != null ? `${patient.age} yrs` : "-"} · ${cap(patient.gender)}`} />
                <D k="Blood group" v={patient.bloodGroup ?? "-"} highlight={!!patient.bloodGroup} />
                <D k="Date of birth" v={patient.dob ?? "-"} />
                <D k="Marital status" v={cap(patient.maritalStatus ?? null)} />
                <D k="Email" v={patient.email ?? "-"} />
                <D k="Address" v={patient.address ?? "-"} />
                <D k="City / District" v={patient.city ?? "-"} />
                <D k="State / PIN" v={`${patient.state ?? "-"} · ${patient.postalCode ?? "-"}`} />
                <D k="Occupation" v={patient.occupation ?? "-"} />
                <D k="Language" v={patient.preferredLanguage ?? "-"} />
                <D k="Registered on" v={new Date(patient.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} />
                <D k="Remarks" v={patient.remarks ?? "-"} />
              </div>
            ) : (
              <div className="grid gap-4 p-6 sm:grid-cols-2">
                <Field label="First name"><input className={fld} value={f.firstName as string} onChange={(e) => set("firstName")(e.target.value)} /></Field>
                <Field label="Last name"><input className={fld} value={f.lastName as string} onChange={(e) => set("lastName")(e.target.value)} /></Field>
                <Field label="Date of birth"><input type="date" className={fld} value={f.dob as string} onChange={(e) => set("dob")(e.target.value)} /></Field>
                <Field label="Age"><input className={fld} value={f.age as string} onChange={(e) => set("age")(e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
                <Field label="Gender">
                  <select className={fld} value={f.gender as string} onChange={(e) => set("gender")(e.target.value)}>
                    <option value="">-</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
                  </select>
                </Field>
                <Field label="Blood group">
                  <select className={fld} value={f.bloodGroup as string} onChange={(e) => set("bloodGroup")(e.target.value)}>
                    <option value="">-</option>{BLOODS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </Field>
                <Field label="Marital status">
                  <select className={fld} value={f.maritalStatus as string} onChange={(e) => set("maritalStatus")(e.target.value)}>
                    <option value="">-</option><option value="SINGLE">Single</option><option value="MARRIED">Married</option><option value="DIVORCED">Divorced</option><option value="WIDOWED">Widowed</option><option value="OTHER">Other</option>
                  </select>
                </Field>
                <Field label="Phone"><input className={fld} value={f.phone as string} onChange={(e) => set("phone")(e.target.value.replace(/\D/g, "").slice(0, 10))} /></Field>
                <Field label="Alternate phone"><input className={fld} value={f.alternatePhone as string} onChange={(e) => set("alternatePhone")(e.target.value.replace(/\D/g, "").slice(0, 10))} /></Field>
                <Field label="Email"><input className={fld} value={f.email as string} onChange={(e) => set("email")(e.target.value)} /></Field>
                <Field label="Address" span><input className={fld} value={f.address as string} onChange={(e) => set("address")(e.target.value)} /></Field>
                <Field label="City"><input className={fld} value={f.city as string} onChange={(e) => set("city")(e.target.value)} /></Field>
                <Field label="State"><input className={fld} value={f.state as string} onChange={(e) => set("state")(e.target.value)} /></Field>
                <Field label="PIN code"><input className={fld} value={f.postalCode as string} onChange={(e) => set("postalCode")(e.target.value.replace(/\D/g, "").slice(0, 10))} /></Field>
                <Field label="Occupation"><input className={fld} value={f.occupation as string} onChange={(e) => set("occupation")(e.target.value)} /></Field>
                <Field label="Language"><input className={fld} value={f.preferredLanguage as string} onChange={(e) => set("preferredLanguage")(e.target.value)} /></Field>
                <Field label="Remarks" span><input className={fld} value={f.remarks as string} onChange={(e) => set("remarks")(e.target.value)} /></Field>
                <label className="col-span-2 flex items-center gap-2 text-[14px] text-[#404040]">
                  <input type="checkbox" checked={f.isVip as boolean} onChange={(e) => set("isVip")(e.target.checked)} className="h-4 w-4 accent-[#111111]" /> VIP Patient
                </label>
              </div>
            )}
          </section>

          {/* Quick Summary Side Panels */}
          <div className="space-y-6">
            {/* Active Stay Alert if admitted */}
            {activeAdmission && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-xs">
                <div className="flex items-center gap-2 text-emerald-900">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <Icon name="bed" size={13} />
                  </span>
                  <h4 className="text-[14px] font-bold">Active Inpatient Stay</h4>
                </div>
                <div className="mt-3 space-y-1.5 text-[13px] text-emerald-900">
                  <p><b>IP Number:</b> {activeAdmission.ipNumber}</p>
                  <p><b>Ward &amp; Bed:</b> {activeAdmission.wardName} · {activeAdmission.bedNo}</p>
                  <p><b>Attending:</b> {activeAdmission.doctorName} ({activeAdmission.department})</p>
                  <p><b>Admitted:</b> {new Date(activeAdmission.admittedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <div className="mt-4 flex gap-2">
                  <Link
                    href={`/reception/ipd/${activeAdmission.id}`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-800 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-emerald-900 transition-colors"
                  >
                    Manage IP Sheet →
                  </Link>
                </div>
              </div>
            )}

            {/* Recent Billing Snapshot */}
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
                <h4 className="text-[14px] font-semibold text-[#111111]">Billing Overview</h4>
                <button onClick={() => setActiveTab("bills")} className="text-[12px] font-medium text-[#111111] hover:underline">
                  View all bills →
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-[#737373]">Total Billed</span>
                  <span className="font-mono font-bold text-[#111111]">₹{money(totalBilled)}</span>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-[#737373]">Total Paid</span>
                  <span className="font-mono font-bold text-emerald-700">₹{money(totalPaid)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-[#f0f0f0] pt-2 text-[13.5px]">
                  <span className="font-semibold text-[#111111]">Current Due Balance</span>
                  <span className={`font-mono font-bold ${totalDue > 0 ? "text-rose-700" : "text-[#111111]"}`}>
                    ₹{money(totalDue)}
                  </span>
                </div>
              </div>
            </div>

            {/* Latest Visits */}
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
                <h4 className="text-[14px] font-semibold text-[#111111]">Recent Activity</h4>
                <button onClick={() => setActiveTab("visits")} className="text-[12px] font-medium text-[#111111] hover:underline">
                  All visits →
                </button>
              </div>
              <div className="mt-3 divide-y divide-[#f5f5f4]">
                {appts.slice(0, 3).map((a) => (
                  <div key={a.id} className="py-2.5 text-[12.5px] flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-[#111111]">{a.doctorName}</div>
                      <div className="text-[11.5px] text-[#737373]">{a.visitDate} · {a.department}</div>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-[#111111] font-semibold">₹{a.price}</span>
                      <div className="text-[11px] text-[#737373]">{LABEL[a.status] ?? a.status}</div>
                    </div>
                  </div>
                ))}
                {appts.length === 0 && (
                  <p className="py-4 text-center text-[12.5px] text-[#737373]">No visits recorded yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: INPATIENT STAYS (IP STAYS) ─────────────────────────────── */}
      {activeTab === "ipd" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
            <div>
              <h3 className="text-[16px] font-bold text-[#111111]">Inpatient Admissions &amp; Hospital Stays</h3>
              <p className="mt-0.5 text-[12.5px] text-[#737373]">
                Total {admissions.length} stay{admissions.length === 1 ? "" : "s"} on file · Wards, bed allocations, stay breakdown and discharge invoices
              </p>
            </div>
            {!activeAdmission && (
              <a
                href={`/ipd?patient=${patient.displayId}`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#111111] px-4 py-2 text-[13px] font-semibold text-white hover:bg-black transition-colors shadow-xs"
              >
                <Icon name="bed" size={14} /> New Admission
              </a>
            )}
          </div>

          {admissions.length === 0 ? (
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-12 text-center shadow-sm">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f5f4] text-[#737373]">
                <Icon name="bed" size={20} />
              </span>
              <h4 className="mt-3 text-[15px] font-semibold text-[#111111]">No Inpatient Stays Yet</h4>
              <p className="mt-1 text-[13px] text-[#737373]">This patient has not been admitted to any ward or ICU.</p>
              <a
                href={`/ipd?patient=${patient.displayId}`}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-[#111111] bg-white px-4 py-2 text-[13px] font-semibold text-[#111111] hover:bg-[#fafafa]"
              >
                Admit this patient
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              {admissions.map((adm, idx) => {
                const isActive = adm.status === "ADMITTED";
                return (
                  <div
                    key={adm.id}
                    className={`rounded-2xl border bg-white p-5 shadow-sm transition-all ${
                      isActive ? "border-emerald-300 ring-1 ring-emerald-200" : "border-[#e5e5e5]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#f0f0f0] pb-4">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold ${isActive ? "bg-emerald-600 text-white" : "bg-[#f5f5f4] text-[#404040] border border-[#e5e5e5]"}`}>
                          <Icon name="bed" size={16} />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[14px] font-bold text-[#111111]">{adm.ipNumber}</span>
                            {isActive ? (
                              <span className="rounded-full bg-emerald-50 border border-emerald-300 px-2 py-0.5 text-[10.5px] font-bold text-emerald-800 uppercase tracking-wider">
                                Live Inpatient
                              </span>
                            ) : (
                              <span className="rounded-full bg-[#f5f5f4] border border-[#e5e5e5] px-2 py-0.5 text-[10.5px] font-semibold text-[#525252] uppercase tracking-wider">
                                Discharged
                              </span>
                            )}
                            <span className="rounded-full bg-[#f5f5f4] px-2 py-0.5 text-[10.5px] font-medium text-[#737373]">
                              {adm.payerType === "INSURANCE" ? "Cashless Insurance" : "Self-Paying"}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[12.5px] text-[#737373]">
                            <b>{adm.wardName}</b> · Bed {adm.bedNo} · Doctor: {adm.doctorName} ({adm.department})
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/reception/ipd/${adm.id}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#111111] px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-black transition-colors"
                        >
                          <Icon name="bed" size={13} /> {isActive ? "Manage Stay Sheet" : "View IP Sheet"}
                        </Link>
                        <a
                          href={`/print/bills/${adm.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium text-[#111111] hover:border-[#111111] transition-colors"
                        >
                          <Icon name="receipt" size={12} /> Print All Bills
                        </a>
                        <a
                          href={`/print/tab/${adm.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium text-[#111111] hover:border-[#111111] transition-colors"
                        >
                          <Icon name="printer" size={12} /> Print Tab
                        </a>
                        {adm.payerType === "SELF_PAY" && (
                          <a
                            href={`/print/services-bill/${adm.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium text-[#111111] hover:border-[#111111] transition-colors"
                          >
                            <Icon name="receipt" size={12} /> Services Bill
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Stay chronology details */}
                    <div className="mt-4 grid gap-4 sm:grid-cols-3 text-[12.5px]">
                      <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
                        <span className="block text-[11px] font-bold uppercase tracking-wider text-[#737373]">Admission Period</span>
                        <div className="mt-1 font-medium text-[#111111]">
                          {new Date(adm.admittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                        <div className="mt-0.5 text-[#737373]">
                          {adm.dischargedAt
                            ? `Discharged: ${new Date(adm.dischargedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                            : "Currently Admitted"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
                        <span className="block text-[11px] font-bold uppercase tracking-wider text-[#737373]">Stay Duration</span>
                        <div className="mt-1 font-bold text-[#111111] text-[15px]">
                          {adm.totalDays} day{adm.totalDays === 1 ? "" : "s"}
                        </div>
                        <div className="mt-0.5 text-[#737373]">
                          {adm.legs && adm.legs.length > 1 ? `${adm.legs.length} Ward Transfers` : "Single ward stay"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
                        <span className="block text-[11px] font-bold uppercase tracking-wider text-[#737373]">Invoiced Total</span>
                        <div className="mt-1 font-mono font-bold text-[#111111] text-[15px]">
                          ₹{money(adm.totalInvoiced)}
                        </div>
                        <div className="mt-0.5 text-[#737373]">{adm.invoicesCount} invoice(s) raised</div>
                      </div>
                    </div>

                    {/* Ward breakdown legs if transferred */}
                    {adm.legs && adm.legs.length > 1 && (
                      <div className="mt-3 rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
                        <span className="block text-[11px] font-bold uppercase tracking-wider text-[#737373] mb-2">Ward Transfer Breakdown</span>
                        <div className="flex flex-wrap gap-2">
                          {adm.legs.map((leg, lIdx) => (
                            <span key={leg.id || lIdx} className="rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1 text-[12px] text-[#111111]">
                              <b>{leg.wardName}</b> (Bed {leg.bedNo}) · {leg.days}d × ₹{money(leg.rate)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {adm.reason && (
                      <p className="mt-3 text-[12px] text-[#737373]">
                        <b>Admission Reason:</b> {adm.reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: BILLS & SEPARATE BILLS ─────────────────────────────────── */}
      {activeTab === "bills" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
            <div>
              <h3 className="text-[16px] font-bold text-[#111111]">Patient Invoices &amp; Receipts</h3>
              <p className="mt-0.5 text-[12.5px] text-[#737373]">
                Total {invoices.length} bill{invoices.length === 1 ? "" : "s"} raised across IPD, Laboratory, Pharmacy &amp; Consultation
              </p>
            </div>
            <button
              onClick={() => setBillOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#111111] px-4 py-2 text-[13px] font-semibold text-white hover:bg-black transition-colors shadow-xs"
            >
              <Icon name="rupee" size={14} /> New Bill
            </button>
          </div>

          {/* Categorized Filter Pills */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: "ALL", label: "All Bills", count: invoices.length },
              { id: "IPD", label: "IPD / Ward Invoices", count: invoices.filter((i) => i.source === "IPD").length },
              { id: "LAB", label: "Laboratory Bills", count: invoices.filter((i) => i.source === "LAB").length },
              { id: "PHARMACY", label: "Pharmacy Dispenses", count: invoices.filter((i) => i.source === "PHARMACY").length },
              { id: "CONSULTATION", label: "OPD Consultations", count: invoices.filter((i) => !["IPD", "LAB", "PHARMACY"].includes(i.source)).length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setBillFilter(tab.id as typeof billFilter)}
                className={`rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
                  billFilter === tab.id
                    ? "bg-[#111111] text-white font-semibold shadow-2xs"
                    : "border border-[#e5e5e5] bg-white text-[#525252] hover:border-[#111111] hover:text-[#111111]"
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-12 text-center shadow-sm">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f5f4] text-[#737373]">
                <Icon name="receipt" size={20} />
              </span>
              <h4 className="mt-3 text-[15px] font-semibold text-[#111111]">No Invoices in this Category</h4>
              <p className="mt-1 text-[13px] text-[#737373]">No bills matching the selected filter.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#e5e5e5] bg-white overflow-hidden shadow-sm">
              <div className="divide-y divide-[#f0f0f0]">
                {filteredInvoices.map((inv) => {
                  const paid = Number(inv.amountPaid || 0);
                  const total = Number(inv.totalAmount || 0);
                  const isCancelled = inv.status === "CANCELLED";
                  const isPaid = inv.status === "PAID" || (!isCancelled && paid >= total);

                  const sourceStyle =
                    inv.source === "IPD"
                      ? "bg-blue-50 text-blue-800 border-blue-200"
                      : inv.source === "LAB"
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : inv.source === "PHARMACY"
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : "bg-[#f5f5f4] text-[#404040] border-[#e5e5e5]";

                  return (
                    <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-[#fafafa]">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`font-mono text-[13.5px] font-bold ${isCancelled ? "line-through text-[#a3a3a3]" : "text-[#111111]"}`}>
                            {inv.receiptNo}
                          </span>
                          <span className={`rounded-md border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${sourceStyle}`}>
                            {inv.source}
                          </span>
                          {isCancelled && (
                            <span className="rounded-md bg-[#f5f5f4] border border-[#e5e5e5] px-2 py-0.5 text-[10.5px] font-bold uppercase text-[#737373]">
                              Cancelled
                            </span>
                          )}
                          {!isCancelled && isPaid && (
                            <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
                              Paid
                            </span>
                          )}
                          {!isCancelled && !isPaid && (
                            <span className="rounded-md bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10.5px] font-bold text-rose-700">
                              Due
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#737373]">
                          <span>Date: {new Date(inv.billDate ?? inv.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                          <span>·</span>
                          <span>Paid: ₹{money(paid)}</span>
                          {total > paid && !isCancelled && (
                            <>
                              <span>·</span>
                              <span className="text-rose-700 font-medium">Balance: ₹{money(total - paid)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="block font-mono text-[15px] font-bold text-[#111111]">
                            ₹{money(total)}
                          </span>
                        </div>
                        <a
                          href={`/print/invoice/${inv.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium text-[#111111] hover:border-[#111111] transition-colors"
                        >
                          <Icon name="printer" size={13} /> Print
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 4: PRESCRIPTIONS ──────────────────────────────────────────── */}
      {activeTab === "prescriptions" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
            <div>
              <h3 className="text-[16px] font-bold text-[#111111]">Prescriptions &amp; Clinical Scans</h3>
              <p className="mt-0.5 text-[12.5px] text-[#737373]">
                Uploaded doctor prescriptions, OPD medication slips and handwritten scans
              </p>
            </div>
            <a
              href={`/prescriptions?patient=${patient.displayId}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#111111] px-4 py-2 text-[13px] font-semibold text-white hover:bg-black transition-colors shadow-xs"
            >
              <Icon name="file" size={14} /> Upload Prescription
            </a>
          </div>

          {rx.length === 0 ? (
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-12 text-center shadow-sm">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f5f4] text-[#737373]">
                <Icon name="file" size={20} />
              </span>
              <h4 className="mt-3 text-[15px] font-semibold text-[#111111]">No Prescriptions on File</h4>
              <p className="mt-1 text-[13px] text-[#737373]">Upload a photo or scan of the patient's prescription paper.</p>
              <a
                href={`/prescriptions?patient=${patient.displayId}`}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-[#111111] bg-white px-4 py-2 text-[13px] font-semibold text-[#111111] hover:bg-[#fafafa]"
              >
                Upload now
              </a>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {rx.map((r) => (
                <div key={r.id} className="rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="text-[14px] font-semibold text-[#111111] truncate">{r.title || r.fileName || "Prescription Document"}</h4>
                      <span className="text-[11.5px] text-[#737373]">
                        {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>

                    {r.appointment && (
                      <p className="mt-1 text-[12px] text-[#737373]">
                        Doctor: <b>{r.appointment.doctorName}</b> · OP: {r.appointment.opNumber}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#f0f0f0] pt-3">
                    {r.fileUrl && (
                      <a
                        href={r.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium text-[#111111] hover:border-[#111111] transition-colors"
                      >
                        <Icon name="file" size={13} /> View Scan
                      </a>
                    )}
                    {r.appointmentId && (
                      <a
                        href={`/print/opd/${r.appointmentId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#111111] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-black transition-colors"
                      >
                        <Icon name="printer" size={13} /> Print OPD Sheet
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 5: OPD VISITS ─────────────────────────────────────────────── */}
      {activeTab === "visits" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
            <div>
              <h3 className="text-[16px] font-bold text-[#111111]">Outpatient Consultations &amp; Visits</h3>
              <p className="mt-0.5 text-[12.5px] text-[#737373]">
                Total {appts.length} visit{appts.length === 1 ? "" : "s"} · Doctor consultations, case sheets and appointment tokens
              </p>
            </div>
            <a
              href={`/book?patient=${patient.displayId}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#111111] px-4 py-2 text-[13px] font-semibold text-white hover:bg-black transition-colors shadow-xs"
            >
              <Icon name="calendar" size={14} /> Book New Visit
            </a>
          </div>

          {appts.length === 0 ? (
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-12 text-center shadow-sm">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f5f4] text-[#737373]">
                <Icon name="calendar" size={20} />
              </span>
              <h4 className="mt-3 text-[15px] font-semibold text-[#111111]">No Visits Recorded Yet</h4>
              <p className="mt-1 text-[13px] text-[#737373]">Book an appointment for consultation.</p>
              <a
                href={`/book?patient=${patient.displayId}`}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-[#111111] bg-white px-4 py-2 text-[13px] font-semibold text-[#111111] hover:bg-[#fafafa]"
              >
                Book visit now
              </a>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#e5e5e5] bg-white overflow-hidden shadow-sm">
              <div className="divide-y divide-[#f0f0f0]">
                {appts.map((a) => (
                  <div key={a.opNumber} className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-[#fafafa]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[14px] text-[#111111]">{a.doctorName}</span>
                        <span className="text-[12px] text-[#737373]">({a.department})</span>
                        <Pill tone={statusTone(LABEL[a.status] ?? a.status)}>{LABEL[a.status] ?? a.status}</Pill>
                      </div>
                      <div className="mt-1 text-[12px] text-[#737373]">
                        OP: <span className="font-mono font-semibold text-[#111111]">{a.opNumber}</span> · Date: {a.visitDate} · Time: {a.time}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[14px] font-bold text-[#111111]">₹{a.price}</span>
                      <a
                        href={`/print/opd/${a.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium text-[#111111] hover:border-[#111111] transition-colors"
                      >
                        <Icon name="printer" size={13} /> Case Sheet
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── GENERATE BILL MODAL ───────────────────────────────────────────── */}
      {billOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[#111111]">Generate Bill</h3>
                <p className="text-[12px] text-[#737373]">{patient.fullName} · {patient.displayId}</p>
              </div>
              <button
                onClick={() => setBillOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#737373] hover:bg-[#f5f5f4] hover:text-[#111111]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 p-6">
              <Field label="Description">
                <input className={fld} value={billDesc} onChange={(e) => setBillDesc(e.target.value)} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (₹)" required>
                  <input
                    className={fld}
                    value={billAmt}
                    onChange={(e) => setBillAmt(e.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="decimal"
                    placeholder="700"
                    autoFocus
                  />
                </Field>
                <Field label="GST %">
                  <input
                    className={fld}
                    value={billGst}
                    onChange={(e) => setBillGst(e.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="decimal"
                  />
                </Field>
              </div>

              <DiscountInput subtotal={Number(billAmt || 0)} accent="teal" onChange={(d) => setBillDisc(d.amount)} />

              <div className="flex justify-between border-t border-[#e5e5e5] pt-3 text-[14px]">
                <span className="font-semibold text-[#111111]">Total Payable</span>
                <span className="font-mono text-[16px] font-bold text-[#111111]">₹{billTotal.toFixed(2)}</span>
              </div>

              <label className="flex items-center gap-2 text-[13.5px] text-[#404040]">
                <input
                  type="checkbox"
                  checked={payNow}
                  onChange={(e) => setPayNow(e.target.checked)}
                  className="h-4 w-4 accent-[#111111]"
                />
                Collect payment now at counter
              </label>

              {payNow && (
                <PaymentSection
                  total={billTotal}
                  accent="teal"
                  onChange={(r) => { setPayments(r.payments); setPayValid(r.valid); }}
                />
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-[#e5e5e5] bg-[#fafafa] px-6 py-4">
              <button
                onClick={() => setBillOpen(false)}
                className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-[13px] font-medium text-[#525252] hover:border-[#111111] hover:text-[#111111]"
              >
                Cancel
              </button>
              <button
                onClick={() => generateBill()}
                disabled={billing || !billAmt || (payNow && !payValid)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#111111] px-5 py-2 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-40 shadow-xs"
              >
                {billing ? <><Spinner /> Generating…</> : <><Icon name="receipt" size={14} /> Generate &amp; Issue</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {repeat && (
        <RepeatConfirmDialog
          block={repeat.block}
          message={repeat.message}
          busy={billing}
          onConfirm={() => { void generateBill(true); }}
          onClose={() => setRepeat(null)}
        />
      )}
    </PortalScroll>
  );
}

function cap(v: string | null) {
  return v ? v.charAt(0) + v.slice(1).toLowerCase() : "-";
}

function D({ k, v, mono, highlight }: { k: string; v: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="bg-white px-6 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[#737373]">{k}</p>
      <p className={`mt-0.5 text-[13.5px] text-[#111111] ${mono ? "font-mono font-medium text-[13px]" : ""} ${highlight ? "font-bold text-rose-700" : ""}`}>
        {v}
      </p>
    </div>
  );
}
