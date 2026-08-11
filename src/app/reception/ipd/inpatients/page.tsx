"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PrimaryButton, Pill } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { DiscountInput, PaymentSection, type Tender } from "@/components/portal/ui/bill-fields";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import {
  DISCHARGE_OUTCOMES, OUTCOME_LABEL, OUTCOME_SHORT, OUTCOME_HELP,
  type DischargeOutcome, type AdmissionStatusValue,
} from "@/lib/admission-outcome";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";
import { approvalOf, splitStay, type ClaimLike } from "@/lib/insurance-split";
import { portalUrl } from "@/lib/auth/portal-url";
import { bedLabel } from "@/lib/beds";

interface Inpatient {
  bedCharge: string; extrasCharge: string; extras: number;
  id: string; ipNumber: string; admittedAt: string; days: number;
  ward: string; bedNo: string; dailyCharge: string; runningCharge: string;
  reason: string | null; attendantName: string | null; attendantPhone: string | null;
  /** Who settles this stay, decided at admission. Changes what the desk asks for. */
  payerType: string; insurer: string | null; policyNo: string | null;
  doctor: { name: string; department: string };
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
}
/** The full running bill for the discharge estimate - everything, not just the bed. */
interface DischSheet {
  days: number; bedTotal: string; nurseTotal: string; nursePerDay: string;
  chargesTotal: string; grandTotal: string; advanceTotal: string; balance: string;
  charges: { id: string; category: string; description: string; amount: string; fromPharmacy: boolean }[];
  /** Pharmacy and lab bills for this stay, still unpaid. NOT part of the
   *  discharge total below - they are separate invoices, settled on their own. */
  outstandingBills: { id: string; receiptNo: string; source: string; due: string }[];
  outstandingTotal: string;
  /** Cashless stays only: pharmacy and lab already pointed at the insurer.
   *  Part of what the claim carries, so part of what an approval is measured
   *  against - the IPD bill alone is not the stay. */
  claimBillsTotal?: string;
}

/**
 * WHERE THE STAY STANDS WITH ITS INSURER, at the moment of discharge.
 *
 * The discharge desk used to be asked for a co-pay with nothing to derive it
 * from - see the panel below. This is the answer, and it already exists:
 * `stayClaims`, which reception is on the guard for.
 */
interface StayClaims {
  claims: ({ id: string; claimNo: string } & ClaimLike)[];
}
const money = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 });
const SRC_LABEL: Record<string, string> = { CONSULTATION: "Consultation", LAB: "Laboratory", PHARMACY: "Pharmacy", IPD: "Inpatient", OTHER: "Other" };
const prettyDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const prettyDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
interface History {
  bills: { id: string; receiptNo: string; source: string; status: string; total: string; paid: string; balance: string; date: string }[];
  labs: { id: string; testName: string; status: string; reportReady: boolean; reportUrl: string | null; date: string; forThisStay: boolean }[];
  prescriptions: { id: string; title: string | null; fileUrl: string | null; status: string; forThisStay: boolean; date: string; items: { medicineName: string; qty: number; dosage: string | null }[] }[];
}
type HistoryTarget = { id: string; ipNumber: string; patient: { displayId: string; fullName: string } };
interface Discharged {
  id: string; ipNumber: string; dischargedAt: string; days: number; ward: string; bedNo: string;
  /** How the stay ended. Optional so an older cached response still renders. */
  outcome?: string;
  patient: { id: string; displayId: string; fullName: string };
  doctor: { name: string; department: string };
  invoice: { id: string; receiptNo: string; totalAmount: string; status: string } | null;
}

export default function InpatientsPage() {
  const [rows, setRows] = useState<Inpatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dischargeOf, setDischargeOf] = useState<Inpatient | null>(null);
  const [sheet, setSheet] = useState<DischSheet | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  /** The claim behind a cashless discharge. Null until it loads, and on a
   *  self-paying stay it is never fetched at all. */
  const [stayClaims, setStayClaims] = useState<StayClaims | null>(null);

  // patient history (billings / labs / prescriptions) for one stay
  const [historyOf, setHistoryOf] = useState<HistoryTarget | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyTab, setHistoryTab] = useState<"bills" | "labs" | "rx">("bills");
  function openHistory(r: HistoryTarget) {
    setHistoryOf(r); setHistory(null); setHistoryTab("bills");
    api.get<History>(`/ipd/admissions/${r.id}/history`).then(setHistory).catch(() => {});
  }

  const [discharges, setDischarges] = useState<Discharged[]>([]);
  const [disc, setDisc] = useState(0);
  const [payNow, setPayNow] = useState(true);
  /** Cashless only: what the family pays at the desk. Starts at nothing. */
  const [copay, setCopay] = useState(0);
  const [payments, setPayments] = useState<Tender[]>([]);
  const [payValid, setPayValid] = useState(true);
  const [notes, setNotes] = useState("");
  /** How the stay ended. Defaults to the ordinary case, so the common discharge
   *  is still one click and nobody has to answer a question about a death. */
  const [outcome, setOutcome] = useState<DischargeOutcome>("DISCHARGED");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ipNumber: string; days: number; invoiceId: string; receiptNo: string; total: string } | null>(null);

  // Pull the FULL running bill (bed + nursing + every charge + advance) the
  // moment we open the discharge box, so the estimate matches the invoice the
  // backend actually raises - not just the bed.
  useEffect(() => {
    if (!dischargeOf) { setSheet(null); setStayClaims(null); return; }
    let active = true; setSheetLoading(true); setSheet(null); setStayClaims(null);
    api.get<DischSheet>(`/ipd/admissions/${dischargeOf.id}/sheet`)
      .then((s) => { if (active) setSheet(s); })
      .catch(() => { if (active) setSheet(null); })
      .finally(() => { if (active) setSheetLoading(false); });

    // The approval, on a cashless stay. Fetched alongside rather than folded
    // into the sheet so a claims-desk outage cannot stop a discharge - the
    // panel degrades to "no approval on file", which is the safe reading.
    if (dischargeOf.payerType === "INSURANCE") {
      api.get<StayClaims>(`/insurance/admissions/${dischargeOf.id}/claims`)
        .then((c) => { if (active) setStayClaims(c); })
        .catch(() => { if (active) setStayClaims({ claims: [] }); });
    }
    return () => { active = false; };
  }, [dischargeOf]);

  /**
   * `quiet` keeps a live refresh from blanking the screen. The first load shows
   * a spinner; signal-driven ones swap the rows underneath. A list that flashes
   * "Loading…" whenever another desk acts reads as a fault, not as live data.
   */
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [r, d] = await Promise.all([
        api.get<{ inpatients: Inpatient[] }>("/ipd/admissions"),
        api.get<{ discharges: Discharged[] }>("/ipd/discharges").catch(() => ({ discharges: [] as Discharged[] })),
      ]);
      setRows(r.inpatients); setDischarges(d.discharges);
    }
    catch (e) { if (!quiet) setError(e instanceof ApiClientError ? e.message : "Couldn't load inpatients."); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Beds free up and dues appear while this board is open.
  useLive([TOPICS.IPD], () => load(true));

  // The whole bill, not just the bed. Discount comes off the grand total; the
  // advance already held is then credited, leaving what the family pays now.
  const grand = sheet ? Number(sheet.grandTotal) : 0;
  const advance = sheet ? Number(sheet.advanceTotal) : 0;
  const afterDiscount = Math.max(0, grand - disc);

  /**
   * ── WHO IS ASKED FOR MONEY AT THIS DESK ──
   *
   * On a cashless stay the bill goes to the insurer, and the family owes only
   * what the policy does not cover - a co-pay, the non-medical extras, the gap
   * over a room-rent cap. Defaulting to the full total here would have the desk
   * ask a family who was promised cashless for two lakh rupees, which is the
   * single worst thing this screen could do.
   *
   * This used to start at zero and wait for the desk to type a number, which
   * fails the other way: a stay with ₹70,000 uncovered was discharged collecting
   * nothing unless somebody remembered to work it out. The number is not a
   * matter of memory - the insurer has already given it - so it is derived:
   *
   *     PATIENT PAYABLE = everything on the claim − what the insurer approved
   *
   * Still editable, because the last word belongs to the desk holding the TPA's
   * letter. But the default is now the right answer rather than ₹0.
   */
  const isInsurance = dischargeOf?.payerType === "INSURANCE";
  const approval = approvalOf(stayClaims?.claims);

  /**
   * The split itself lives in `@/lib/insurance-split` - shared, pure and tested.
   * The ward sheet, this screen and (next) the server have to agree to the
   * rupee, and three copies of one subtraction is three chances to disagree.
   */
  const split = splitStay({
    billTotal: afterDiscount,
    claimBillsTotal: sheet ? Number(sheet.claimBillsTotal ?? 0) : 0,
    advance,
    isInsurance,
    approval,
  });
  const { stayTotal, insuranceApproved: insApproved, patientPayable, patientDue, refundDue } = split;
  const insReceivable = split.insuranceReceivable;
  /** What the counter is being asked to take RIGHT NOW.
   *  Always zero on a cashless stay - that money is collected at Billing after
   *  the insurer decides, not at this desk before they have. */
  const est = isInsurance ? 0 : patientDue;
  const toInsurer = insApproved;

  /**
   * Seed the co-pay from the approval the moment it lands, so the common case
   * is "read it, confirm it" rather than "work it out". Only ever seeds - a
   * figure the desk has typed is never overwritten by a background refresh.
   */
  const [copayTouched, setCopayTouched] = useState(false);
  useEffect(() => {
    if (!isInsurance || copayTouched || !sheet || !stayClaims) return;
    if (!approval.decided) return;
    setCopay(patientDue);
    // Seeding depends on the derived figure alone; re-running on every render
    // of the same modal is what `copayTouched` and the decided-check prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInsurance, copayTouched, sheet, stayClaims, patientDue, approval.decided]);

  async function discharge(allowOutstanding = false) {
    if (!dischargeOf) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ ipNumber: string; days: number; invoice: { id: string; receiptNo: string; totalAmount: string } }>(
        `/ipd/admissions/${dischargeOf.id}/discharge`,
        {
          // A cashless stay is forwarded, not settled: no discount off the
          // hospital's own claim and no money taken at this desk. The patient's
          // share is collected at Billing once the insurer has decided it.
          discountAmount: isInsurance ? undefined : (disc || undefined),
          payments: !isInsurance && payNow && payments.length ? payments : undefined,
          notes: notes || undefined,
          // Only ever sent from the explicit override below - never a default.
          ...(allowOutstanding ? { allowOutstanding: true } : {}),
          // Only sent when the desk picked something other than an ordinary
          // discharge, so the common case posts exactly the body it always did.
          ...(outcome !== "DISCHARGED" ? { outcome } : {}),
        }
      );
      setDone({ ipNumber: res.ipNumber, days: res.days, invoiceId: res.invoice.id, receiptNo: res.invoice.receiptNo, total: res.invoice.totalAmount });
      await load();
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not discharge."); }
    finally { setBusy(false); }
  }

  // Every field resets, co-pay included: a figure typed for one family must not
  // still be sitting in the box when the next patient is discharged.
  function closeModal() { setDischargeOf(null); setDisc(0); setCopay(0); setCopayTouched(false); setStayClaims(null); setPayments([]); setPayValid(true); setNotes(""); setPayNow(true); setDone(null); setError(null); setOutcome("DISCHARGED"); }

  const Line = ({ k, v, tone, neg }: { k: string; v: string; tone?: "muted" | "cyan"; neg?: boolean }) => (
    <div className="mt-1 flex justify-between first:mt-0">
      <span className="text-[var(--p-muted)]">{k}</span>
      <span className={`font-mono tabular ${tone === "cyan" ? "font-semibold text-[var(--p-cyan-deep)]" : tone === "muted" ? "text-[var(--p-muted)]" : "text-[var(--p-ink)]"}`}>
        {neg ? "−" : ""}₹{money(v)}
      </span>
    </div>
  );

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Inpatients</h1>
          <p className="mt-1 text-[14px] text-[var(--p-muted)]">Everyone currently in a bed, with the stay charge running.</p>
        </div>
        <Link href="/ipd" className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]">
          <Icon name="bed" size={15} /> Bed board
        </Link>
      </div>

      {error && !dischargeOf && <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{error}</div>}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-[14px] text-[var(--p-muted)]">No one is admitted right now.</p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--p-ink)]">{r.patient.fullName}</span>
                    <span className="font-mono text-[12px] text-[var(--p-blue)]">{r.ipNumber}</span>
                    {/* Visible on the row, not only inside the discharge modal.
                        The desk sorts its day off this list, and "who is cashless"
                        changes what it says to a family in the corridor. */}
                    {r.payerType === "INSURANCE" && (
                      <span title={`Cashless · ${r.insurer ?? "insurer"}`}
                        className="rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-blue-deep)]">
                        {r.insurer ?? "Insurance"}
                      </span>
                    )}
                    <Pill tone="checkedin">{bedLabel(r.ward, r.bedNo)}</Pill>
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--p-muted)]">
                    <span className="tabular">{r.patient.displayId}</span>
                    {r.patient.age != null && ` · ${r.patient.age}y`}
                    {" · "}{r.doctor.name}
                    {r.reason && ` · ${r.reason}`}
                  </div>
                  {r.attendantName && (
                    <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                      Attendant: {r.attendantName}{r.attendantPhone && ` · ${r.attendantPhone}`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-mono text-[14px] font-semibold text-[var(--p-ink)] tabular">₹{r.runningCharge}</div>
                    <div className="text-[12px] text-[var(--p-muted)]">
                      bed ₹{r.bedCharge} ({r.days}d)
                      {r.extras > 0 && <> + {r.extras} charge{r.extras === 1 ? "" : "s"} ₹{r.extrasCharge}</>}
                    </div>
                  </div>
                  <button onClick={() => openHistory(r)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="activity" size={14} /> History
                  </button>
                  <a href={`/print/bill/${r.id}`} target="_blank" rel="noopener noreferrer"
                    title="Itemised bill for the stay so far"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="receipt" size={14} /> Detailed bill
                  </a>
                  <a href={`/print/discharge/${r.id}`} target="_blank" rel="noopener noreferrer"
                    title="The running bill for this stay - bed, nursing, pharmacy and charges"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="receipt" size={14} /> Bill
                  </a>
                  <Link href={`/ipd/${r.id}`}
                    className="rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]">
                    Open sheet
                  </Link>
                  <button onClick={() => { setDischargeOf(r); setDisc(0); setCopay(0); setCopayTouched(false); }}
                    className="btn-primary rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white">
                    Discharge
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- RECENTLY DISCHARGED - re-print bills after the patient has left ---------- */}
      {discharges.length > 0 && (
        <section data-rise className="surface mt-6 overflow-hidden">
          <div className="border-b border-[var(--p-border)] px-6 py-4">
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Recently discharged</h3>
            <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">Re-print the bill or open the record after the patient has left the ward.</p>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {discharges.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--p-ink)]">{d.patient.fullName}</span>
                    <span className="font-mono text-[12px] text-[var(--p-blue)]">{d.ipNumber}</span>
                    {/* Only the exceptions are marked. An ordinary discharge needs
                        no label; a death or an abscond must not be able to pass as
                        one in a list the desk scans quickly. */}
                    {d.outcome && d.outcome !== "DISCHARGED" && (
                      <span className="rounded bg-[var(--p-bg)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                        {OUTCOME_SHORT[d.outcome as AdmissionStatusValue] ?? d.outcome}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--p-muted)]">
                    <span className="tabular">{d.patient.displayId}</span> · {d.ward} · {d.days}d · {d.doctor.name} · closed {prettyDateTime(d.dischargedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {d.invoice && (
                    <div className="text-right">
                      <div className="font-mono text-[13px] font-semibold text-[var(--p-ink)] tabular">₹{money(d.invoice.totalAmount)}</div>
                      <div className="font-mono text-[11px] text-[var(--p-muted)]">{d.invoice.receiptNo}</div>
                    </div>
                  )}
                  <button onClick={() => openHistory(d)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="activity" size={14} /> History
                  </button>
                  <a href={`/print/discharge/${d.id}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="file" size={14} /> Summary
                  </a>
                  {/* THE ITEMISED BILL - every bed night, charge, medicine and
                      test on one sheet. The insurance desk has had this all
                      along; a self-paying family asking "what am I paying for?"
                      needs the same page, and the route already existed with
                      nothing linking to it. */}
                  <a href={`/print/bill/${d.id}`} target="_blank" rel="noopener noreferrer"
                    title="Itemised bill for the whole stay"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="receipt" size={14} /> Detailed bill
                  </a>
                  {d.invoice ? (
                    <a href={`/print/invoice/${d.invoice.id}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-blue)] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]">
                      <Icon name="receipt" size={14} /> Print bill
                    </a>
                  ) : (
                    <span className="text-[12px] text-[var(--p-muted)]">No IPD invoice</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------- DISCHARGE MODAL ---------- */}
      {dischargeOf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="surface w-full max-w-md overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Discharge {dischargeOf.patient.fullName}</h3>
                <p className="text-[13px] text-[var(--p-muted)]"><span className="font-mono">{dischargeOf.ipNumber}</span> · {bedLabel(dischargeOf.ward, dischargeOf.bedNo)}</p>
              </div>
              <button onClick={closeModal} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>

            {done ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"><Icon name="check" size={26} /></span>
                <h3 className="mt-4 font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">
                  {isInsurance ? "Discharged · with the insurer" : "Discharged"}
                </h3>
                <p className="mt-1 text-[14px] text-[var(--p-muted)]">
                  {done.days} day{done.days > 1 ? "s" : ""} · Receipt <span className="font-mono font-semibold text-[var(--p-ink)]">{done.receiptNo}</span> · ₹{done.total}
                </p>
                <p className="mt-1 text-[13px] text-[var(--p-muted)]">The bed is free again on the board.</p>
                {/* ── WHERE THIS BILL GOES NEXT ──
                    Two different desks, and the desk that just pressed the
                    button is only one of them. A cashless bill now needs a
                    claim raised against it, and nothing on this screen said so
                    - the receptionist had to know to switch portals. */}
                {isInsurance ? (
                  <p className="mt-3 max-w-sm text-[12.5px] leading-relaxed text-[var(--p-blue-deep)]">
                    This bill is with <b>{dischargeOf?.insurer ?? "the insurer"}</b>. Raise the claim on the
                    <b> Insurance</b> desk. Whatever they refuse comes back as the patient&apos;s share on
                    <b> Billing</b>, under this patient&apos;s name.
                  </p>
                ) : Number(done.total) > 0 && (
                  <p className="mt-3 max-w-sm text-[12.5px] leading-relaxed text-[var(--p-muted)]">
                    Anything still unpaid is on <b>Billing</b> under this patient&apos;s name.
                  </p>
                )}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  {done.invoiceId && (
                    <a href={`/print/invoice/${done.invoiceId}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]">
                      <Icon name="receipt" size={15} /> Print bill
                    </a>
                  )}
                  <a href={`/print/bill/${dischargeOf.id}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="receipt" size={15} /> Detailed bill
                  </a>
                  <a href={`/print/discharge/${dischargeOf.id}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="file" size={15} /> Discharge summary
                  </a>
                  {/* The next desk, one click away rather than one portal away. */}
                  {isInsurance ? (
                    <a href={portalUrl("insurance", `/admissions/${dischargeOf.id}`)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-blue)] px-4 py-2.5 text-sm font-semibold text-[var(--p-blue)] transition-colors hover:bg-[var(--p-blue-soft)]">
                      <Icon name="shield" size={15} /> Open on Insurance
                    </a>
                  ) : (
                    <Link href="/billing"
                      className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                      <Icon name="rupee" size={15} /> Go to Billing
                    </Link>
                  )}
                  <button onClick={closeModal} className="rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)]">Done</button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4 p-6">
                  <div className="rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-4 text-[14px]">
                    {sheetLoading || !sheet ? (
                      <div className="flex items-center justify-center gap-2 py-4 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Totting up the full bill…</div>
                    ) : (
                      <>
                        <Line k={`Bed · ${sheet.days} day${sheet.days > 1 ? "s" : ""}`} v={sheet.bedTotal} />
                        <Line k={`Nursing · ${sheet.days}d × ₹${money(sheet.nursePerDay)}`} v={sheet.nurseTotal} />
                        {Number(sheet.chargesTotal) > 0 && <Line k={`Charges & pharmacy (${sheet.charges.length})`} v={sheet.chargesTotal} />}
                        <div className="mt-2 flex justify-between border-t border-[var(--p-border)] pt-2">
                          <span className="font-semibold text-[var(--p-ink)]">Grand total</span>
                          <span className="font-mono text-[15px] font-semibold text-[var(--p-ink)] tabular">₹{money(sheet.grandTotal)}</span>
                        </div>
                        {disc > 0 && <Line k="Discount" v={disc.toFixed(2)} neg tone="muted" />}
                        {/* On a cashless stay the advance is shown inside the
                            patient-payable block instead, where it belongs -
                            it comes off the FAMILY's share, not off the bill.
                            Showing it in both places invited the reader to
                            subtract it twice. */}
                        {advance > 0 && !isInsurance && <Line k="Advance already paid" v={sheet.advanceTotal} neg tone="cyan" />}
                        {/* ── CASHLESS ── the family is not being asked for this
                            bill, and the desk has to see that before it opens
                            its mouth. */}
                        {isInsurance && (
                          <div className="mt-3 rounded-lg border border-[var(--p-blue)]/35 bg-[var(--p-blue-soft)] px-3 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-bold uppercase tracking-wide text-[var(--p-blue-deep)]">
                                Cashless · {dischargeOf?.insurer}
                              </span>
                              {approval.claimNo && (
                                <span className="shrink-0 font-mono text-[11px] text-[var(--p-blue-deep)]">{approval.claimNo}</span>
                              )}
                            </div>

                            {/* THE CLAIM, IN THE THREE LINES THAT MATTER.
                                Everything on the claim, what the insurer agreed
                                to, and the difference - which is the family's.
                                Shown as a subtraction because that is the sum
                                the desk was doing in its head. */}
                            {!stayClaims ? (
                              <div className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--p-blue-deep)]">
                                <Spinner size={13} /> Checking the approval…
                              </div>
                            ) : approval.pending ? (
                              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#8a6414]">
                                <b>No approval on file.</b>{" "}
                                {approval.claimNo
                                  ? "The claim is still with the insurer - they have not agreed an amount."
                                  : "No claim has been raised for this stay."}{" "}
                                Nothing is settled either way, so take a deposit if the hospital wants
                                cover, and raise or chase the claim on the <b>Insurance</b> desk.
                              </p>
                            ) : approval.rejected ? (
                              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--p-rose)]">
                                <b>Refused by {dischargeOf?.insurer}.</b> The whole stay is the
                                patient&apos;s to pay - ₹{money(stayTotal.toFixed(2))}.
                              </p>
                            ) : (
                              <div className="mt-2 space-y-1 text-[13px]">
                                <div className="flex justify-between">
                                  <span className="text-[var(--p-blue-deep)]">Everything on the claim</span>
                                  <span className="font-mono text-[var(--p-blue-deep)] tabular">₹{money(stayTotal.toFixed(2))}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[var(--p-blue-deep)]">
                                    Insurance approved
                                    {insApproved < stayTotal && <span className="ml-1 text-[11px] font-semibold uppercase">part</span>}
                                  </span>
                                  <span className="font-mono font-semibold text-[var(--p-blue-deep)] tabular">−₹{money(insApproved.toFixed(2))}</span>
                                </div>
                              </div>
                            )}

                            {/* ── PATIENT PAYABLE ── the one figure nobody may be
                                confused about. Its own block, in the largest type
                                in this panel, kept apart from every insurance
                                number around it. */}
                            {approval.decided && (
                              <div className="mt-2.5 rounded-lg bg-white px-3 py-2.5">
                                <div className="flex items-baseline justify-between">
                                  <span className="text-[11.5px] font-bold uppercase tracking-wide text-[var(--p-ink)]">
                                    Patient payable
                                  </span>
                                  <span className="font-mono text-[19px] font-bold text-[var(--p-ink)] tabular">
                                    ₹{money(patientPayable.toFixed(2))}
                                  </span>
                                </div>
                                {advance > 0 && (
                                  <div className="mt-1 flex justify-between text-[12.5px]">
                                    <span className="text-[var(--p-muted)]">Advance already paid</span>
                                    <span className="font-mono font-semibold text-[var(--p-cyan-deep)] tabular">−₹{money(sheet.advanceTotal)}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* The share is STATED here and COLLECTED at Billing.
                                There is no input: at discharge on a cashless
                                stay the insurer has usually not decided yet, and
                                a box asking for money against an undecided claim
                                is how a family gets charged for cover they were
                                promised. */}
                            {approval.decided && patientDue > 0.01 && (
                              <p className="mt-2 text-[12px] leading-relaxed text-[#8a6414]">
                                <b>₹{money(patientDue.toFixed(2))} is the patient&apos;s to pay.</b> It appears on
                                Billing under their name after this discharge - collect it there.
                              </p>
                            )}

                            <div className="mt-2 space-y-1 border-t border-[var(--p-blue)]/25 pt-2 text-[13px]">
                              <div className="flex justify-between">
                                <span className="font-semibold text-[var(--p-blue-deep)]">Goes to {dischargeOf?.insurer}</span>
                                <span className="font-mono font-bold text-[var(--p-blue-deep)] tabular">₹{money(toInsurer.toFixed(2))}</span>
                              </div>
                              {/* Insurance money is stated apart from patient money,
                                  always. A settled claim is cash in the bank; an
                                  approved one is only a promise, and the two must
                                  never read as the same thing. */}
                              {insReceivable > 0.01 && (
                                <div className="flex justify-between text-[12px]">
                                  <span className="text-[var(--p-blue-deep)]">Still to come from the insurer</span>
                                  <span className="font-mono font-semibold text-[var(--p-blue-deep)] tabular">₹{money(insReceivable.toFixed(2))}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="mt-2 flex justify-between border-t border-[var(--p-border)] pt-2">
                          <span className="font-semibold text-[var(--p-ink)]">
                            {refundDue > 0 ? "Refund due" : isInsurance ? "To collect from patient" : "To collect now"}
                          </span>
                          <span className="font-mono text-[16px] font-bold text-[var(--p-blue)] tabular">₹{(refundDue > 0 ? refundDue : est).toFixed(2)}</span>
                        </div>
                        {refundDue > 0 && (
                          <p className="mt-2 text-[12px] text-[#8a6414]">
                            The advance exceeds {isInsurance ? "the patient's share of this bill" : "the bill"} -
                            ₹{refundDue.toFixed(2)} must be refunded, not kept.
                          </p>
                        )}
                        <p className="mt-2 text-[12px] leading-relaxed text-[var(--p-muted)]">
                          This invoice covers the STAY - bed, nursing and procedures. Pharmacy and
                          lab are billed separately and are listed below if anything is unpaid.
                        </p>

                        {/* THE THREE BILLS ARE SEPARATE. This total is the stay
                            only, so the pharmacy and lab money has to be shown
                            here or the desk would collect the bed and let the
                            family walk out owing the rest. */}
                        {sheet.outstandingBills?.length > 0 && (
                          <div className="mt-3 rounded-lg border border-[var(--p-amber)]/40 bg-[var(--p-amber-soft)] px-3 py-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[12px] font-bold uppercase tracking-wide text-[#8a6414]">Still to collect separately</span>
                              <span className="font-mono text-[14px] font-bold text-[#8a6414]">₹{money(sheet.outstandingTotal)}</span>
                            </div>
                            <div className="mt-1.5 space-y-1">
                              {sheet.outstandingBills.map((b) => (
                                <div key={b.id} className="flex items-center justify-between gap-2 text-[12px] text-[#8a6414]">
                                  <span className="truncate">{SRC_LABEL[b.source] ?? b.source} · <span className="font-mono">{b.receiptNo}</span></span>
                                  <span className="flex shrink-0 items-center gap-2">
                                    <span className="font-mono font-semibold">₹{money(b.due)}</span>
                                    <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer"
                                      className="font-semibold text-[var(--p-teal)] hover:underline">Bill</a>
                                  </span>
                                </div>
                              ))}
                            </div>
                            <p className="mt-1.5 text-[11px] leading-relaxed text-[#8a6414]">
                              Settle these on <b>Billing</b> - all of a patient&apos;s bills go in one
                              payment there, and the lab window takes no money. Discharge is refused
                              while they are outstanding.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* ══ TWO DISCHARGES, NOT ONE ══
                      A self-paying family settles at this desk, so the desk
                      needs a discount box and a payment box. A cashless stay
                      settles nowhere near this desk - the bill goes to the
                      insurer, they decide an amount, and only then does anyone
                      know what the family owes.
                      Showing the same two controls for both was asking the
                      receptionist to discount and collect on a bill whose value
                      to the hospital had not been agreed yet. */}
                  {isInsurance ? (
                    <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3">
                      <p className="text-[12.5px] leading-relaxed text-[var(--p-muted)]">
                        <b className="text-[var(--p-ink)]">No discount and no payment here.</b>{" "}
                        A cashless bill is not this desk&apos;s to reduce - a discount would come
                        straight off the hospital&apos;s claim, not off the family. This stay is
                        forwarded to <b>{dischargeOf?.insurer ?? "the insurer"}</b> to be claimed.
                      </p>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--p-muted)]">
                        Whatever they refuse becomes the patient&apos;s share and appears on{" "}
                        <b>Billing</b> under this patient&apos;s name, ready to collect.
                      </p>
                    </div>
                  ) : (
                    <>
                      <DiscountInput subtotal={grand} accent="blue" onChange={(d) => setDisc(d.amount)} />

                      <label className="flex items-center gap-2 text-[14px] text-[var(--p-text)]">
                        <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="h-4 w-4 accent-[var(--p-blue)]" /> Collect payment now
                      </label>
                      {payNow && est > 0 && (
                        <PaymentSection total={est} accent="blue" onChange={(r) => { setPayments(r.payments); setPayValid(r.valid); }} />
                      )}
                    </>
                  )}

                  {/* HOW THE STAY ENDED.
                      A select, not five buttons: an ordinary discharge is the
                      overwhelming majority and must stay a single click, while the
                      other four have to be reachable without anyone having to lie
                      to the software. The bill is raised either way - the bed was
                      occupied and the medicines were given whatever the ending. */}
                  <Field label="How the stay ended">
                    <select className={fld} value={outcome} onChange={(e) => setOutcome(e.target.value as DischargeOutcome)}>
                      {DISCHARGE_OUTCOMES.map((o) => (
                        <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[12px] text-[var(--p-muted)]">{OUTCOME_HELP[outcome]}</p>
                  </Field>

                  <Field label="Discharge notes"><textarea className={`${fld} min-h-[56px] resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condition on discharge, advice…" /></Field>
                </div>

                {error && <div className="border-t border-[var(--p-border)] bg-[var(--p-rose-soft)] px-6 py-2.5 text-[13px] text-[var(--p-rose)]">{error}</div>}

                <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
                  <button onClick={closeModal} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
                  {/* The override is a separate, plainly-worded button rather
                      than a checkbox on the main one - discharging someone who
                      still owes money should take a deliberate second act, and
                      it is recorded against the name that pressed it. */}
                  {(sheet?.outstandingBills?.length ?? 0) > 0 && (
                    <button onClick={() => discharge(true)} disabled={busy || !sheet}
                      className="rounded-lg border border-[var(--p-amber)] px-4 py-2 text-sm font-semibold text-[#8a6414] hover:bg-[var(--p-amber-soft)] disabled:opacity-40">
                      Discharge leaving ₹{money(sheet!.outstandingTotal)} unpaid
                    </button>
                  )}
                  {/* The verb names what actually happens next, and the two
                      are not the same act: a self-pay discharge ends at this
                      desk, a cashless one hands the stay to the claims desk. */}
                  <PrimaryButton onClick={() => discharge(false)} disabled={busy || !sheet || (!isInsurance && payNow && est > 0 && !payValid)}>
                    {busy
                      ? <><Spinner /> {isInsurance ? "Forwarding…" : "Discharging…"}</>
                      : <><Icon name="check" size={15} /> {isInsurance ? "Discharge & forward to insurance" : "Discharge & bill"}</>}
                  </PrimaryButton>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- HISTORY MODAL ---------- */}
      {historyOf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setHistoryOf(null)}>
          <div onClick={(e) => e.stopPropagation()} className="surface flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">History · {historyOf.patient.fullName}</h3>
                <p className="text-[13px] text-[var(--p-muted)]"><span className="font-mono">{historyOf.patient.displayId}</span> · {historyOf.ipNumber}</p>
              </div>
              <button onClick={() => setHistoryOf(null)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>
            <div className="flex gap-1 border-b border-[var(--p-border)] px-3 py-2">
              {([["bills", "Billings", history?.bills.length], ["labs", "Lab reports", history?.labs.length], ["rx", "Prescriptions", history?.prescriptions.length]] as const).map(([k, label, n]) => (
                <button key={k} onClick={() => setHistoryTab(k)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${historyTab === k ? "bg-[var(--p-blue)] text-white" : "text-[var(--p-muted)] hover:bg-[var(--p-bg)]"}`}>
                  {label}{n != null && n > 0 && <span className={`rounded-full px-1.5 text-[10.5px] font-bold ${historyTab === k ? "bg-white/25" : "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]"}`}>{n}</span>}
                </button>
              ))}
            </div>
            <div className="flex-1 divide-y divide-[var(--p-border)] overflow-y-auto">
              {!history ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Loading history…</div>
              ) : historyTab === "bills" ? (
                history.bills.length === 0 ? <p className="px-6 py-10 text-center text-[13px] text-[var(--p-muted)]">No bills yet.</p> : history.bills.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-[var(--p-ink)]"><span className="font-mono">{b.receiptNo}</span> · {SRC_LABEL[b.source] ?? b.source}</div>
                      <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(b.date)} · Paid ₹{money(b.paid)} of ₹{money(b.total)}{Number(b.balance) > 0 && <span className="text-[var(--p-rose)]"> · ₹{money(b.balance)} due</span>}</div>
                    </div>
                    <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]"><Icon name="receipt" size={13} /> Invoice</a>
                  </div>
                ))
              ) : historyTab === "labs" ? (
                history.labs.length === 0 ? <p className="px-6 py-10 text-center text-[13px] text-[var(--p-muted)]">No lab tests yet.</p> : history.labs.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{l.testName}</span>{l.forThisStay && <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">This stay</span>}</div>
                      <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(l.date)} · {l.status === "COMPLETED" ? "Completed" : "Pending"}</div>
                    </div>
                    {l.reportUrl ? <a href={l.reportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--p-cyan)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"><Icon name="file" size={13} /> Report</a> : <span className="shrink-0 text-[11.5px] text-[var(--p-muted)]">No report yet</span>}
                  </div>
                ))
              ) : (
                history.prescriptions.length === 0 ? <p className="px-6 py-10 text-center text-[13px] text-[var(--p-muted)]">No prescriptions yet.</p> : history.prescriptions.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{r.title || (r.items.length ? r.items.map((i) => i.medicineName).slice(0, 2).join(", ") + (r.items.length > 2 ? "…" : "") : "Prescription")}</span>{r.forThisStay && <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">This stay</span>}</div>
                      <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(r.date)} · {r.items.length} item{r.items.length === 1 ? "" : "s"} · {r.status.toLowerCase().replace(/_/g, " ")}</div>
                    </div>
                    {r.fileUrl && <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]"><Icon name="file" size={13} /> Scan</a>}
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end border-t border-[var(--p-border)] p-4">
              <button onClick={() => setHistoryOf(null)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Close</button>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
