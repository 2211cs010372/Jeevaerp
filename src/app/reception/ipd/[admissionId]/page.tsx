"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { DischargeSummaryForm } from "@/components/portal/ipd/discharge-summary-form";
import { CorrectStayDialog, type StayLeg } from "@/components/portal/ipd/correct-stay-dialog";
import { CorrectChargeDialog, chargeDateLabel } from "@/components/portal/ipd/correct-charge-dialog";
import { ConvertToSelfPayDialog } from "@/components/portal/ipd/convert-to-self-pay-dialog";
import { api, ApiClientError } from "@/lib/api-client";
import { bedLabel } from "@/lib/beds";
import { EditBillDialog, useBillEditing } from "@/components/portal/billing/edit-bill-dialog";
import { PatientHistoryPanel } from "@/components/portal/ipd/patient-history-panel";

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
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export default function AdmissionSheetPage() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    setLoading(true);
    try { setSheet(await api.get<Sheet>(`/ipd/admissions/${admissionId}/sheet`)); }
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

  async function orderLabs() {
    if (!sheet || labPick.size === 0) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/labs/tests/order", { patientId: sheet.admission.patient.id, catalogIds: [...labPick] });
      setFlash(`${labPick.size} test${labPick.size === 1 ? "" : "s"} ordered - charged to the room and queued for the lab.`);
      setLabsOpen(false); setLabPick(new Set()); setLabQuery("");
      await load(); loadHistory();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not order the tests."); }
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

  async function addCharge() {
    if (!desc.trim() || !price) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/ipd/admissions/${admissionId}/charges`, {
        category: cat, description: desc.trim(),
        qty: Number(qty || 1), unitPrice: Number(price), gstRatePct: Number(gst || 0),
      });
      setFlash(`₹${money(lineTotal)} added to the tab.`);
      setDesc(""); setQty("1"); setPrice(""); setGst("0");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not add the charge."); }
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
          {/* THE STAY'S DATES, WHERE SOMEBODY ACTUALLY LOOKS FOR THEM.
              The admission date was on this screen nowhere at all, and the only
              way to correct it was the Edit button on the BED CHARGES row -
              which is where the arithmetic belongs, but not where anybody looks
              for a date. The commonest correction on this page is a patient
              admitted at 11pm and typed in the next morning, and finding it
              should not depend on knowing that the bed-rate dialog also owns
              the clock.

              SAME DIALOG, SECOND DOOR - and deliberately not a second editor.
              The day count, every bed leg and, on a discharged stay, the
              re-issued invoice all move with these dates. A lighter "just the
              date" form here would be a way to change the bill without seeing
              what it did to it, which is the whole thing CorrectStayDialog's
              live preview exists to prevent. */}
          <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">
            Admitted <b className="text-[var(--p-ink)]">{chargeDateLabel(a.admittedAt)}</b>
            {a.dischargedAt && (
              <> · Discharged <b className="text-[var(--p-ink)]">{chargeDateLabel(a.dischargedAt)}</b></>
            )}
            {" · "}
            <button
              onClick={() => setCorrectOpen(true)}
              title="Correct the stay's dates - the day count, the bed lines and the bill move with them"
              className="font-semibold text-[var(--p-teal)] underline underline-offset-2 hover:text-[var(--p-ink)]"
            >
              Edit dates
            </button>
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
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
              <Icon name="rupee" size={15} /> Take advance
            </button>
          )}
          {!discharged && (
            <button onClick={openTransfer}
              title="Move them to another bed. The bill keeps each leg at its own rate."
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
              <Icon name="bed" size={15} /> Transfer bed
            </button>
          )}
          {!discharged && (
            <button onClick={() => setRxOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
              <Icon name="file" size={15} /> Add prescription
            </button>
          )}
          {!discharged && (
            <button onClick={() => setLabsOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
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
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="file" size={15} /> Discharge summary
          </button>
          <a href={`/print/discharge/${a.id}`} target="_blank" rel="noopener noreferrer"
            title={discharged ? "Print the discharge summary for this stay" : "Interim summary - the discharge document, as it stands"}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="printer" size={15} /> Print summary
          </a>
          <Link href="/ipd/inpatients" className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            Inpatients
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
              {/* ── THE SELF-PAY BILL, IN THE IP BILL'S OWN FORMAT ──
                  The detailed bill is unchanged and still the claim sheet: one
                  gross figure, the discount off the bottom, a number for a TPA.
                  This is the same stay split the way the counter argues it -
                  the hospital's own services discounted, the pharmacy and the
                  lab at cost, and every rupee already paid at those windows
                  taken off what is asked for now.

                  SELF-PAYING STAYS ONLY, and that includes one an insurer
                  refused: the conversion flips payerType, so by the time the
                  family is being asked for cash this is exactly what the stay
                  is. On a live cashless stay the sheet would ask a family for
                  money the insurer is carrying, and the service refuses it. */}
              {a.payerType === "SELF_PAY" && (
                <a href={`/print/services-bill/${a.id}`} target="_blank" rel="noopener noreferrer"
                  title="The self-pay bill — hospital services only, discounted; the pharmacy and the lab bill at their own counters"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                  <Icon name="receipt" size={13} /> Services bill
                </a>
              )}
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
                  {/* WHEN IT WAS GIVEN - the date the printed tab puts against
                      this line, and until now the one thing on the row nobody
                      could fix. A morning's work keyed in at 4pm printed as four
                      days of treatment under one timestamp. */}
                  <div className="text-[12px] text-[var(--p-muted)]">{chargeDateLabel(c.createdAt)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money(c.amount)}</span>
                  {/* Edit sits where Edit sits on the pharmacy and lab rows
                      above, and opens a dialog like they do. Still there after
                      discharge, deliberately: that is when somebody reads the
                      printed sheet and notices. The dialog itself says which
                      corrections re-issue the discharge bill and which do not -
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
                  <button onClick={addCharge} disabled={busy || !desc.trim() || !price}
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
        <aside data-rise className="surface h-fit overflow-hidden lg:sticky lg:top-20">
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
              <Link href="/ipd/inpatients"
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
                <button onClick={orderLabs} disabled={busy || labPick.size === 0}
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

      {/* One tab line - its figures and its date. The history tab is reloaded
          too: repricing a discharged stay re-issues the IPD invoice, which is
          one of the bills listed there. */}
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
    </PortalScroll>
  );
}
