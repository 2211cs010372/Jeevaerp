"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { DischargeSummaryForm } from "@/components/portal/ipd/discharge-summary-form";
import { api, ApiClientError } from "@/lib/api-client";
import { StatusPill } from "@/components/portal/insurance/claims-board";
import { EditBillDialog, useBillEditing } from "@/components/portal/billing/edit-bill-dialog";
import { bedLabel } from "@/lib/beds";

/**
 * THE ADMITTED PATIENT'S BILL, as the insurance desk needs it.
 *
 * The reason this screen exists rather than the desk just reading the ward's
 * copy: THE SAME TREATMENT IS NOT THE SAME MONEY TO EVERY PAYER. A dressing is
 * one rate at the counter, another under CGHS, another under a corporate policy.
 * Preparing a claim means restating the stay in the tariff that policy actually
 * settles against - repricing lines, and adding items the ward never billed
 * separately because a self-paying family would not have been charged for them.
 *
 * So editing is the point of the page, not a convenience on it. Two guardrails
 * carried over from the service, because both matter more here than anywhere:
 *
 *   Every reprice writes a note onto the stay with the old figure and the new
 *   one. "The bill was changed after the treatment" is the first thing an
 *   insurer asks, and the answer has to be on the record rather than in
 *   somebody's memory.
 *
 *   Pharmacy lines cannot be touched. They are stock that physically left a
 *   shelf at a price the pharmacy recorded; repricing one here would quietly
 *   decouple the bill from the dispense.
 */

interface Charge {
  id: string; category: string; description: string;
  qty: number; unitPrice: string; gstRatePct: string; amount: string;
  addedBy: string; createdAt: string; fromPharmacy: boolean;
}
interface Sheet {
  admission: {
    id: string; ipNumber: string; status: string; admittedAt: string; reason: string | null;
    wardName: string; bedNo: string; dailyCharge: string;
    payerType: string; insurer: string | null; policyNo: string | null; memberId: string | null;
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
    doctor: { name: string; department: string };
  };
  days: number;
  bedTotal: string; nurseTotal: string; chargesTotal: string; grandTotal: string;
  advanceTotal: string; balance: string;
  charges: Charge[];
  /** Pharmacy and lab bills going to the insurer on this stay. Nobody collects
   *  these at a counter, so they are counted here rather than chased. */
  claimBills: { id: string; receiptNo: string; source: string; total: string; createdAt: string }[];
  claimBillsTotal: string;
  /** grandTotal + claimBillsTotal - everything on the claim. */
  claimTotal: string;
}

const CATEGORIES = [
  { k: "PROCEDURE", label: "Procedure" },
  { k: "DOCTOR_VISIT", label: "Doctor visit" },
  { k: "NURSING", label: "Nursing" },
  { k: "OXYGEN", label: "Oxygen" },
  { k: "INVESTIGATION", label: "Investigation" },
  { k: "CONSUMABLE", label: "Consumable" },
  { k: "OTHER", label: "Other" },
] as const;
const CAT_LABEL: Record<string, string> = {
  ...Object.fromEntries(CATEGORIES.map((c) => [c.k, c.label])),
  PHARMACY: "Pharmacy",
};

/** Every bill on the stay, oldest first. See stayBills. */
interface StayBill {
  id: string; receiptNo: string; source: string; payer: string; status: string;
  total: string; paid: string; createdAt: string; outsideStay: boolean;
  lines: number; summary: string;
}
interface StayBills {
  admittedAt: string;
  dischargedAt: string | null;
  bills: StayBill[];
  outsideCount: number;
  /** Same patient, NOT on this stay - OP consultations, counter pharmacy sales,
   *  OP labs, earlier admissions. Printable here; never part of this claim. */
  otherBills: StayBill[];
}

/** Where the stay stands with its insurer. See stayClaims. */
interface StayClaims {
  claims: {
    id: string; claimNo: string; type: string; stage: string; status: string;
    claimedAmount: string; approvedAmount: string | null; settledAmount: string | null;
    insurerRef: string | null; submittedAt: string | null; decisionAt: string | null;
  }[];
  insuranceBills: { id: string; receiptNo: string; source: string; total: string; paid: string }[];
  insuranceBillsTotal: string;
  needsDecision: boolean;
}

interface Service {
  id: string; name: string; group: string; category: string;
  price: string; gstRatePct: string; perDay: boolean;
}
const GROUP_LABEL: Record<string, string> = {
  IP_CHARGE: "Inpatient charges",
  SURGERY_OPEN: "Surgery - open",
  SURGERY_LAPAROSCOPIC: "Surgery - laparoscopic",
  OTHER: "Other",
};

/** Some doctors are stored with the honorific on the name and some are not. */
const withDr = (name: string) => (/^dr\.?\s/i.test(name.trim()) ? name.trim() : `Dr. ${name.trim()}`);
const money = (v: string | number) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const money2 = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Which counter raised a bill, in the words the desk uses. An assessor reading
 *  an attachment list should not have to decode "CONSULTATION". */
const billSource = (s: string) =>
  s === "PHARMACY" ? "Pharmacy"
  : s === "LAB" ? "Lab"
  : s === "IPD" ? "Stay"
  : s === "CONSULTATION" ? "OP consult"
  : s === "OTHER" ? "Other"
  : s;
const blankLine = { category: "PROCEDURE", description: "", qty: "1", unitPrice: "", gstRatePct: "0" };

export default function InsuranceAdmissionPage() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [s, setS] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ ...blankLine });
  const [editId, setEditId] = useState<string | null>(null);
  const [e, setE] = useState({ ...blankLine });

  const [services, setServices] = useState<Service[]>([]);
  /** Where the stay stands with its insurer - and whether a decision is owed. */
  const [sc, setSc] = useState<StayClaims | null>(null);
  const [reverting, setReverting] = useState(false);
  const [revertReason, setRevertReason] = useState("");
  /** Every bill on the stay, in date order. Loaded on demand - most visits to
   *  this page never open it. */
  const [showBills, setShowBills] = useState(false);
  /** The shared discharge summary - the same record reception edits. */
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [bills, setBills] = useState<StayBills | null>(null);

  // Correcting a bill outright, not just its date. Off unless an admin has
  // switched it on - see HospitalConfig.billEditingEnabled. Enforced server-side.
  const { canEdit } = useBillEditing();
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadBills = useCallback(async () => {
    try { setBills(await api.get<StayBills>(`/insurance/admissions/${admissionId}/bills`)); }
    catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't load the bills."); }
  }, [admissionId]);

  async function redate(invoiceId: string, date: string) {
    if (!date) return;
    try {
      const r = await api.patch<{ receiptNo: string }>(`/insurance/admissions/${admissionId}/bills`, { invoiceId, date });
      setFlash(`${r.receiptNo} re-dated.`);
      await Promise.all([loadBills(), load()]);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't change the date.");
      // Put the control back to what the server actually holds.
      await loadBills();
    }
  }

  const load = useCallback(async () => {
    try {
      const [sheet, claims] = await Promise.all([
        api.get<Sheet>(`/ipd/admissions/${admissionId}/sheet`),
        api.get<StayClaims>(`/insurance/admissions/${admissionId}/claims`),
      ]);
      setS(sheet); setSc(claims); setError(null);
    }
    catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't load the stay."); }
    finally { setLoading(false); }
  }, [admissionId]);

  /** The insurer said no. Move the bills onto the patient so they can be collected. */
  async function billThePatient() {
    if (revertReason.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await api.post<{ moved: { receiptNo: string }[]; movedTotal: string; skipped: { receiptNo: string; why: string }[] }>(
        `/insurance/admissions/${admissionId}/claims`,
        { reason: revertReason.trim() }
      );
      setReverting(false); setRevertReason("");
      setFlash(
        `₹${money2(r.movedTotal)} across ${r.moved.length} bill${r.moved.length === 1 ? "" : "s"} is now the patient's - collect it on reception's Billing screen.` +
        (r.skipped.length ? ` ${r.skipped.length} left alone (money already taken).` : "")
      );
      await load();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't move the bills."); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [load]);

  // The hospital's published rate card. Loaded once - a desk adding four lines
  // should not re-fetch the wall board four times.
  useEffect(() => {
    api.get<{ services: Service[] }>("/ipd/services").then((r) => setServices(r.services)).catch(() => {});
  }, []);

  /**
   * Picking a catalogued service fills the line at the COUNTER rate and the
   * right category, then leaves it editable - which is the whole workflow here.
   * The board's price is what a walk-in pays; the claim goes out at whatever the
   * policy settles, and the desk edits down to that in the same box.
   */
  function pickService(id: string) {
    const svc = services.find((x) => x.id === id);
    if (!svc) return;
    setF((prev) => ({
      ...prev,
      description: svc.name,
      category: svc.category,
      unitPrice: String(Number(svc.price)),
      gstRatePct: String(Number(svc.gstRatePct)),
      // A per-day charge defaults to the length of stay so far. Still editable:
      // nobody is on oxygen for every night they are in the bed.
      qty: svc.perDay && s ? String(s.days) : "1",
    }));
  }

  const closed = s ? s.admission.status !== "ADMITTED" : false;

  async function addLine() {
    if (!f.description.trim() || Number(f.unitPrice) < 0) return;
    setBusy(true);
    try {
      await api.post(`/ipd/admissions/${admissionId}/charges`, {
        category: f.category, description: f.description.trim(),
        qty: Number(f.qty) || 1, unitPrice: Number(f.unitPrice) || 0,
        gstRatePct: Number(f.gstRatePct) || 0,
      });
      setF({ ...blankLine }); setAdding(false); setFlash("Line added to the bill.");
      await load();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't add the line."); }
    finally { setBusy(false); }
  }

  function startEdit(c: Charge) {
    setEditId(c.id);
    setE({
      category: c.category, description: c.description, qty: String(c.qty),
      unitPrice: String(Number(c.unitPrice)), gstRatePct: String(Number(c.gstRatePct)),
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setBusy(true);
    try {
      await api.patch(`/ipd/charges/${editId}`, {
        category: e.category, description: e.description.trim(),
        qty: Number(e.qty) || 1, unitPrice: Number(e.unitPrice) || 0,
        gstRatePct: Number(e.gstRatePct) || 0,
      });
      setEditId(null); setFlash("Line repriced. The change is on the stay's record.");
      await load();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't save the change."); }
    finally { setBusy(false); }
  }

  async function removeLine(c: Charge) {
    setBusy(true);
    try {
      await api.del(`/ipd/charges/${c.id}`);
      setFlash("Line removed."); await load();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't remove the line."); }
    finally { setBusy(false); }
  }

  if (loading) return <PortalScroll><div className="flex items-center justify-center gap-2 py-24 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div></PortalScroll>;
  if (!s) return <PortalScroll><div className="surface px-6 py-16 text-center text-[14px] text-[var(--p-rose)]">{error ?? "Not found."}</div></PortalScroll>;

  const a = s.admission;
  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-2.5 py-1.5 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

  return (
    <PortalScroll>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/pending" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-blue)]">
          <Icon name="chevron" size={14} className="rotate-180" /> To raise
        </Link>
        <div className="flex items-center gap-2">
          {/* Every bill on the stay, in date order, dates editable. An assessor
              reads a claim chronologically and strikes off anything dated
              outside the admission window - see stayBills. */}
          <button onClick={() => { setShowBills((v) => !v); if (!bills) loadBills(); }}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-[13px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="receipt" size={15} /> All bills
            {(bills?.outsideCount ?? 0) > 0 && (
              <span className="rounded-full bg-[var(--p-rose-soft)] px-1.5 py-0.5 text-[10.5px] font-bold text-[var(--p-rose)]">
                {bills!.outsideCount}
              </span>
            )}
          </button>
          {/* THE SAME RECORD RECEPTION WRITES. Not a copy and not an
              insurance-specific version - whichever desk opens it first creates
              it, and both edit that one row. */}
          <button onClick={() => setSummaryOpen(true)}
            title="Write or edit this stay's discharge summary. Reception edits the same record."
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-[13px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="file" size={15} /> Discharge summary
          </button>
          <a href={`/print/bill/${a.id}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]">
            <Icon name="printer" size={15} /> Detailed bill · print / PDF
          </a>
        </div>
      </div>

      {/* ── ALL BILLS ON THE STAY ── */}
      {showBills && (
        <section data-rise className="surface mb-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] px-5 py-3.5">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">Every bill on this stay</h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--p-muted)]">
                Oldest first. Admitted {bills ? day(bills.admittedAt) : "—"}
                {bills?.dischargedAt ? `, discharged ${day(bills.dischargedAt)}` : ", still in a bed"}.
                A bill dated outside that window gets queried by the insurer.
              </p>
            </div>
            <button onClick={() => setShowBills(false)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
          </div>

          {!bills ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
          ) : bills.bills.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-[var(--p-muted)]">No bills raised on this stay yet.</p>
          ) : (
            <div className="divide-y divide-[var(--p-border)]">
              {bills.bills.map((b) => (
                <div key={b.id} className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 ${b.outsideStay ? "bg-[var(--p-rose-soft)]/50" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12.5px] font-semibold text-[var(--p-ink)]">{b.receiptNo}</span>
                      <span className="rounded bg-[var(--p-border)]/40 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-muted)]">
                        {billSource(b.source)}
                      </span>
                      {b.payer === "INSURANCE"
                        ? <span className="rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-blue-deep)]">On the claim</span>
                        : <span className="rounded bg-[var(--p-amber-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[#8a6414]">Patient</span>}
                      {b.outsideStay && (
                        <span className="rounded bg-[var(--p-rose-soft)] px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-[var(--p-rose)]">
                          Outside the stay
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-[var(--p-muted)]">{b.summary} · {b.lines} line{b.lines === 1 ? "" : "s"}</div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-[13.5px] font-semibold text-[var(--p-ink)]">₹{money2(b.total)}</span>
                    {/* The date IS the control, and it is no longer locked by a
                        payment. It writes billDate - the date the sheet PRINTS -
                        so correcting it moves nothing in the day close and
                        nothing in the GST return. An IRN still locks it: that
                        date is filed with the government. */}
                    <input type="date" className={`${fld} w-[150px]`} value={b.createdAt.slice(0, 10)}
                      max={new Date().toISOString().slice(0, 10)}
                      title="The date this bill prints as. The day's collection still counts it when it was raised."
                      onChange={(ev) => redate(b.id, ev.target.value)} />
                    {canEdit && b.status !== "CANCELLED" && (
                      <button onClick={() => setEditingId(b.id)}
                        title={Number(b.paid) > 0
                          ? `Correct this bill — ₹${money2(b.paid)} already collected`
                          : "Correct the lines or the amount on this bill"}
                        className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                        Edit
                      </button>
                    )}
                    <a href={`/print/invoice/${b.id}`} target="_blank" rel="noreferrer"
                      className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                      Bill
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── THE SAME PATIENT, OFF THIS STAY ──
              Their OP consultations, counter pharmacy sales, OP labs and any
              earlier admission. Printable from here so the claim file can be
              assembled in one place - but visibly NOT part of the claim, and
              with no date control, because re-dating a bill that has nothing to
              do with this stay has no honest use. */}
          {bills && bills.otherBills.length > 0 && (
            <>
              <div className="border-y border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-2.5">
                <h3 className="text-[13px] font-semibold text-[var(--p-ink)]">
                  Not on this stay · {bills.otherBills.length}
                </h3>
                <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                  The same patient&apos;s outpatient bills, counter sales and earlier admissions.
                  Print any of them for the file - none of them are on this claim.
                </p>
              </div>
              <div className="divide-y divide-[var(--p-border)]">
                {bills.otherBills.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12.5px] font-semibold text-[var(--p-ink)]">{b.receiptNo}</span>
                        <span className="rounded bg-[var(--p-border)]/40 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-muted)]">
                          {billSource(b.source)}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--p-muted)]">{day(b.createdAt)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-[var(--p-muted)]">{b.summary} · {b.lines} line{b.lines === 1 ? "" : "s"}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-[13.5px] font-semibold text-[var(--p-ink)]">₹{money2(b.total)}</span>
                      {canEdit && b.status !== "CANCELLED" && (
                        <button onClick={() => setEditingId(b.id)}
                          title={Number(b.paid) > 0
                            ? `Correct this bill — ₹${money2(b.paid)} already collected`
                            : "Correct the lines or the amount on this bill"}
                          className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                          Edit
                        </button>
                      )}
                      <a href={`/print/invoice/${b.id}`} target="_blank" rel="noreferrer"
                        className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                        Bill
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── WHO, AND UNDER WHAT POLICY ── */}
      <div data-rise className="surface dotgrid mb-5 flex flex-wrap items-start justify-between gap-5 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">{a.patient.fullName}</h1>
          <p className="mt-1 text-[13.5px] text-[var(--p-muted)]">
            <span className="font-mono">{a.patient.displayId}</span>
            {a.patient.age != null && ` · ${a.patient.age}y`}
            {a.patient.gender && ` · ${a.patient.gender}`}
            {" · "}<span className="font-mono font-semibold text-[var(--p-blue-deep)]">{a.ipNumber}</span>
          </p>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">
            {bedLabel(a.wardName, a.bedNo)} · day {s.days} · {withDr(a.doctor.name)} ({a.doctor.department})
          </p>
        </div>
        <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3 text-[13px]">
          {a.payerType === "INSURANCE" ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Billed to</div>
              <div className="mt-0.5 text-[14px] font-semibold text-[var(--p-ink)]">{a.insurer}</div>
              <div className="font-mono text-[12px] text-[var(--p-muted)]">
                {a.policyNo}{a.memberId && ` · ${a.memberId}`}
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Billed to</div>
              <div className="mt-0.5 text-[14px] font-semibold text-[var(--p-ink)]">Self-paying</div>
              <div className="text-[12px] text-[var(--p-muted)]">No policy on this stay</div>
            </>
          )}
        </div>
      </div>

      {flash && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[13.5px] font-medium text-[var(--p-cyan-deep)]">
          <span className="flex items-center gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button onClick={() => setFlash(null)}>✕</button>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13.5px] text-[var(--p-rose)]">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ── WHERE IT STANDS WITH THE INSURER ──
          On the bill's own screen, because "has this been approved" and "who am
          I billing" are the same question and they get asked while looking at
          the bill. */}
      {sc && sc.claims.length > 0 && (
        <section data-rise className="surface mb-5 overflow-hidden">
          <div className="border-b border-[var(--p-border)] px-5 py-3.5">
            <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">With the insurer</h2>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {sc.claims.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-[var(--p-ink)]">{c.claimNo}</span>
                    <StatusPill s={c.status} />
                    <span className="text-[11.5px] text-[var(--p-muted)]">
                      {c.stage === "PRE_AUTH" ? "Pre-auth" : "Final"} · {c.type === "CASHLESS" ? "Cashless" : "Reimbursement"}
                    </span>
                  </div>
                  {c.insurerRef && (
                    <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">Insurer ref <span className="font-mono">{c.insurerRef}</span></div>
                  )}
                </div>
                <div className="text-right text-[12.5px]">
                  <div className="font-mono font-semibold text-[var(--p-ink)]">₹{money2(c.claimedAmount)} claimed</div>
                  {c.approvedAmount != null && (
                    <div className="text-[var(--p-muted)]">₹{money2(c.approvedAmount)} approved</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── THE INSURER SAID NO, OR NOT ALL OF IT ──
              Until this existed there was no way back: a bill marked INSURANCE
              is kept out of every dues list and every collection total, so a
              refused claim left the money sitting against an insurer who had
              already declined it. Nobody was going to collect it, and no screen
              said so. */}
          {sc.needsDecision && (
            <div className="border-t border-[var(--p-border)] bg-[var(--p-rose-soft)] px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13px] font-bold text-[var(--p-rose)]">
                    <Icon name="alert" size={15} /> The insurer has not covered this in full
                  </p>
                  <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-[var(--p-rose)]">
                    ₹{money2(sc.insuranceBillsTotal)} across {sc.insuranceBills.length} bill
                    {sc.insuranceBills.length === 1 ? "" : "s"} is still pointed at them. While it stays there
                    nobody can collect it - it is out of every dues list by design. Re-submit the claim, or
                    bill the patient instead.
                  </p>
                </div>
                {!reverting && (
                  <button onClick={() => setReverting(true)}
                    className="shrink-0 rounded-lg border border-[var(--p-rose)]/50 bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--p-rose)] hover:bg-[var(--p-rose-soft)]">
                    Bill the patient instead
                  </button>
                )}
              </div>

              {reverting && (
                <div className="mt-3 space-y-2 rounded-lg border border-[var(--p-rose)]/30 bg-white p-3">
                  <p className="text-[12.5px] leading-relaxed text-[var(--p-text)]">
                    These bills become the patient&apos;s and appear on reception&apos;s Billing screen to be
                    collected. A bill with money already taken against it is left alone.
                  </p>
                  <input className={fld} autoFocus value={revertReason}
                    onChange={(ev) => setRevertReason(ev.target.value)}
                    placeholder="Why - e.g. Star Health rejected, ref STR/2026/8841" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setReverting(false); setRevertReason(""); }}
                      className="rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] text-[var(--p-text)]">Cancel</button>
                    <button onClick={billThePatient} disabled={busy || revertReason.trim().length < 3}
                      className="rounded-lg bg-[var(--p-rose)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                      {busy ? "Moving…" : `Bill the patient ₹${money2(sc.insuranceBillsTotal)}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* ── FIXED LINES ── the bed and the nursing fee are computed from the
              stay, not stored as rows, so they are shown but not editable here.
              Changing a ward rate mid-stay is a wards-and-beds decision, not a
              claim decision. */}
          <section data-rise className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-3.5">
              <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">From the stay</h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--p-muted)]">Computed from the bed and the days. Not editable here.</p>
            </div>
            <div className="divide-y divide-[var(--p-border)] text-[13.5px]">
              <Fixed k={bedLabel(a.wardName, a.bedNo)} sub={`₹${money(a.dailyCharge)}/day × ${s.days}`} v={s.bedTotal} />
              <Fixed k="Nursing care" sub={`${s.days} day${s.days === 1 ? "" : "s"}`} v={s.nurseTotal} />
            </div>
          </section>

          {/* ── EDITABLE LINES ── */}
          <section data-rise className="surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] px-5 py-3.5">
              <div>
                <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">Charges on this stay</h2>
                <p className="mt-0.5 text-[12.5px] text-[var(--p-muted)]">
                  Reprice a line to the policy&apos;s tariff, or add one the ward didn&apos;t bill.
                </p>
              </div>
              {!closed && (
                <button onClick={() => { setAdding((v) => !v); setEditId(null); }}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3.5 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                  <Icon name="plus" size={14} /> Add line
                </button>
              )}
            </div>

            {closed && (
              <p className="border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-5 py-2.5 text-[12.5px] text-[#8a5a14]">
                This stay is discharged and its bill is closed. Lines can no longer be changed.
              </p>
            )}

            {adding && !closed && (
              <div className="border-b border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-4">
                {services.length > 0 && (
                  <div className="mb-2.5">
                    <label className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                      Pick from the rate card
                    </label>
                    <select className={fld} value="" onChange={(ev) => pickService(ev.target.value)}>
                      <option value="">Choose a service, or type one below…</option>
                      {Object.keys(GROUP_LABEL)
                        .filter((g) => services.some((x) => x.group === g))
                        .map((g) => (
                          <optgroup key={g} label={GROUP_LABEL[g]}>
                            {services.filter((x) => x.group === g).map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name} — ₹{money(x.price)}{x.perDay ? " / day" : ""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                    </select>
                    <p className="mt-1 text-[12px] text-[var(--p-muted)]">
                      Fills the counter rate. Change it to whatever this policy actually settles.
                    </p>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-[1fr_120px_100px_90px_80px]">
                <input className={fld} autoFocus value={f.description} placeholder="Description (e.g. OT charges)"
                  onChange={(ev) => setF({ ...f, description: ev.target.value })} />
                <select className={fld} value={f.category} onChange={(ev) => setF({ ...f, category: ev.target.value })}>
                  {CATEGORIES.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
                </select>
                <input className={fld} inputMode="numeric" value={f.unitPrice} placeholder="Rate ₹"
                  onChange={(ev) => setF({ ...f, unitPrice: ev.target.value.replace(/[^\d.]/g, "") })} />
                <input className={fld} inputMode="numeric" value={f.qty} placeholder="Qty"
                  onChange={(ev) => setF({ ...f, qty: ev.target.value.replace(/\D/g, "") })} />
                <button onClick={addLine} disabled={busy || !f.description.trim()}
                  className="rounded-lg bg-[var(--p-blue)] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                  {busy ? "…" : "Add"}
                </button>
                </div>
              </div>
            )}

            {s.charges.length === 0 && s.claimBills.length === 0 ? (
              <p className="px-5 py-12 text-center text-[13px] text-[var(--p-muted)]">
                Nothing on the tab yet beyond the bed and nursing.
              </p>
            ) : (
              <div className="divide-y divide-[var(--p-border)]">
                {/* PHARMACY AND LAB SIT ON THE TAB TOO, on a claim.
                    They are other counters' invoices, not charge lines - which
                    is exactly why they used to be missing from this list, and
                    why a desk reading it saw a stay with no medicines on it.
                    Shown here so the running tab is the whole claim, and shown
                    FIRST because they are the part somebody has to go and look
                    at another document to check.
                    Not editable: repricing a dispense here would decouple the
                    bill from the stock that left the shelf. Change it on the
                    invoice it came from. */}
                {s.claimBills.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 bg-[var(--p-blue-soft)]/40 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-medium text-[var(--p-ink)]">
                          {b.source === "PHARMACY" ? "Pharmacy dispense" : b.source === "LAB" ? "Laboratory tests" : "Other charges"}
                        </span>
                        <span className="rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-blue-deep)]">
                          On the claim
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                        Bill <span className="font-mono">{b.receiptNo}</span> · billed to the insurer, not collected at a counter
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money2(b.total)}</span>
                  </div>
                ))}
                {s.charges.map((c) =>
                  editId === c.id ? (
                    <div key={c.id} className="grid gap-2 bg-[var(--p-blue-soft)] px-5 py-4 sm:grid-cols-[1fr_120px_100px_90px_140px]">
                      <input className={fld} value={e.description} onChange={(ev) => setE({ ...e, description: ev.target.value })} />
                      <select className={fld} value={e.category} onChange={(ev) => setE({ ...e, category: ev.target.value })}>
                        {CATEGORIES.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
                      </select>
                      <input className={fld} inputMode="numeric" value={e.unitPrice}
                        onChange={(ev) => setE({ ...e, unitPrice: ev.target.value.replace(/[^\d.]/g, "") })} />
                      <input className={fld} inputMode="numeric" value={e.qty}
                        onChange={(ev) => setE({ ...e, qty: ev.target.value.replace(/\D/g, "") })} />
                      <div className="flex gap-2">
                        <button onClick={saveEdit} disabled={busy}
                          className="flex-1 rounded-lg bg-[var(--p-blue)] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                          {busy ? "…" : "Save"}
                        </button>
                        <button onClick={() => setEditId(null)}
                          className="rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] text-[var(--p-text)]">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13.5px] font-medium text-[var(--p-ink)]">{c.description}</span>
                          <span className="rounded bg-[var(--p-border)]/40 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-muted)]">
                            {CAT_LABEL[c.category] ?? c.category}
                          </span>
                          {c.fromPharmacy && (
                            <span className="rounded bg-[var(--p-amber-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[#8a5a14]">
                              From pharmacy
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                          ₹{money2(c.unitPrice)} × {c.qty} · added by {c.addedBy}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money2(c.amount)}</span>
                        {!closed && !c.fromPharmacy && (
                          <div className="flex gap-1.5">
                            <button onClick={() => { startEdit(c); setAdding(false); }}
                              className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                              Reprice
                            </button>
                            <button onClick={() => removeLine(c)} disabled={busy}
                              className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </section>
        </div>

        {/* ── WHAT THE CLAIM IS WORTH ── */}
        <div>
          <section data-rise className="surface overflow-hidden xl:sticky xl:top-4">
            <div className="border-b border-[var(--p-border)] px-5 py-3.5">
              <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">Bill so far</h2>
            </div>
            <dl className="divide-y divide-[var(--p-border)] text-[13.5px]">
              <Row k="Bed" v={s.bedTotal} />
              <Row k="Nursing" v={s.nurseTotal} />
              <Row k="Charges" v={s.chargesTotal} />
              {/* One line, not one per bill - the tab beside this already lists
                  them individually, and a summary that repeats the detail just
                  makes the reader check whether the two agree. */}
              {Number(s.claimBillsTotal) > 0 && <Row k="Pharmacy &amp; lab" v={s.claimBillsTotal} />}
            </dl>
            <div className="border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[var(--p-muted)]">
                  {Number(s.claimBillsTotal) > 0 ? "Total on the claim" : "Total"}
                </span>
                <span className="font-mono text-[20px] font-bold text-[var(--p-ink)]">₹{money2(s.claimTotal)}</span>
              </div>
              {Number(s.claimBillsTotal) > 0 && (
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--p-muted)]">
                  Includes ₹{money2(s.claimBillsTotal)} of pharmacy and lab billed to the insurer.
                  Nothing here is collected at a counter.
                </p>
              )}
              {Number(s.advanceTotal) > 0 && (
                <div className="mt-1 flex items-center justify-between text-[12.5px] text-[var(--p-muted)]">
                  <span>less advance held</span>
                  <span className="font-mono">−₹{money2(s.advanceTotal)}</span>
                </div>
              )}
            </div>
            <div className="border-t border-[var(--p-border)] px-5 py-4">
              <a href={`/print/bill/${a.id}`} target="_blank" rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--p-blue-deep)]">
                <Icon name="printer" size={15} /> Detailed bill
              </a>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--p-muted)]">
                Opens the A4 claim bill, grouped with subtotals and carrying bill no{" "}
                <span className="font-mono">{a.ipNumber}-P</span> until discharge. Print it, or save it as a PDF to attach.
              </p>
            </div>
          </section>
        </div>
      </div>
      {summaryOpen && (
        <DischargeSummaryForm admissionId={a.id} onClose={() => setSummaryOpen(false)} />
      )}

      {/* The same dialog reception uses - a correction means one thing whichever
          desk made it, and the claim totals are reloaded behind it. */}
      {editingId && (
        <EditBillDialog
          invoiceId={editingId}
          accent="blue"
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            setFlash("Bill corrected.");
            void Promise.all([loadBills(), load()]);
          }}
        />
      )}
    </PortalScroll>
  );
}

function Fixed({ k, sub, v }: { k: string; sub: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <div>
        <div className="text-[13.5px] font-medium text-[var(--p-ink)]">{k}</div>
        <div className="text-[12px] text-[var(--p-muted)]">{sub}</div>
      </div>
      <span className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money2(v)}</span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-2.5">
      <dt className="text-[var(--p-muted)]">{k}</dt>
      <dd className="font-mono text-[var(--p-ink)]">₹{money2(v)}</dd>
    </div>
  );
}
