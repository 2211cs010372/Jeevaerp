"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { DischargeSummaryForm } from "@/components/portal/ipd/discharge-summary-form";
import { CorrectStayDialog, type StayLeg } from "@/components/portal/ipd/correct-stay-dialog";
import { ConvertToSelfPayDialog } from "@/components/portal/ipd/convert-to-self-pay-dialog";
import { CorrectChargeDialog, chargeDateLabel } from "@/components/portal/ipd/correct-charge-dialog";
import { api, ApiClientError } from "@/lib/api-client";
import { RepeatConfirmDialog } from "@/components/portal/repeat-confirm-dialog";
import { repeatBlock, type RepeatBlock } from "@/lib/repeat-guard";
import { bedLabel } from "@/lib/beds";
import { EditBillDialog, useBillEditing } from "@/components/portal/billing/edit-bill-dialog";
import { PatientHistoryPanel } from "@/components/portal/ipd/patient-history-panel";
import { StatusPill, NewClaim, type ClaimPrefill } from "@/components/portal/insurance/claims-board";
// The same rule the desk's worklist uses to decide a stay still owes a claim.
import { authorisedAmount, excessOver, needsFinalClaim, openPreAuth, openFinalClaim } from "@/lib/final-claim";

/** One row of the hospital's published rate card. See prisma ServiceCharge. */
interface ServiceCharge {
  id: string; name: string; group: string; category: string;
  price: string; gstRatePct: string; perDay: boolean;
}
const SERVICE_GROUP_LABEL: Record<string, string> = {
  IP_CHARGE: "Inpatient charges",
  SURGERY_OPEN: "Surgery - open",
  SURGERY_LAPAROSCOPIC: "Surgery - laparoscopic",
  OTHER: "Other",
};

interface Charge {
  id: string; category: string; description: string; qty: number;
  unitPrice: string; gstRatePct: string; amount: string;
  addedBy: string; createdAt: string; fromPharmacy: boolean;
}
interface Sheet {
  admission: {
    id: string; ipNumber: string; status: string; admittedAt: string; reason: string | null;
    /** Null while they are still in a bed. */
    dischargedAt: string | null;
    wardName: string; bedNo: string; dailyCharge: string; gstRatePct: string;
    attendantName: string | null; attendantPhone: string | null; attendantRelation: string | null;
    payerType: string; insurer: string | null;
    /** Taken by this desk when it works the claim, so both can be blank on a
     *  stay reception admitted in a hurry - the claim form asks for them. */
    policyNo: string | null; memberId: string | null;
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
    doctor: { name: string; department: string };
  };
  days: number; bedTotal: string; charges: Charge[]; chargesTotal: string; grandTotal: string;
  nurseTotal: string; nursePerDay: string;
  /** False since the per-day nursing fee was withdrawn. True only on a stay
   *  already billed for it, which keeps its row. See ipd.service. */
  nursingApplies: boolean;
  /** Append-only chronology - see AdmissionNote. Never edited in place. */
  notes: { id: string; body: string; kind: "NURSING" | "DISCHARGE"; authorName: string | null; createdAt: string }[];
  /** One row per bed occupied. Two rows = they were transferred mid-stay. */
  legs: StayLeg[];
  /** Nights no bed line covers, because a bed was capped and the rest has not
   *  been raised as a charge yet. 0 on an ordinary stay. See ipd.service. */
  uncoveredDays: number;
  advanceTotal: string;
  /** Each deposit slip taken on this stay - listed so any can be reprinted. */
  advances: (Advance & { takenAt: string })[];
  /** Pharmacy and lab bills for this stay that are still unpaid. Separate
   *  documents from the discharge bill - this is where they surface. */
  outstandingBills: { id: string; receiptNo: string; source: string; total: string; paid: string; due: string; createdAt: string }[];
  outstandingTotal: string;
  /** Cashless stays only: pharmacy and lab going to the insurer, counted in the
   *  total rather than chased at a counter. Empty on a self-paying stay. */
  claimBills: { id: string; receiptNo: string; source: string; total: string; createdAt: string }[];
  claimBillsTotal: string;
  claimTotal: string;
  balance: string;
  /** EVERY counter bill on the stay, paid ones included - what the tab lists.
   *  outstandingBills drops a bill as soon as it is settled; this does not, so
   *  a medicine paid for at the pharmacy window still shows what the stay cost. */
  counterBills: {
    id: string; receiptNo: string; source: string;
    total: string; paid: string; due: string;
    status: "PAID" | "PART" | "DUE"; payer: string; createdAt: string;
  }[];
  counterPaidTotal: string;
}
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

interface StayClaims {
  claims: {
    id: string; claimNo: string; type: string; stage: string; status: string;
    claimedAmount: string; approvedAmount: string | null; settledAmount: string | null;
    /** The family's share of this approval. approvedAmount is already net. */
    copayAmount: string | null; copayPct: string | null;
    insurerRef: string | null; submittedAt: string | null; decisionAt: string | null;
  }[];
  insuranceBills: { id: string; receiptNo: string; source: string; total: string; paid: string }[];
  insuranceBillsTotal: string;
  needsDecision: boolean;
}

interface Med { id: string; name: string; unit: string; inStock: number; }
/** One deposit slip. `receiptNo` is what the family quotes at discharge. */
interface Advance { id: string; receiptNo: string; amount: string; mode: string; }

const CATEGORIES = [
  { k: "PROCEDURE", label: "Procedure" },
  { k: "DOCTOR_VISIT", label: "Doctor round" },
  { k: "NURSING", label: "Nursing" },
  { k: "OXYGEN", label: "Oxygen" },
  { k: "INVESTIGATION", label: "Investigation" },
  { k: "CONSUMABLE", label: "Consumables" },
  { k: "OTHER", label: "Other" },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.k, c.label]));
const money = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 });
/** Two decimals always - claim figures are quoted to the paisa in correspondence. */
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
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export default function AdmissionSheetPage() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** The server's "already on the bill" refusal, and how to go ahead anyway. */
  const [repeat, setRepeat] = useState<{ block: RepeatBlock; message: string; retry: () => void } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);

  // ── CORRECTING A BILL RAISED AGAINST THIS STAY ──
  //
  // The pharmacy and the lab raise their own invoices against an admission, and
  // this screen is where the ward actually looks at them - so it is where a
  // wrong one gets noticed. Until now it could only print them.
  //
  // Gated by HospitalConfig.billEditingEnabled like the rest of reception; the
  // server enforces it inside updateInvoice, this only draws the button.
  const { canEdit } = useBillEditing();
  const [editingBillId, setEditingBillId] = useState<string | null>(null);

  // ── THE THREE FIGURES THAT WERE NOT LINES ──
  //
  // Bed, nursing and the day count are the biggest numbers on the sheet and were
  // the only ones with no edit path - see CorrectStayDialog. Reached from the two
  // rows themselves, because that is where somebody notices they are wrong.
  const [correctOpen, setCorrectOpen] = useState(false);
  /** The insurer refused - the stay and its bills become the family's. */
  const [rejectOpen, setRejectOpen] = useState(false);
  /** The tab line whose date is being corrected - see CorrectChargeDialog. */
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  /** The final claim being raised off this stay, prefilled from it. */
  const [raising, setRaising] = useState<ClaimPrefill | null>(null);
  /** Only for the datalist behind the claim form's insurer box - fetched when
   *  that form opens, not on every load of a screen that rarely shows it. */
  const [insurers, setInsurers] = useState<string[]>([]);

  // add-charge form
  const [cat, setCat] = useState("PROCEDURE");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [gst, setGst] = useState("0");

  // The hospital's published rate card - the boards on the wall, in a dropdown.
  const [services, setServices] = useState<ServiceCharge[]>([]);
  useEffect(() => {
    api.get<{ services: ServiceCharge[] }>("/ipd/services").then((r) => setServices(r.services)).catch(() => {});
  }, []);

  /** Fill the line from the rate card, leaving every box editable. */
  function pickService(id: string) {
    const svc = services.find((x) => x.id === id);
    if (!svc) return;
    setDesc(svc.name);
    setCat(svc.category);
    setPrice(String(Number(svc.price)));
    setGst(String(Number(svc.gstRatePct)));
    // A per-day charge defaults to the days so far. Still editable - nobody is
    // on oxygen for every night they are in the bed.
    setQty(svc.perDay && sheet ? String(sheet.days) : "1");
  }

  // nursing / observation notes
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  // IP prescription
  // ── TRANSFER ── General → ICU. Until now the only way was discharge+readmit,
  //    which splits one stay into two bills.
  const [xferOpen, setXferOpen] = useState(false);
  const [xferWards, setXferWards] = useState<{ id: string; name: string; dailyCharge: string; gstRatePct: string; beds: { id: string; bedNo: string }[] }[]>([]);
  const [xferBed, setXferBed] = useState("");
  const [xferReason, setXferReason] = useState("");

  // ── ADVANCE ── the deposit. Every hospital takes one.
  const [advOpen, setAdvOpen] = useState(false);
  const [advAmt, setAdvAmt] = useState("");
  const [advMode, setAdvMode] = useState<"CASH" | "UPI" | "CARD" | "NETBANKING">("CASH");
  /** The slip just issued - held so the desk can print it straight away. */
  const [advTaken, setAdvTaken] = useState<Advance | null>(null);

  async function openTransfer() {
    setXferOpen(true);
    try {
      const r = await api.get<{ wards: typeof xferWards }>(`/ipd/admissions/${admissionId}/transfer`);
      setXferWards(r.wards);
      setXferBed(r.wards[0]?.beds[0]?.id ?? "");
    } catch { setXferWards([]); }
  }

  async function doTransfer() {
    if (!xferBed) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ toWard: string; toBed: string; newDailyCharge: string }>(
        `/ipd/admissions/${admissionId}/transfer`,
        { toBedId: xferBed, reason: xferReason.trim() || undefined }
      );
      setFlash(`Moved to ${r.toWard} · ${r.toBed}. Billed at ₹${r.newDailyCharge}/day from today - the days already spent keep their old rate.`);
      setXferOpen(false); setXferReason("");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not transfer."); }
    finally { setBusy(false); }
  }

  /**
   * Remove a transfer that was entered by mistake.
   *
   * Only the newest leg can come off, and that is the only safe one: the legs
   * chain end-to-end, so pulling one out of the middle would leave a hole in
   * the days that no arithmetic closes. The chronology keeps both the move and
   * its removal - somebody did move this patient in the system, and a record
   * that can be edited to say otherwise is not a record.
   */
  async function doUndoTransfer() {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ movedBackTo: string }>(`/ipd/admissions/${admissionId}/transfer/undo`, {});
      setFlash(`Transfer removed. Back in ${r.movedBackTo} - the bed charge is recalculated.`);
      setUndoOpen(false);
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not remove the transfer."); }
    finally { setBusy(false); }
  }

  async function doAdvance() {
    if (!(Number(advAmt) > 0)) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ totalAdvance: string; advance: Advance }>(`/ipd/admissions/${admissionId}/advance`, {
        amount: Number(advAmt), mode: advMode,
      });
      // The family is standing at the counter having just handed over cash. The
      // receipt has to be one click away from here, not buried in a sub-page.
      setAdvTaken(r.advance);
      setFlash(`Advance taken · receipt ${r.advance.receiptNo}. ₹${r.totalAdvance} held against this stay - it comes off the discharge bill.`);
      setAdvOpen(false); setAdvAmt("");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not record the advance."); }
    finally { setBusy(false); }
  }

  const [rxOpen, setRxOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [meds, setMeds] = useState<Med[]>([]);
  const [rxItems, setRxItems] = useState<{ name: string; medicineId: string | null; qty: string; dosage: string }[]>([
    { name: "", medicineId: null, qty: "1", dosage: "" },
  ]);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── LABS ── order tests straight onto the room tab.
  const [labCatalog, setLabCatalog] = useState<{ id: string; name: string; code: string | null; price: string }[]>([]);
  const [labsOpen, setLabsOpen] = useState(false);
  /** The shared discharge summary - the same record the insurance desk edits. */
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [labPick, setLabPick] = useState<Set<string>>(new Set());
  const [labQuery, setLabQuery] = useState("");

  // ── HISTORY ── owned by PatientHistoryPanel, which fetches it itself. The
  // page keeps only a token: every existing `loadHistory()` call site still
  // means "the record changed, read it again", it just says so by bumping a
  // number instead of holding the data.
  const [historyToken, setHistoryToken] = useState(0);
  const loadHistory = useCallback(() => setHistoryToken((n) => n + 1), []);

  // ── THE INSURANCE DESK'S OWN THREE ──
  // Everything above is the ward's sheet, shared with reception. These are the
  // questions only this desk asks: where the claim stands, what every bill on
  // the stay is dated, and what happens when the insurer says no.
  const [sc, setSc] = useState<StayClaims | null>(null);
  const [bills, setBills] = useState<StayBills | null>(null);
  const [showBills, setShowBills] = useState(false);
  const [reverting, setReverting] = useState(false);
  /** Filling in the amount on the ₹0 draft every insurance admission opens. */
  const [amountFor, setAmountFor] = useState<string | null>(null);
  const [claimAmt, setClaimAmt] = useState("");
  const [revertReason, setRevertReason] = useState("");

  const loadBills = useCallback(async () => {
    try { setBills(await api.get<StayBills>(`/insurance/admissions/${admissionId}/bills`)); }
    catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't load the bills."); }
  }, [admissionId]);

  async function redate(invoiceId: string, date: string) {
    if (!date) return;
    try {
      const r = await api.patch<{ receiptNo: string }>(`/insurance/admissions/${admissionId}/bills`, { invoiceId, date });
      setFlash(`${r.receiptNo} re-dated.`);
      await Promise.all([loadBills(), load()]);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Couldn't change the date.");
      // Put the control back to what the server actually holds.
      await loadBills();
    }
  }

  /**
   * Give the auto-opened draft its figure, and send it.
   *
   * Two calls, deliberately: AMOUNT then SUBMIT. The server refuses to submit a
   * ₹0 claim, so a desk that sets the number and stops has a claim that is
   * ready rather than one that is half-sent.
   */
  async function setClaimAmountAndSubmit(claimId: string, alsoSubmit: boolean) {
    const n = Number(claimAmt);
    if (!(n > 0)) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/insurance/${claimId}/action`, { action: "AMOUNT", amount: n });
      if (alsoSubmit) await api.post(`/insurance/${claimId}/action`, { action: "SUBMIT" });
      setAmountFor(null); setClaimAmt("");
      setFlash(alsoSubmit
        ? `Claim sent to the insurer for ₹${money2(n.toFixed(2))}.`
        : `Claim amount set to ₹${money2(n.toFixed(2))} - submit it when you are ready.`);
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't update the claim."); }
    finally { setBusy(false); }
  }

  /**
   * Send a claim that already has its figure.
   *
   * The "To raise" list has always been able to say a stay needs SUBMITTING -
   * including a pre-auth on a patient still in a bed - and its button brought
   * the desk to this page, where there was nothing to press. Submitting lived
   * on the claims board only, so the one path the list was pointing at ended in
   * a screen with no action on it. In practice that meant a pre-auth got sent
   * when somebody remembered to go to /claims, which is why insurance felt like
   * something you only did after discharge.
   */
  async function sendClaim(claimId: string) {
    setBusy(true); setErr(null);
    try {
      await api.post(`/insurance/${claimId}/action`, { action: "SUBMIT" });
      setFlash("Sent to the insurer.");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't send the claim."); }
    finally { setBusy(false); }
  }

  async function billThePatient() {
    if (revertReason.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await api.post<{ moved: { receiptNo: string }[]; movedTotal: string; skipped: { receiptNo: string; why: string }[] }>(
        `/insurance/admissions/${admissionId}/claims`,
        // convertStay, same as the "Insurance rejected" dialog. This is a
        // WHOLE-STAY revert - it names no invoices - so leaving the admission
        // marked INSURANCE afterwards was the bug that kept a refused stay on
        // this desk's own list forever and sent the next bill back to the
        // insurer. Two buttons for one decision must not do two things.
        { reason: revertReason.trim(), convertStay: true }
      );
      setReverting(false); setRevertReason("");
      setFlash(
        `₹${money2(r.movedTotal)} across ${r.moved.length} bill${r.moved.length === 1 ? "" : "s"} is now the patient's, and the stay is self-pay - collect it on reception's Billing screen.` +
        (r.skipped.length ? ` ${r.skipped.length} left alone (money already taken).` : "")
      );
      await load();
    } catch (err) { setErr(err instanceof ApiClientError ? err.message : "Couldn't move the bills."); }
    finally { setBusy(false); }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sheetData, claims] = await Promise.all([
        api.get<Sheet>(`/ipd/admissions/${admissionId}/sheet`),
        api.get<StayClaims>(`/insurance/admissions/${admissionId}/claims`),
      ]);
      setSheet(sheetData); setSc(claims);
    }
    catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't load the sheet."); }
    finally { setLoading(false); }
  }, [admissionId]);
  useEffect(() => { load(); }, [load]);

  // Nothing to seed - the box is always empty, because it adds an entry rather
  // than editing the stay's notes. What has already been written is history.

  useEffect(() => {
    api.get<{ medicines: Med[] }>("/pharmacy/medicines").then((r) => setMeds(r.medicines)).catch(() => {});
    api.get<{ catalog: { id: string; name: string; code: string | null; price: string }[] }>("/labs/catalog").then((r) => setLabCatalog(r.catalog)).catch(() => {});
  }, []);

  const labPickTotal = useMemo(() => labCatalog.filter((c) => labPick.has(c.id)).reduce((s, c) => s + Number(c.price), 0), [labCatalog, labPick]);

  /** @param confirmRepeat  pressed "order again" in the "just ordered" dialog. */
  async function orderLabs(confirmRepeat = false) {
    if (!sheet || labPick.size === 0) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/labs/tests/order", { patientId: sheet.admission.patient.id, catalogIds: [...labPick], confirmRepeat: confirmRepeat || undefined });
      setRepeat(null);
      setFlash(`${labPick.size} test${labPick.size === 1 ? "" : "s"} ordered - charged to the room and queued for the lab.`);
      setLabsOpen(false); setLabPick(new Set()); setLabQuery("");
      await load(); loadHistory();
    } catch (e) {
      // Ordered minutes ago - nothing was ordered; the dialog shows that bill.
      const again = repeatBlock(e);
      if (again) { setRepeat({ block: again, message: (e as Error).message, retry: () => { void orderLabs(true); } }); return; }
      setRepeat(null);
      setErr(e instanceof ApiClientError ? e.message : "Could not order the tests.");
    }
    finally { setBusy(false); }
  }

  async function saveNotes() {
    if (!notes.trim()) return;
    setSavingNotes(true); setErr(null);
    try {
      await api.post(`/ipd/admissions/${admissionId}/notes`, { body: notes.trim() });
      setNotes(""); setNotesDirty(false);
      setFlash("Note added to the stay.");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not add the note."); }
    finally { setSavingNotes(false); }
  }

  const lineTotal = useMemo(() => (Number(qty || 0) * Number(price || 0)).toFixed(2), [qty, price]);

  /** @param confirmRepeat  pressed "Add it again" in the "just added" dialog. */
  async function addCharge(confirmRepeat = false) {
    if (!desc.trim() || !price) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/ipd/admissions/${admissionId}/charges`, {
        category: cat, description: desc.trim(),
        qty: Number(qty || 1), unitPrice: Number(price), gstRatePct: Number(gst || 0),
        confirmRepeat: confirmRepeat || undefined,
      });
      setRepeat(null);
      setFlash(`₹${money(lineTotal)} added to the tab.`);
      setDesc(""); setQty("1"); setPrice(""); setGst("0");
      await load();
    } catch (e) {
      // The same line went on minutes ago - nothing was added.
      const again = repeatBlock(e);
      if (again) { setRepeat({ block: again, message: (e as Error).message, retry: () => { void addCharge(true); } }); return; }
      setRepeat(null);
      setErr(e instanceof ApiClientError ? e.message : "Could not add the charge.");
    }
    finally { setBusy(false); }
  }

  async function removeCharge(c: Charge) {
    setBusy(true); setErr(null);
    try { await api.del(`/ipd/charges/${c.id}`); await load(); }
    catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not remove it."); }
    finally { setBusy(false); }
  }

  /** IP prescription: the doctor's round produced a chit. The scan is optional -
   *  typing the medicines and sending to pharmacy is enough on its own. */
  async function uploadRx(send: boolean) {
    if (!sheet) return;
    const items = rxItems
      .filter((r) => r.name.trim())
      .map((r) => ({ medicineName: r.name.trim(), medicineId: r.medicineId ?? undefined, qty: Number(r.qty || 1), dosage: r.dosage.trim() || undefined }));
    if (!file && items.length === 0) { setErr("Attach a scan, or type at least one medicine."); return; }
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      fd.append("patientId", sheet.admission.patient.id);
      fd.append("admissionId", sheet.admission.id);
      fd.append("items", JSON.stringify(items));
      if (send) fd.append("sendNow", "1");

      const res = await fetch("/api/v1/reception/prescriptions", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new ApiClientError(res.status, (await res.json().catch(() => ({}))).error ?? "Upload failed");

      setFlash(send
        ? "Sent to the pharmacy - the medicines will be charged to this room, not to the patient at the counter."
        : "Prescription saved to the stay.");
      setRxOpen(false); setFile(null); setRxItems([{ name: "", medicineId: null, qty: "1", dosage: "" }]);
      await load(); loadHistory();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

  if (loading) return <PortalScroll><div className="flex items-center justify-center gap-2 py-24 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading the sheet…</div></PortalScroll>;
  if (!sheet) return <PortalScroll><p className="py-24 text-center text-[14px] text-[var(--p-rose)]">{err ?? "Not found."}</p></PortalScroll>;

  const a = sheet.admission;
  const discharged = a.status !== "ADMITTED";
  /** Days the BED bills - the stay, less anything a desk has capped off it. */
  const bedDaysBilled = sheet.days - sheet.uncoveredDays;
  /** Read off the sheet rather than copied into state, so a reload behind the
   *  open dialog cannot leave it showing a line that has since changed. */
  const editingCharge = sheet.charges.find((c) => c.id === editingChargeId) ?? null;

  // ── IS A FINAL CLAIM STILL OWED ON THIS STAY? ──
  //
  // The same rule `pendingWork` uses, asked of one stay - the two must agree or
  // the desk's worklist and the stay's own screen tell different stories about
  // the same patient.
  //
  // A pre-auth is raised on an ESTIMATE while the patient is in the bed, and a
  // stay that lands inside that estimate is settled by the authorisation: there
  // is no second claim to send. A final claim is for the stay that went OVER,
  // and for the stay nobody ever got authorised at all.
  //
  // A CLOSED claim does not count as filed - that is the unused ₹0 pre-auth
  // being tidied away, not a claim anybody sent.
  const finalClaim = sc ? openFinalClaim(sc.claims) : null;
  /** The discharge bill itself - the document a final claim is raised against. */
  const ipdBill = sc?.insuranceBills.find((b) => b.source === "IPD") ?? null;
  /** Everything pointed at the insurer: discharge bill + pharmacy + lab. */
  const insuranceBilled = Number(sc?.insuranceBillsTotal ?? 0);
  // Every pre-auth that is not tidied away, refusals included - `authorisedAmount`
  // reads a refusal as "nothing authorised", and the panel says so out loud.
  const preAuth = sc?.claims.find((c) => c.stage === "PRE_AUTH" && c.status !== "CLOSED") ?? null;
  /** What the insurer authorised, and how far past it the stay landed. */
  const authorised = authorisedAmount(preAuth);
  const overBy = excessOver(insuranceBilled, authorised);

  // ── THE TWO THINGS THIS DESK CAN SEND AN INSURER, SIDE BY SIDE ──
  //
  // A stay has exactly two claims in its life and they are raised at different
  // moments: the PRE-AUTH against an estimate while the patient is in the bed,
  // and the FINAL against the bill once the stay is over. This screen offered
  // only the second, so the desk that had just finished reading THIS stay had to
  // go and find another list to raise the pre-auth from.
  //
  // EACH BUTTON DISAPPEARS THE MOMENT ITS OWN CLAIM EXISTS. That is what takes
  // the pre-auth away once the insurer approves it: an approved pre-auth IS the
  // claim on this stay, and the only thing left to send afterwards is the final
  // one. `preAuth` and `finalClaim` both ignore CLOSED, so the unused ₹0 draft
  // somebody tidied away does not count as raised and the button comes back.
  //
  // `!finalClaim` matters as much as the rest: a draft final claim is already
  // drawn above with its own "Set amount" and "Send to insurer", and offering
  // "Raise" beside it is exactly how a stay ends up carrying two claims with
  // nobody able to say which one is live.
  //
  // A REFUSED pre-auth is not one of them. The insurer said no, which authorises
  // nothing - `authorisedAmount` already reads a refusal that way - and the way
  // back from it is a fresh pre-auth, not a stay with no button on it.
  const onPolicy = a.payerType === "INSURANCE" && !!sc;
  const standingPreAuth = sc ? openPreAuth(sc.claims) : null;
  const canRaisePreAuth = onPolicy && !standingPreAuth;
  const canRaiseFinal = onPolicy && !finalClaim;

  // WHETHER A FINAL CLAIM IS OWED is a stricter question than whether one can be
  // raised, and it is the WORKLIST's question - the same rule `pendingWork` uses.
  // It no longer hides the button (the desk asked for both stages to be offered
  // from the stay), it decides what this panel SAYS. A stay that came in under
  // its authorisation is finished, and it should read as finished here even
  // while the button to claim anyway is on the screen.
  const finalClaimOwed =
    discharged && onPolicy && !!ipdBill && !finalClaim &&
    needsFinalClaim({ billedToInsurer: insuranceBilled, authorised, finalClaimStatus: null });

  /** The stay's own total - bills and open tab together, the figure the sheet
   *  foots to. A pre-auth is estimated off this, and while the patient is still
   *  in a bed it is the only figure there is. */
  const stayTotal = Number(sheet.claimTotal);
  /** What a final claim asks for: everything pointed at the insurer once bills
   *  exist, and the running total before any have been raised. */
  const finalBase = insuranceBilled > 0 ? insuranceBilled : stayTotal;

  /** `amount` lets the excess button claim the difference instead of the lot. */
  function raiseClaim(stage: "PRE_AUTH" | "FINAL", amount?: number) {
    if (insurers.length === 0) {
      api.get<{ insurers: string[] }>("/insurance?status=ALL")
        .then((r) => setInsurers(r.insurers)).catch(() => {});
    }
    setRaising({
      patient: {
        id: a.patient.id, displayId: a.patient.displayId,
        fullName: a.patient.fullName, phone: a.patient.phone, age: a.patient.age,
      },
      insurer: a.insurer ?? "",
      policyNo: a.policyNo ?? "",
      memberId: a.memberId ?? "",
      stage,
      // A stay flagged INSURANCE was treated on the promise of cashless. A
      // reimbursement is the other shape - the family paid - and that button
      // lives on the stays list, where a SELF_PAY stay can be found.
      type: "CASHLESS",
      // EVERY bill pointed at the insurer by default, not just the discharge
      // bill: on a cashless stay the pharmacy and the lab go on the same claim,
      // and a desk that claimed the IPD invoice alone would leave that money
      // unasked for. The excess button passes the difference instead, for an
      // insurer that wants only what is over the authorisation.
      //
      // A PRE-AUTH IS ESTIMATED OFF THE WHOLE STAY instead. There is no bill to
      // point at yet, and an insurer authorises the treatment rather than the
      // two days of it that have happened so far - so the desk gets the stay's
      // total as a starting figure and raises it for what the surgeon has
      // planned.
      //
      // Whole rupees, like the pending list - paise are noise on a covering
      // letter - and editable, because only this desk knows what the policy
      // actually covers.
      claimedAmount: String(Math.round(amount ?? (stage === "PRE_AUTH" ? stayTotal : finalBase))),
      admissionId: a.id,
      // Only the final claim carries the bill. A pre-auth is raised against an
      // estimate, and attaching the discharge invoice to one would have two
      // claims on this stay pointing at the same document.
      invoiceId: stage === "FINAL" ? ipdBill?.id : undefined,
    });
  }

  return (
    <PortalScroll>
      {/* header */}
      <div  className="surface dotgrid mb-5 flex flex-wrap items-start justify-between gap-4 px-6 py-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">{a.patient.fullName}</h1>
            <span className="rounded bg-[var(--p-blue-soft)] px-2 py-0.5 font-mono text-[13px] font-bold text-[var(--p-blue-deep)]">{a.ipNumber}</span>
            {discharged && <span className="rounded bg-[var(--p-bg)] px-2 py-0.5 text-[12px] font-semibold uppercase text-[var(--p-muted)]">Discharged</span>}
          </div>
          <p className="mt-1 text-[14px] text-[var(--p-muted)]">
            <span className="font-mono">{a.patient.displayId}</span> · <b className="text-[var(--p-ink)]">{bedLabel(a.wardName, a.bedNo)}</b> ·
            Dr. {a.doctor.name} ({a.doctor.department})
          </p>
          {a.reason && <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">Reason: {a.reason}</p>}
          {a.attendantName && (
            <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">
              Attendant: <b className="text-[var(--p-ink)]">{a.attendantName}</b>
              {a.attendantRelation && ` (${a.attendantRelation})`}
              {a.attendantPhone && <> · <a href={`tel:${a.attendantPhone}`} className="font-mono text-[var(--p-blue)]">{a.attendantPhone}</a></>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!discharged && (
            <button onClick={() => setAdvOpen(true)}
              title="The deposit. Comes off the discharge bill."
              className="inline-flex items-center gap-2 rounded-md border border-[var(--p-pink)] px-4 py-1.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
              <Icon name="rupee" size={15} /> Take advance
            </button>
          )}
          {!discharged && (
            <button onClick={openTransfer}
              title="Move them to another bed. The bill keeps each leg at its own rate."
              className="inline-flex items-center gap-2 rounded-md border border-[var(--p-border)] px-4 py-1.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
              <Icon name="bed" size={15} /> Transfer bed
            </button>
          )}
          {!discharged && (
            <button onClick={() => setRxOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--p-border)] px-4 py-1.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
              <Icon name="file" size={15} /> Add prescription
            </button>
          )}
          {!discharged && (
            <button onClick={() => setLabsOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--p-border)] px-4 py-1.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
              <Icon name="flask" size={15} /> Order labs
            </button>
          )}
          {/* WRITE it here; the neighbour PRINTS it. Two separate acts on the
              same record - and neither is the discharge-and-bill button, which
              closes the stay and frees the bed. */}
          {/* Only on a stay still pointed at an insurer. Once converted the
              stay is self-pay and there is nothing left to refuse.

              THE LABEL IS THE INSTRUCTION, not a status. "Insurance rejected"
              read like a button that recorded a fact, and a desk pressing it to
              note a refusal got a stay silently rebilled to the family. It says
              what it will DO now, and the dialog behind it spells out all four
              consequences before anything moves. */}
          {a.payerType === "INSURANCE" && (
            /* A BADGE, NOT A BUTTON - and it is still clickable.
               Sized and shaped like StatusPill because that is what the desk's
               eye is trained on for "where does this stay stand", and this IS a
               statement about the stay before it is an action. The hover fill is
               what stops it reading as decoration: a badge that does something
               has to say so before it is pressed, not after. */
            <button onClick={() => setRejectOpen(true)}
              title="The insurer refused - mark the claim rejected and move this stay and its bills onto the family as cash"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--p-rose-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--p-rose)] ring-1 ring-[var(--p-rose)]/30 transition-colors hover:bg-[var(--p-rose)] hover:text-white hover:ring-[var(--p-rose)]">
              <Icon name="alert" size={12} /> Rejected — convert to cash
            </button>
          )}
          <button onClick={() => setSummaryOpen(true)}
            title="Write or edit this stay's discharge summary. The insurance desk edits the same record."
            className="inline-flex items-center gap-2 rounded-md border border-[var(--p-border)] px-4 py-1.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="file" size={15} /> Discharge summary
          </button>
          <a href={`/print/discharge/${a.id}`} target="_blank" rel="noopener noreferrer"
            title={discharged ? "Print the discharge summary for this stay" : "Interim summary - the discharge document, as it stands"}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--p-border)] px-4 py-1.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="printer" size={15} /> Print summary
          </a>
          {/* ── THE BILL ITSELF, FROM THE STAY ──
              The stays LIST has always had this button and the stay's own screen
              did not, which is the wrong way round: the desk that has just
              finished reading these charges is the desk being asked for the
              bill. "Print tab" and "Print all bills" further down are different
              documents - the tab is a dated statement of position and says on
              its face that it is not a bill, and "all bills" is a run of
              separate tax invoices. This is the one sheet a TPA asks for. */}
          <a href={`/print/bill/${a.id}`} target="_blank" rel="noopener noreferrer"
            title={discharged
              ? "Print the detailed bill for this stay - the sheet the claim is raised against"
              : "Print the detailed bill as it stands - the stay is still running"}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--p-border)] px-4 py-1.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="receipt" size={15} /> Detailed bill
          </a>
          {/* ── ONCE THE INSURER IS OUT OF IT ──
              A refusal recorded here converts the stay to SELF_PAY, and the very
              next question is what the family now owes. That is a different
              document from the one above: it prices the hospital's own services,
              discounted, and leaves the pharmacy and the lab to the invoices
              their own counters raised. Offered here so the desk
              that just closed the claim does not have to walk to reception for
              the sheet that answers the call they are about to make. */}
          {a.payerType === "SELF_PAY" && (
            <a href={`/print/services-bill/${a.id}`} target="_blank" rel="noopener noreferrer"
              title="The self-pay bill - hospital services only, discounted; the pharmacy and the lab bill at their own counters"
              className="inline-flex items-center gap-2 rounded-md border border-[var(--p-border)] px-4 py-1.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
              <Icon name="receipt" size={15} /> Services bill
            </a>
          )}
          <Link href="/stays" className="inline-flex items-center gap-2 rounded-md border border-[var(--p-border)] px-4 py-1.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            Insurance stays
          </Link>
        </div>
      </div>

      {flash && (
        <div data-rise className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[14px] text-[var(--p-cyan-deep)]">
          <span className="flex items-start gap-2"><Icon name="check" size={15} /> {flash}</span>
          <span className="flex items-center gap-2">
            {/* The money has just changed hands - the slip belongs here, next to
                the confirmation, not two clicks away. */}
            {advTaken && (
              <a href={`/print/advance/${advTaken.id}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-cyan-deep)] px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90">
                <Icon name="receipt" size={13} /> Print advance receipt
              </a>
            )}
            <button onClick={() => { setFlash(null); setAdvTaken(null); }}>✕</button>
          </span>
        </div>
      )}
      {err && <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{err}</div>}

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
                      <button onClick={() => setEditingBillId(b.id)}
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
                        <button onClick={() => setEditingBillId(b.id)}
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


      {/* ── WHERE IT STANDS WITH THE INSURER ──
          On the bill's own screen, because "has this been approved" and "who am
          I billing" are the same question and they get asked while looking at
          the bill.
          Drawn when there is a claim OR when one is owed: a stay that reached
          discharge without any claim at all - admitted before pre-auths opened
          themselves, or a pre-auth nobody raised - had no section here, which is
          exactly the stay that most needs the button. */}
      {sc && (sc.claims.length > 0 || canRaisePreAuth || canRaiseFinal) && (
        <section data-rise className="surface mb-5 overflow-hidden">
          <div className="border-b border-[var(--p-border)] px-5 py-3.5">
            <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">With the insurer</h2>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {sc.claims.map((c) => (
              /* THE ACTION GETS ITS OWN ROW, not the corner of the amount cell.
                 Set-amount and Send used to live in the right-hand column - the
                 one sized to hold "₹1,60,750 claimed" - so a real call to
                 action was rendered at 12px in a narrow box with a hairline
                 border, and read as a caption. It is the only thing on this
                 screen the desk is meant to press. */
              <div key={c.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
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
                {/* The cell shows the FIGURE. Nothing to press lives here. */}
                <div className="text-right text-[12.5px]">
                  {c.status === "DRAFT" && Number(c.claimedAmount) <= 0 ? (
                    <span className="rounded bg-[var(--p-amber-soft)] px-2 py-0.5 text-[11px] font-bold uppercase text-[#8a6414]">
                      No amount — never sent
                    </span>
                  ) : (
                    <>
                      <div className="font-mono font-semibold text-[var(--p-ink)]">₹{money2(c.claimedAmount)} claimed</div>
                      {c.approvedAmount != null && (
                        <div className="text-[var(--p-muted)]">₹{money2(c.approvedAmount)} approved</div>
                      )}
                      {/* THE CO-PAY IS SAID ON THE ROW, not left to be worked
                          out by subtracting two numbers on different lines. A
                          part-approval and a co-pay look identical otherwise,
                          and only one of them is worth arguing with a TPA
                          about - the other is money to collect at the counter. */}
                      {c.copayAmount != null && Number(c.copayAmount) > 0 && (
                        <div className="text-[#8a5a14]">
                          ₹{money2(c.copayAmount)} co-pay
                          {c.copayPct != null && Number(c.copayPct) > 0 && <> ({Number(c.copayPct)}%)</>}
                          {" · the family’s"}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* ── WHAT TO DO ABOUT THIS CLAIM ──
                  A DRAFT WITH NO FIGURE IS THE COMMONEST BROKEN CLAIM HERE.
                  Every insurance admission opens one at ₹0 and nothing could
                  fill it in - claimedAmount was written once, at creation, and
                  had no update path - so the desk raised a SECOND claim and the
                  stay ended up with two. The stay's own running total is
                  offered because it is the number the desk would otherwise copy
                  off the tab by hand; it is a starting point, not the answer -
                  a pre-auth estimates the WHOLE stay, not the cost so far. */}
              {c.status === "DRAFT" && Number(c.claimedAmount) <= 0 && (
                amountFor === c.id ? (
                  <div className="mt-3 rounded-xl border border-[var(--p-blue)]/30 bg-[var(--p-blue-soft)]/50 p-3.5">
                    <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                      Amount to claim
                    </label>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] bg-white px-3 py-2.5">
                        <span className="text-[15px] font-semibold text-[var(--p-muted)]">₹</span>
                        <input autoFocus inputMode="numeric" value={claimAmt}
                          onChange={(e) => setClaimAmt(e.target.value.replace(/[^\d.]/g, ""))}
                          className="w-[150px] bg-transparent text-right font-mono text-[15px] font-semibold text-[var(--p-ink)] outline-none" />
                      </div>
                      <button onClick={() => setClaimAmountAndSubmit(c.id, false)} disabled={busy || !(Number(claimAmt) > 0)}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)] disabled:opacity-40">
                        Save only
                      </button>
                      <button onClick={() => setClaimAmountAndSubmit(c.id, true)} disabled={busy || !(Number(claimAmt) > 0)}
                        className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)] disabled:opacity-40">
                        {busy ? <Spinner size={14} /> : <Icon name="shield" size={15} />}
                        Save &amp; send to insurer
                      </button>
                      <button onClick={() => { setAmountFor(null); setClaimAmt(""); }}
                        className="text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">
                        Cancel
                      </button>
                    </div>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                      Pre-filled with what the stay has run up so far. A pre-auth covers the
                      whole stay, so raise it if more treatment is planned.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--p-amber)]/40 bg-[var(--p-amber-soft)] px-4 py-3">
                    <span className="text-[12.5px] leading-relaxed text-[#8a6414]">
                      This claim has no amount, so it has never gone to the insurer.
                    </span>
                    <button onClick={() => { setAmountFor(c.id); setClaimAmt(String(Math.round(Number(sheet.claimTotal)))); }}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]">
                      <Icon name="rupee" size={15} />
                      Set claim amount
                    </button>
                  </div>
                )
              )}

              {/* THE NEXT MOVE, ON THE SCREEN THE "TO RAISE" LIST SENDS YOU TO.
                  A pre-auth on a patient still in a bed is the whole point of a
                  pre-auth, and it could not be sent from here - only from the
                  claims board. QUERIED is the same button: the insurer asked
                  something, the desk answers and re-sends. */}
              {(c.status === "DRAFT" || c.status === "QUERIED") && Number(c.claimedAmount) > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--p-blue)]/30 bg-[var(--p-blue-soft)]/50 px-4 py-3">
                  <span className="text-[12.5px] leading-relaxed text-[var(--p-blue-deep)]">
                    {c.status === "QUERIED"
                      ? "The insurer has queried this. Answer them, then send it back."
                      : `Ready to go to the insurer for ₹${money2(c.claimedAmount)}.`}
                  </span>
                  <button onClick={() => sendClaim(c.id)} disabled={busy}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)] disabled:opacity-40">
                    {busy ? <Spinner size={14} /> : <Icon name="shield" size={15} />}
                    {c.status === "QUERIED" ? "Re-send to insurer" : "Send to insurer"}
                  </button>
                </div>
              )}
              </div>
            ))}
          </div>

          {/* ── RAISE A CLAIM ON THIS STAY - PRE-AUTH, OR THE FINAL ONE ──
              Both stages, side by side, on the screen that already carries the
              figures they are raised on. A claim could only be started from "To
              raise" - a list the desk works down by urgency - so the person who
              had just finished reading THIS stay's bills, and knew what to
              claim, had to leave, find the same patient in another list and
              start again. Prefilled from the stay, because re-keying a policy
              number off a screen that already shows it is how the wrong number
              reaches an insurer.

              THE PRE-AUTH LEAVES THIS ROW ONCE ONE EXISTS - approved above all,
              which is the moment the only claim left to send is the final one.
              The final button stays, and stands alone once it is the only one. */}
          {(canRaisePreAuth || canRaiseFinal) && (
            <div className="border-t border-[var(--p-border)] bg-[var(--p-blue-soft)]/50 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-[var(--p-blue-deep)]">
                    {finalClaimOwed
                      ? authorised === null
                        ? "Discharged and billed - nothing was ever authorised on this stay"
                        : `This stay went ₹${money2(overBy ?? 0)} over what was authorised`
                      : authorised !== null
                        ? `Authorised for ₹${money2(authorised)} - a final claim is the only one left to send`
                        : standingPreAuth
                          ? `Pre-auth ${standingPreAuth.claimNo} is already open on this stay`
                          : preAuth
                            ? `The insurer refused pre-auth ${preAuth.claimNo} - nothing stands authorised`
                            : discharged
                              ? "Nothing has been sent to the insurer on this stay yet"
                              : "Still in a bed - the pre-authorisation is the one that matters now"}
                  </p>
                  {/* THE FIGURES THE DECISION IS MADE ON, spelled out. The desk
                      compares the estimate against the bill in its head
                      otherwise, off two screens, on the one number an insurer
                      will argue about. */}
                  <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-[var(--p-blue-deep)]">
                    {authorised !== null && <>Authorised ₹{money2(authorised)} · </>}
                    {insuranceBilled > 0 ? (
                      <>
                        Billed ₹{money2(sc.insuranceBillsTotal)} across {sc.insuranceBills.length} bill
                        {sc.insuranceBills.length === 1 ? "" : "s"} pointed at {a.insurer ?? "the insurer"}.
                        {" "}
                        {authorised === null
                          ? "None of it has been asked for yet."
                          : "The authorisation settles the estimate; a final claim is for the rest."}
                      </>
                    ) : (
                      <>
                        Nothing is billed to {a.insurer ?? "the insurer"} yet - the stay has run up
                        {" ₹"}{money2(stayTotal)} so far. A pre-auth covers the WHOLE stay, so raise it for
                        what is planned rather than for what has happened.
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {/* ── THE TWO STAGES, SIDE BY SIDE ──
                      Either can be pressed. The SOLID one is the stage this stay
                      is actually at - authorising while they are in a bed,
                      claiming once they have gone home - because two identical
                      buttons make the desk read both labels every time, and that
                      is how the wrong one eventually gets pressed. */}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {canRaisePreAuth && (
                      <button onClick={() => raiseClaim("PRE_AUTH")}
                        title="Raise a pre-authorisation - an estimate for the whole stay, sent before the insurer is billed"
                        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                          discharged
                            ? "border border-[var(--p-border)] bg-white text-[var(--p-blue-deep)] hover:border-[var(--p-blue)]"
                            : "bg-[var(--p-blue)] text-white hover:bg-[var(--p-blue-deep)]"}`}>
                        <Icon name="shield" size={15} /> Pre-auth ₹{money2(stayTotal)}
                      </button>
                    )}
                    {canRaiseFinal && (
                      <button onClick={() => raiseClaim("FINAL")}
                        title="Raise the final claim - what has actually been billed to the insurer"
                        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                          discharged || !canRaisePreAuth
                            ? "bg-[var(--p-blue)] text-white hover:bg-[var(--p-blue-deep)]"
                            : "border border-[var(--p-border)] bg-white text-[var(--p-blue-deep)] hover:border-[var(--p-blue)]"}`}>
                        <Icon name="receipt" size={15} /> Final claim ₹{money2(finalBase)}
                      </button>
                    )}
                  </div>
                  {/* SOME INSURERS WANT THE WHOLE BILL, SOME WANT THE DIFFERENCE.
                      Both are one click, and both land in the same editable box. */}
                  {canRaiseFinal && overBy !== null && overBy > 1 && (
                    <button onClick={() => raiseClaim("FINAL", overBy)}
                      className="text-[11.5px] font-semibold text-[var(--p-blue-deep)] underline underline-offset-2 hover:text-[var(--p-blue)]">
                      or claim only the ₹{money2(overBy)} excess
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

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


      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
        {/* THE TAB */}
        <section data-rise className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-3.5">
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">The running tab</h3>
            <div className="flex items-center gap-2">
              {/* +1 for the bed, which is derived rather than stored, +1 more
                  on a stay old enough to still carry nursing, plus every counter
                  bill on the stay - the count has to match what is under it, and
                  what is under it now includes the bills that have already been
                  paid. */}
              <span className="badge">
                {sheet.charges.length + (sheet.counterBills?.length ?? 0) + 1 + (sheet.nursingApplies ? 1 : 0)} lines
              </span>
              {/* THE TAB, ON PAPER. Until now it existed only on this screen, so
                  a ward round asking what the stay is at, or a family wanting to
                  see the position before agreeing to another day, had to stand
                  at the terminal and left with nothing. The sheet is stamped
                  with its print time and says on its face that it is not a bill
                  - see running-tab-sheet for why that matters. */}
              {/* Every bill on the stay, in date order, dates editable. An assessor
              reads a claim chronologically and strikes off anything dated
              outside the admission window - see stayBills. */}
          <button onClick={() => { setShowBills((v) => !v); if (!bills) loadBills(); }}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="receipt" size={15} /> All bills
            {(bills?.outsideCount ?? 0) > 0 && (
              <span className="rounded-full bg-[var(--p-rose-soft)] px-1.5 py-0.5 text-[10.5px] font-bold text-[var(--p-rose)]">
                {bills!.outsideCount}
              </span>
            )}
          </button>
          <a href={`/print/tab/${a.id}`} target="_blank" rel="noopener noreferrer"
                title="Print the running tab as it stands — a dated statement of position, not a bill"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                <Icon name="printer" size={13} /> Print tab
              </a>
              {/* EVERY COUNTER'S BILL, IN ONE JOB. The rows below each print
                  their own, which is right when a family queries one line - but
                  "give me the bills" means all of them, and doing that a row at
                  a time on a week-long stay is where a pharmacy bill gets
                  missed. Each sheet in the run is still its own tax invoice. */}
              <a href={`/print/bills/${a.id}`} target="_blank" rel="noopener noreferrer"
                title="Print every bill raised against this stay — ward, pharmacy and lab, each as its own invoice"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]">
                <Icon name="receipt" size={13} /> Print all bills
              </a>
            </div>
          </div>

          <div className="divide-y divide-[var(--p-border)]">
            {/* bed is always line 1 */}
            <div className="flex items-center justify-between gap-3 bg-[var(--p-bg)] px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[var(--p-ink)]">
                  Bed charges · {bedLabel(a.wardName, a.bedNo)}
                </div>
                <div className="text-[12px] text-[var(--p-muted)]">
                  {bedDaysBilled} day{bedDaysBilled === 1 ? "" : "s"} × ₹{money(a.dailyCharge)}
                  {Number(a.gstRatePct) > 0 && ` · ${a.gstRatePct}% GST`}
                  {" · rate taken at admission"}
                </div>
                {/* A CAPPED BED SAYS SO, ON THE ROW ITSELF.
                    Without this the line reads as an ordinary bed charge that
                    has simply come out low, and the stay is billed short by
                    however many nights somebody took off it. */}
                {sheet.uncoveredDays > 0 && (
                  <div className="mt-1 text-[11.5px] font-medium text-[#8a6414]">
                    Capped — {sheet.uncoveredDays} more day{sheet.uncoveredDays === 1 ? "" : "s"} of this
                    stay {sheet.uncoveredDays === 1 ? "is" : "are"} not on any bed line. Add them to the
                    tab as their own charge.
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[14px] font-bold text-[var(--p-ink)]">₹{money(sheet.bedTotal)}</span>
                {/* Both this and the nursing row open the SAME dialog: the rate
                    and the day count are one arithmetic, and correcting a bed
                    rate without seeing what it does to the days is how a stay
                    ends up billed for a night nobody slept. */}
                <button onClick={() => setCorrectOpen(true)}
                  title="Correct the bed rate, the nursing rate or the stay's dates"
                  className="rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                  Edit
                </button>
              </div>
            </div>

            {/* NURSING - WITHDRAWN AS A SERVICE, and so drawn on no stay
                admitted since. A stay from before the withdrawal keeps its row:
                it was billed for nursing, the invoice in the family's hand says
                so, and a tab that silently dropped the line would disagree with
                the document it is supposed to explain. */}
            {sheet.nursingApplies && (
              <div className="flex items-center justify-between gap-3 bg-[var(--p-bg)] px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--p-ink)]">Nursing care</span>
                    <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">Assigned</span>
                  </div>
                  <div className="text-[12px] text-[var(--p-muted)]">
                    {sheet.days} day{sheet.days === 1 ? "" : "s"} × ₹{money(sheet.nursePerDay)} · charged automatically
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[14px] font-bold text-[var(--p-ink)]">₹{money(sheet.nurseTotal)}</span>
                  <button onClick={() => setCorrectOpen(true)}
                    title="Correct the nursing rate, the bed rate or the stay's dates"
                    className="rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                    Edit
                  </button>
                </div>
              </div>
            )}

            {/* ── ON A CLAIM, THE OTHER COUNTERS' BILLS ARE ON THIS TAB TOO ──
                Pharmacy and lab raise their own invoices against the stay. For a
                self-paying family those are three bills settled at three
                counters and they belong in the dues block, not here. For a
                cashless one they are all one claim - so they sit on the running
                tab, where the ward looks to see what the stay has cost.

                NOT EDITABLE AS TAB LINES - the amount shown here is another
                document's total, and repricing a dispense on this tab would
                decouple the bill from the stock that left the shelf. What Edit
                opens is that document itself, through the same dialog the
                pharmacy and lab counters use, so a correction lands on the bill
                that owns the lines rather than on a summary of it. */}
            {/* ── EVERY COUNTER BILL ON THIS STAY, PAID OR NOT ──
                One list, not two. This used to render `claimBills` (the
                insurer's) and then `outstandingBills` (what was still owed),
                and between them they had a hole: a bill that had been PAID was
                in neither, so a medicine settled at the pharmacy window dropped
                off the ward's tab the moment the money was taken. The tab is
                the one screen that shows what a stay has cost, and it was
                showing less than the stay had cost.

                So it now lists them all and marks each with where it stands.
                Nothing here is EDITABLE as a tab line - the amount is another
                document's total, and Edit opens that document. */}
            {(sheet.counterBills ?? []).map((b) => {
              const onClaim = b.payer === "INSURANCE";
              const tone = onClaim
                ? { bg: "bg-[var(--p-blue-soft)]/40", chip: "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]", amt: "text-[var(--p-ink)]", btn: "text-[var(--p-blue)] hover:border-[var(--p-blue)]" }
                : b.status === "PAID"
                  ? { bg: "bg-[var(--p-bg)]", chip: "bg-[var(--p-teal-soft)] text-[var(--p-teal)]", amt: "text-[var(--p-muted)]", btn: "text-[var(--p-teal)] hover:border-[var(--p-teal)]" }
                  : { bg: "bg-[var(--p-amber-soft)]/50", chip: "bg-[var(--p-amber-soft)] text-[#8a6414]", amt: "text-[#8a6414]", btn: "text-[var(--p-teal)] hover:border-[var(--p-teal)]" };
              const label = onClaim ? "On the claim" : b.status === "PAID" ? "Paid" : b.status === "PART" ? "Part paid" : "Due";
              const note = onClaim
                ? "billed to the insurer, not collected here"
                : b.status === "PAID"
                  ? "already collected at the counter"
                  : b.status === "PART"
                    ? `₹${money(b.paid)} collected, ₹${money(b.due)} still due`
                    : "settled at Billing, not on the discharge bill";
              return (
                <div key={b.id} className={`flex items-center justify-between gap-3 px-5 py-3 ${tone.bg}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-[var(--p-ink)]">
                        {b.source === "PHARMACY" ? "Pharmacy dispense" : b.source === "LAB" ? "Laboratory tests" : "Other charges"}
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${tone.chip}`}>{label}</span>
                    </div>
                    <div className="text-[12px] text-[var(--p-muted)]">
                      Bill <span className="font-mono">{b.receiptNo}</span> · {note}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* A settled bill shows what it COST, struck through as owed
                        money it is not; an open one shows what is still due. */}
                    <span className={`font-mono text-[14px] font-semibold ${tone.amt}`}>
                      ₹{money(onClaim || b.status === "PAID" ? b.total : b.due)}
                    </span>
                    <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer"
                      title="View & print this bill"
                      className={`rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium ${tone.btn}`}>
                      Bill
                    </a>
                    {canEdit && (
                      <button onClick={() => setEditingBillId(b.id)}
                        title={Number(b.paid) > 0
                          ? `Correct this bill — ₹${money(b.paid)} already collected`
                          : "Correct this bill's date, lines or amount"}
                        className={`rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium ${tone.btn}`}>
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {sheet.charges.length === 0 && (sheet.counterBills ?? []).length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-[var(--p-muted)]">
                Nothing else on the tab yet. Add procedures, oxygen, doctor rounds below -
                pharmacy medicines land here automatically.
              </p>
            ) : sheet.charges.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-[var(--p-ink)]">{c.description}</span>
                    {c.fromPharmacy && (
                      <span className="shrink-0 rounded bg-[var(--p-cyan-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-cyan-deep)]">Pharmacy</span>
                    )}
                  </div>
                  <div className="text-[12px] text-[var(--p-muted)]">
                    {CAT_LABEL[c.category] ?? c.category} · {c.qty} × ₹{money(c.unitPrice)}
                    {Number(c.gstRatePct) > 0 && ` · ${c.gstRatePct}% GST`} · {c.addedBy}
                  </div>
                  {/* WHEN IT WAS GIVEN. This desk needs the date more than the
                      ward does: a TPA checks it against the case sheet, and a
                      whole stay's treatment stamped with the one afternoon it
                      was keyed in is a query waiting to be raised. */}
                  <div className="text-[12px] text-[var(--p-muted)]">{chargeDateLabel(c.createdAt)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money(c.amount)}</span>
                  {/* Edit sits where Edit sits on the pharmacy and lab rows
                      above, and opens a dialog like they do. Still there after
                      discharge, which is when a claim is actually assembled and
                      when this desk reprices a line to the payer's own tariff -
                      see updateAdmissionCharge. */}
                  {!c.fromPharmacy && (
                    <button onClick={() => setEditingChargeId(c.id)}
                      title="Correct this line - the rate, the qty, or the date it was given"
                      className="rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                      Edit
                    </button>
                  )}
                  {!discharged && !c.fromPharmacy && (
                    <button onClick={() => removeCharge(c)} disabled={busy}
                      className="rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* add a charge */}
          {!discharged && (
            <div className="border-t border-[var(--p-border)] bg-[var(--p-bg)] p-5">
              <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Add to the tab</p>
              {/* THE RATE CARD, ahead of the free-text boxes.
                  Typing a description and a price by hand is how the same
                  procedure got billed at three different rates by three shifts,
                  and how the board on the wall and the bill at the desk drifted
                  apart with nobody able to say which was right. Picking fills
                  both; the boxes below stay editable for the genuinely one-off. */}
              {services.length > 0 && (
                <div className="mb-3">
                  <Field label="Pick from the rate card">
                    <select className={fld} value="" onChange={(e) => pickService(e.target.value)}>
                      <option value="">Choose a service, or type one below…</option>
                      {Object.keys(SERVICE_GROUP_LABEL)
                        .filter((g) => services.some((x) => x.group === g))
                        .map((g) => (
                          <optgroup key={g} label={SERVICE_GROUP_LABEL[g]}>
                            {services.filter((x) => x.group === g).map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name} — ₹{Number(x.price).toLocaleString("en-IN")}{x.perDay ? " / day" : ""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                    </select>
                  </Field>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-6">
                <div className="sm:col-span-2">
                  <Field label="What"><select className={fld} value={cat} onChange={(e) => setCat(e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
                  </select></Field>
                </div>
                <div className="sm:col-span-4">
                  <Field label="Description" required><input className={fld} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Dressing change, ECG, night nursing…" /></Field>
                </div>
                <Field label="Qty"><input className={fld} value={qty} inputMode="numeric" onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} /></Field>
                <div className="sm:col-span-2">
                  <Field label="Rate (₹)" required><input className={fld} value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
                </div>
                <Field label="GST %"><input className={fld} value={gst} inputMode="decimal" onChange={(e) => setGst(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
                <div className="flex items-end sm:col-span-2">
                  <button onClick={() => addCharge()} disabled={busy || !desc.trim() || !price}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                    {busy ? <Spinner /> : <Icon name="plus" size={14} />} Add ₹{money(lineTotal)}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[12px] text-[var(--p-muted)]">
                Most hospital services are GST-exempt - leave it 0 unless your CA says otherwise.
              </p>
            </div>
          )}
        </section>

        {/* NURSING / OBSERVATION NOTES - shift handover text, not billed */}
        <section data-rise className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-3.5">
            <div>
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Nursing &amp; observation notes</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Shift handover - vitals, intake, how the night went. Each entry is kept with the name and time it was written; nothing here can be edited or removed.</p>
            </div>
            <span className="rounded bg-[var(--p-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--p-muted)]">
              {sheet.notes.length} {sheet.notes.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <div className="p-5">
            {/* The chronology. A correction is a NEW entry saying what it
                corrects - the same as on paper, and the reason there is no
                edit button on any of these rows. */}
            {sheet.notes.length > 0 ? (
              <ol className="mb-4 flex flex-col gap-3">
                {sheet.notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-[var(--p-border)] pl-3">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[11px] tabular-nums text-[var(--p-muted)]">
                        {new Date(n.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="text-[11px] font-semibold text-[var(--p-ink)]">
                        {n.authorName ?? "Author not recorded"}
                      </span>
                      {n.kind === "DISCHARGE" && (
                        <span className="rounded bg-[var(--p-bg)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">On discharge</span>
                      )}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--p-ink)]">{n.body}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mb-4 text-[13px] text-[var(--p-muted)]">No notes recorded on this stay yet.</p>
            )}

            {!discharged && (
              <>
                <textarea
                  value={notes}
                  onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
                  rows={3}
                  placeholder="e.g. 08:00 - BP 130/80, afebrile, tolerating orals."
                  className="w-full resize-y rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm leading-relaxed text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]" />
                <div className="mt-3 flex items-center justify-end gap-3">
                  {notesDirty && <button onClick={() => { setNotes(""); setNotesDirty(false); }} className="text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Clear</button>}
                  <button onClick={saveNotes} disabled={savingNotes || !notes.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                    {savingNotes ? <><Spinner /> Adding…</> : <><Icon name="check" size={14} /> Add note</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* PATIENT HISTORY - billings, lab reports, prescriptions (like the profile) */}
        {/* Extracted so the insurance desk gets the same record on its own
            stay page - see PatientHistoryPanel. */}
        <PatientHistoryPanel
          admissionId={admissionId}
          canEdit={canEdit}
          onEditBill={setEditingBillId}
          reloadToken={historyToken}
        />
        </div>

        {/* TOTAL */}
        <aside data-rise className="surface h-fit overflow-hidden lg:sticky lg:top-4">
          <div className="border-b border-[var(--p-border)] px-5 py-3.5">
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">{discharged ? "Final bill" : "Running total"}</h3>
          </div>
          <div className="space-y-2.5 p-5">
            {/* Each leg of the stay, priced at the rate it actually carried. Two
                rows here means the patient was moved - and the bill says so. */}
            {sheet.legs.length > 1 ? (
              sheet.legs.map((l, i) => (
                <div key={i} className="flex items-center justify-between text-[14px]">
                  <span className="min-w-0 text-[var(--p-muted)]">
                    <span className="text-[var(--p-ink)]">{bedLabel(l.wardName, l.bedNo)}</span>
                    <span className="ml-1 text-[12px]">({l.days}d × ₹{money(l.dailyCharge)})</span>
                    {l.current && <span className="ml-1 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--p-blue)]">now</span>}
                    {l.current && i > 0 && !discharged && (
                      <button onClick={() => setUndoOpen(true)} disabled={busy}
                        title="Entered by mistake? Send them back to the previous bed and take this leg off the bill."
                        className="ml-1.5 align-middle rounded border border-[var(--p-border)] px-1.5 py-[1px] text-[10px] font-semibold text-[var(--p-muted)] transition hover:border-[var(--p-rose)] hover:text-[var(--p-rose)] disabled:opacity-40">
                        Remove
                      </button>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[var(--p-ink)]">₹{money(l.total)}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-[var(--p-muted)]">Bed ({sheet.days}d)</span>
                <span className="font-mono text-[var(--p-ink)]">₹{money(sheet.bedTotal)}</span>
              </div>
            )}

            {sheet.nursingApplies && (
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-[var(--p-muted)]">Nursing ({sheet.days}d × ₹{money(sheet.nursePerDay)})</span>
                <span className="font-mono text-[var(--p-ink)]">₹{money(sheet.nurseTotal)}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-[14px]">
              <span className="text-[var(--p-muted)]">Charges ({sheet.charges.length})</span>
              <span className="font-mono text-[var(--p-ink)]">₹{money(sheet.chargesTotal)}</span>
            </div>

            {/* PHARMACY AND LAB ARE BILLED SEPARATELY, and are itemised on the
                tab above. This is the WARNING, not a second copy of the list:
                the figure that blocks a discharge, and why. */}
            {sheet.outstandingBills?.length > 0 && (
              <div className="rounded-lg border border-[var(--p-amber)]/35 bg-[var(--p-amber-soft)] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold uppercase tracking-wide text-[#8a6414]">
                    Due separately ({sheet.outstandingBills.length})
                  </span>
                  <span className="font-mono text-[14px] font-bold text-[#8a6414]">₹{money(sheet.outstandingTotal)}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[#8a6414]">
                  Not part of the discharge bill and not in the total below. Collect them on
                  <b> Billing</b>, where this patient&apos;s bills settle in one payment - the lab
                  window takes no money. Discharge is blocked until they are.
                </p>
              </div>
            )}

            {/* The claim's pharmacy and lab are ON THE TAB above, not in their
                own box down here - they are part of what the stay cost, and a
                second list of the same figures would just invite a reader to
                check whether the two agree. This total already includes them. */}
            <div className="flex items-center justify-between border-t border-[var(--p-border)] pt-3">
              <span className="text-[14px] font-semibold text-[var(--p-ink)]">Total so far</span>
              <span className="font-mono text-[18px] font-bold text-[var(--p-ink)]">₹{money(sheet.claimTotal ?? sheet.grandTotal)}</span>
            </div>
            {Number(sheet.claimBillsTotal ?? 0) > 0 && (
              <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
                Includes ₹{money(sheet.claimBillsTotal)} of pharmacy and lab billed to the insurer.
                None of it is collected at a counter.
              </p>
            )}

            {/* The deposit. Reception took this money - it must be visible, or
                they'll ask the family for the full total at discharge. */}
            {Number(sheet.advanceTotal) > 0 && (
              <>
                <div className="flex items-center justify-between text-[14px]">
                  <span className="text-[var(--p-muted)]">Advance already taken</span>
                  <span className="font-mono font-semibold text-[var(--p-cyan-deep)]">−₹{money(sheet.advanceTotal)}</span>
                </div>
                {/* Every slip, reprintable. The flash banner is gone the moment
                    the page reloads, and families lose bits of paper. */}
                {sheet.advances.length > 0 && (
                  <div className="space-y-1 rounded-lg border border-[var(--p-border)] px-3 py-2">
                    {sheet.advances.map((adv) => (
                      <div key={adv.id} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="min-w-0 truncate text-[var(--p-muted)]">
                          <span className="font-mono">{adv.receiptNo ?? "Not numbered"}</span>
                          {" · "}₹{money(adv.amount)}{" · "}{adv.mode}
                        </span>
                        <a href={`/print/advance/${adv.id}`} target="_blank" rel="noopener noreferrer"
                          className="shrink-0 font-semibold text-[var(--p-teal)] hover:underline">Print</a>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg bg-[var(--p-teal-soft)] px-3 py-2.5">
                  <span className="text-[14px] font-bold text-[var(--p-ink)]">Still to pay</span>
                  <span className="font-mono text-[20px] font-bold text-[var(--p-teal-deep)]">₹{money(sheet.balance)}</span>
                </div>
                {Number(sheet.advanceTotal) > Number(sheet.grandTotal) && (
                  <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[12px] leading-relaxed text-[#8a6414]">
                    <b>The advance is larger than the bill.</b> ₹{money(String(Number(sheet.advanceTotal) - Number(sheet.grandTotal)))} must
                    be <b>refunded</b> at discharge - not kept.
                  </p>
                )}
              </>
            )}
            <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
              {discharged
                ? "This stay is closed. The invoice was raised at discharge."
                : "Bed charges grow each day. GST is applied per line at discharge - the room and a 12% syrup aren't taxed the same."}
            </p>
          </div>
          {!discharged && (
            <div className="border-t border-[var(--p-border)] p-5">
              <Link href="/stays"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--p-blue-deep)]">
                <Icon name="receipt" size={15} /> Discharge &amp; bill
              </Link>
              <p className="mt-2 text-center text-[12px] text-[var(--p-muted)]">Everything above goes on one invoice.</p>
            </div>
          )}
        </aside>
      </div>

      {/* IP PRESCRIPTION */}
      {rxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="surface flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Prescription for {a.patient.fullName}</h3>
                <p className="text-[13px] text-[var(--p-muted)]">{a.ipNumber} · Dr. {a.doctor.name}&apos;s round</p>
              </div>
              <button onClick={() => setRxOpen(false)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>

            <div className="flex-1 w-full space-y-4 overflow-y-auto p-6">
              <div className="w-full" >
                <p className="mb-1.5  text-[13px] font-medium text-[var(--p-text)]">Scan of the chit <span className="text-[var(--p-muted)]">(optional)</span></p>
                <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <div className="flex items-center gap-2">
                  <button onClick={() => fileRef.current?.click()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--p-border-strong)] px-4 py-6 text-[14px] text-[var(--p-muted)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="file" size={16} />
                    {file ? <span className="font-medium text-[var(--p-ink)]">{file.name}</span> : "PDF, JPG or PNG - up to 10MB, or skip and just type the medicines"}
                  </button>
                  {file && <button onClick={() => setFile(null)} className="shrink-0 rounded-lg border border-[var(--p-border)] px-2.5 py-2 text-[12px] text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">Clear</button>}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[13px] font-medium text-[var(--p-text)]">Type the medicines</p>
                <div className="space-y-2">
                  {rxItems.map((r, i) => {
                    const match = meds.find((m) => m.name.toLowerCase() === r.name.trim().toLowerCase());
                    return (
                      <div key={i} className="flex gap-2">
                        <div className="relative flex-1">
                          <input list={`meds-${i}`} className="w-full min-w-[350px] rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]" value={r.name} placeholder="Medicine name"
                            onChange={(e) => {
                              const v = e.target.value;
                              const m = meds.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
                              const next = [...rxItems];
                              next[i] = { ...next[i], name: v, medicineId: m?.id ?? null };
                              setRxItems(next);
                            }} />
                          <datalist id={`meds-${i}`}>
                            {meds.map((m) => <option key={m.id} value={m.name}>{m.inStock} {m.unit}s in stock</option>)}
                          </datalist>
                          {r.name.trim() && (
                            <span className={`absolute right-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${match ? "bg-[var(--p-cyan)]" : "bg-[var(--p-amber)]"}`}
                              title={match ? "In the catalog - pharmacy gets it pre-filled" : "Free text - pharmacy will type it"} />
                          )}
                        </div>
                        <input className={`${fld} w-16`} value={r.qty} inputMode="numeric" placeholder="Qty"
                          onChange={(e) => { const n = [...rxItems]; n[i] = { ...n[i], qty: e.target.value.replace(/\D/g, "") }; setRxItems(n); }} />
                        <input className={`${fld} w-32`} value={r.dosage} placeholder="1-0-1"
                          onChange={(e) => { const n = [...rxItems]; n[i] = { ...n[i], dosage: e.target.value }; setRxItems(n); }} />
                        <button onClick={() => setRxItems(rxItems.filter((_, j) => j !== i))} disabled={rxItems.length === 1}
                          className="rounded-lg border border-[var(--p-border)] px-2 text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)] disabled:opacity-30">✕</button>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setRxItems([...rxItems, { name: "", medicineId: null, qty: "1", dosage: "" }])}
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--p-blue)]">
                  <Icon name="plus" size={12} /> Another medicine
                </button>
              </div>

              <p className="rounded-lg bg-[var(--p-cyan-soft)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--p-cyan-deep)]">
                <b>This patient is admitted</b>, so the pharmacy will <b>charge the medicines to this room</b> instead of
                taking money at the counter. They&apos;ll appear on the tab and settle in the discharge bill.
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => setRxOpen(false)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
              <button onClick={() => uploadRx(false)} disabled={busy || (!file && !rxItems.some((r) => r.name.trim()))}
                className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] disabled:opacity-40">
                Save only
              </button>
              <button onClick={() => uploadRx(true)} disabled={busy || (!file && !rxItems.some((r) => r.name.trim()))}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Sending…</> : <><Icon name="check" size={15} /> Send to pharmacy</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── ORDER LABS ─────────── */}
      {labsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setLabsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="surface flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Order lab tests</h3>
                <p className="text-[13px] text-[var(--p-muted)]">{a.ipNumber} · {a.patient.fullName}</p>
              </div>
              <button onClick={() => setLabsOpen(false)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>
            <div className="border-b border-[var(--p-border)] px-6 py-3">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3 py-2">
                <span className="text-[var(--p-muted)]"><Icon name="search" size={15} /></span>
                <input value={labQuery} onChange={(e) => setLabQuery(e.target.value)} placeholder="Search tests…" className="w-full bg-transparent text-sm text-[var(--p-ink)] outline-none" autoFocus />
              </div>
            </div>
            <div className="flex-1 divide-y divide-[var(--p-border)] overflow-y-auto">
              {labCatalog.filter((c) => c.name.toLowerCase().includes(labQuery.trim().toLowerCase())).map((c) => {
                const on = labPick.has(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => setLabPick((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                    className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left hover:bg-[var(--p-bg)]">
                    <span className="flex items-center gap-3">
                      <span className={`grid h-5 w-5 place-items-center rounded border ${on ? "border-[var(--p-blue)] bg-[var(--p-blue)] text-white" : "border-[var(--p-border-strong)]"}`}>{on && <Icon name="check" size={12} />}</span>
                      <span><span className="block text-[14px] font-medium text-[var(--p-ink)]">{c.name}</span>{c.code && <span className="block font-mono text-[11px] text-[var(--p-muted)]">{c.code}</span>}</span>
                    </span>
                    <span className="font-mono text-[13px] text-[var(--p-ink)]">₹{money(c.price)}</span>
                  </button>
                );
              })}
              {labCatalog.length === 0 && <p className="px-6 py-8 text-center text-[13px] text-[var(--p-muted)]">No tests in the catalog.</p>}
            </div>
            <p className="mx-6 my-3 rounded-lg bg-[var(--p-cyan-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--p-cyan-deep)]">
              Charged to the room - no money at the lab counter. The test is queued for the lab; its report uploads from the Labs portal and shows on the discharge summary.
            </p>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--p-border)] p-5">
              <span className="text-[13px] text-[var(--p-muted)]">{labPick.size} selected · <span className="font-mono font-semibold text-[var(--p-ink)]">₹{money(labPickTotal)}</span></span>
              <div className="flex gap-2">
                <button onClick={() => setLabsOpen(false)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
                <button onClick={() => orderLabs()} disabled={busy || labPick.size === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                  {busy ? <><Spinner /> Ordering…</> : <><Icon name="flask" size={15} /> Order &amp; charge room</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── TRANSFER ───────────
          The bill keeps EACH LEG at its own rate. Three days in General then four
          in ICU is billed as exactly that - not seven days at whichever rate
          happened to be last. */}
      {/* ─────────── UNDO A TRANSFER ─────────── */}
      {undoOpen && sheet && sheet.legs.length > 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setUndoOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-md overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Remove this transfer</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                For a move that was entered by mistake - not for a patient who really did change beds.
              </p>
            </div>

            <div className="space-y-3 p-5 text-[13px] leading-relaxed text-[var(--p-text)]">
              <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-3 py-2.5">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="font-semibold text-[var(--p-ink)]">{bedLabel(sheet.legs[sheet.legs.length - 1].wardName, sheet.legs[sheet.legs.length - 1].bedNo)}</span>
                  <span className="text-[var(--p-muted)]">→</span>
                  <span className="font-semibold text-[var(--p-ink)]">{bedLabel(sheet.legs[sheet.legs.length - 2].wardName, sheet.legs[sheet.legs.length - 2].bedNo)}</span>
                </div>
                <p className="mt-1 text-[12px] text-[var(--p-muted)]">
                  The bed they are in now goes back to free, and the earlier one is theirs again.
                </p>
              </div>

              <ul className="space-y-1.5 text-[12px] text-[var(--p-muted)]">
                <li>· The bed charge is recalculated on the earlier ward&apos;s rate for the whole stay.</li>
                <li>· The chronology keeps both the move and this removal. Nothing is erased.</li>
                <li>· Only the most recent move can be removed this way.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
              <button onClick={() => setUndoOpen(false)} className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Keep it</button>
              <button onClick={doUndoTransfer} disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Removing…</> : <>Remove the transfer</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {xferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setXferOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-md overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Move to another bed</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                Currently {bedLabel(a.wardName, a.bedNo)}. Only free beds are offered.
              </p>
            </div>

            <div className="space-y-4 p-5">
              {xferWards.length === 0 ? (
                <p className="rounded-lg bg-[var(--p-bg)] px-4 py-3 text-[13px] text-[var(--p-muted)]">
                  No free beds anywhere in the hospital.
                </p>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-[var(--p-text)]">Where to?</label>
                    <select value={xferBed} onChange={(e) => setXferBed(e.target.value)}
                      className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]">
                      {xferWards.map((w) => (
                        <optgroup key={w.id} label={`${w.name} - ₹${Number(w.dailyCharge).toLocaleString("en-IN")}/day`}>
                          {w.beds.map((b) => <option key={b.id} value={b.id}>{bedLabel(w.name, b.bedNo)}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-[var(--p-text)]">Why? (optional)</label>
                    <input value={xferReason} onChange={(e) => setXferReason(e.target.value)}
                      placeholder="Condition worsened · needs monitoring"
                      className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--p-blue)]" />
                  </div>

                  <p className="rounded-lg bg-[var(--p-blue-soft)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--p-text)]">
                    <b>The days already spent keep their old rate.</b> The new ward&apos;s rate applies from
                    today onward, and the discharge bill shows both legs separately - which is what
                    actually happened, and what they should pay.
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
              <button onClick={() => setXferOpen(false)} className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Cancel</button>
              <button onClick={doTransfer} disabled={busy || !xferBed}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Moving…</> : <><Icon name="bed" size={14} /> Move them</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── ADVANCE ─────────── */}
      {advOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAdvOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-sm overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Take an advance</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                The deposit. It comes straight off the discharge bill.
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--p-text)]">Amount</label>
                <input value={advAmt} inputMode="decimal"
                  onChange={(e) => setAdvAmt(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="10000"
                  className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2.5 text-center font-mono text-[18px] font-semibold text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--p-text)]">How did they pay?</label>
                <div className="flex flex-wrap gap-2">
                  {(["CASH", "UPI", "CARD", "NETBANKING"] as const).map((m) => (
                    <button key={m} onClick={() => setAdvMode(m)}
                      className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                        advMode === m
                          ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white"
                          : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-teal)]"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <p className="rounded-lg bg-[var(--p-bg)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--p-muted)]">
                If the advance ends up larger than the final bill, the difference is
                <b className="text-[var(--p-ink)]"> refunded</b> - not kept.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
              <button onClick={() => setAdvOpen(false)} className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Cancel</button>
              <button onClick={doAdvance} disabled={busy || !(Number(advAmt) > 0)}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Recording…</> : <>Take ₹{Number(advAmt || 0).toLocaleString("en-IN")}</>}
              </button>
            </div>
          </div>
        </div>
      )}
      {summaryOpen && (
        <DischargeSummaryForm admissionId={a.id} onClose={() => setSummaryOpen(false)} />
      )}

      {/* The same dialog every other desk corrects a bill with. Both loads are
          refreshed on save: the running tab shows these bills' totals and the
          history tab lists them, so refreshing one would leave the other
          showing the figure that was just corrected. */}
      {editingBillId && (
        <EditBillDialog
          invoiceId={editingBillId}
          accent="teal"
          onClose={() => setEditingBillId(null)}
          onSaved={() => { setEditingBillId(null); load(); loadHistory(); }}
        />
      )}

      {/* Bed rate, nursing rate and the stay's dates. Reloads the history too:
          on a discharged stay this re-issues the IPD invoice, which is one of
          the bills listed there. */}
      {rejectOpen && (
        <ConvertToSelfPayDialog
          admissionId={a.id}
          ipNumber={a.ipNumber}
          insurer={a.insurer}
          onClose={() => setRejectOpen(false)}
          onDone={(msg) => { setRejectOpen(false); setFlash(msg); load(); loadHistory(); }}
        />
      )}

      {correctOpen && (
        <CorrectStayDialog
          admissionId={a.id}
          accent="teal"
          stay={{
            admittedAt: a.admittedAt,
            dischargedAt: a.dischargedAt,
            status: a.status,
            dailyCharge: a.dailyCharge,
            nursePerDay: sheet.nursePerDay,
            nursingApplies: sheet.nursingApplies,
            legs: sheet.legs,
          }}
          onClose={() => setCorrectOpen(false)}
          onSaved={(msg) => { setCorrectOpen(false); setFlash(msg); load(); loadHistory(); }}
        />
      )}

      {/* The claim form the whole portal raises claims with - same component,
          same rules, prefilled from this stay. It opens a DRAFT: sending it to
          the insurer is the next step, and it is done from the row this reload
          puts on the screen above. */}
      {raising && (
        <NewClaim
          apiBase="/insurance"
          insurers={insurers}
          prefill={raising}
          onClose={() => setRaising(null)}
          onCreated={(c) => {
            setRaising(null);
            setFlash(`${c.stage === "PRE_AUTH" ? "Pre-auth" : "Final claim"} ${c.claimNo} raised for ₹${money2(c.claimedAmount)} - it is a draft until you send it to the insurer.`);
            load();
          }}
        />
      )}

      {/* One tab line - its figures and its date. The bills are reloaded too:
          repricing a discharged stay re-issues the IPD invoice, which is one of
          the documents this desk is looking at. */}
      {editingCharge && (
        <CorrectChargeDialog
          charge={editingCharge}
          admittedAt={a.admittedAt}
          dischargedAt={a.dischargedAt}
          discharged={discharged}
          accent="teal"
          onClose={() => setEditingChargeId(null)}
          onSaved={(msg) => { setEditingChargeId(null); setFlash(msg); load(); loadHistory(); }}
        />
      )}
      {repeat && (
        <RepeatConfirmDialog
          block={repeat.block} message={repeat.message} busy={busy}
          onConfirm={() => repeat.retry()}
          onClose={() => setRepeat(null)}
        />
      )}
    </PortalScroll>
  );
}
