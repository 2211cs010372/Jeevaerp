"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";

interface Charge {
  id: string; category: string; description: string; qty: number;
  unitPrice: string; gstRatePct: string; amount: string;
  addedBy: string; createdAt: string; fromPharmacy: boolean;
}
interface Sheet {
  admission: {
    id: string; ipNumber: string; status: string; admittedAt: string; reason: string | null;
    wardName: string; bedNo: string; dailyCharge: string; gstRatePct: string;
    attendantName: string | null; attendantPhone: string | null; attendantRelation: string | null;
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
    doctor: { name: string; department: string };
  };
  days: number; bedTotal: string; charges: Charge[]; chargesTotal: string; grandTotal: string;
  nurseTotal: string; nursePerDay: string; notes: string | null;
  /** One row per bed occupied. Two rows = they were transferred mid-stay. */
  legs: { wardName: string; bedNo: string; dailyCharge: string; days: number; total: string; current: boolean }[];
  advanceTotal: string;
  /** Each deposit slip taken on this stay - listed so any can be reprinted. */
  advances: (Advance & { takenAt: string })[];
  balance: string;
}
interface Med { id: string; name: string; unit: string; inStock: number; }
/** One deposit slip. `receiptNo` is what the family quotes at discharge. */
interface Advance { id: string; receiptNo: string; amount: string; mode: string; }
interface History {
  bills: { id: string; receiptNo: string; source: string; status: string; total: string; paid: string; balance: string; date: string }[];
  labs: { id: string; testName: string; status: string; reportReady: boolean; reportUrl: string | null; date: string; forThisStay: boolean }[];
  prescriptions: { id: string; title: string | null; fileUrl: string | null; status: string; forThisStay: boolean; date: string; items: { medicineName: string; qty: number; dosage: string | null }[] }[];
}
const SRC_LABEL: Record<string, string> = { CONSULTATION: "Consultation", LAB: "Laboratory", PHARMACY: "Pharmacy", IPD: "Inpatient", OTHER: "Other" };
const prettyDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

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

  // add-charge form
  const [cat, setCat] = useState("PROCEDURE");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [gst, setGst] = useState("0");

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
  const [labPick, setLabPick] = useState<Set<string>>(new Set());
  const [labQuery, setLabQuery] = useState("");

  // ── HISTORY ── the patient's billings, lab reports and pharmacy record.
  const [history, setHistory] = useState<History | null>(null);
  const [historyTab, setHistoryTab] = useState<"bills" | "labs" | "rx">("bills");
  const loadHistory = useCallback(() => {
    api.get<History>(`/ipd/admissions/${admissionId}/history`).then(setHistory).catch(() => {});
  }, [admissionId]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSheet(await api.get<Sheet>(`/ipd/admissions/${admissionId}/sheet`)); }
    catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't load the sheet."); }
    finally { setLoading(false); }
  }, [admissionId]);
  useEffect(() => { load(); }, [load]);

  // Seed the notes editor from the loaded sheet, unless the user is mid-edit.
  useEffect(() => {
    if (sheet && !notesDirty) setNotes(sheet.notes ?? "");
  }, [sheet, notesDirty]);

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
    setSavingNotes(true); setErr(null);
    try {
      await api.patch(`/ipd/admissions/${admissionId}/notes`, { notes });
      setNotesDirty(false);
      setFlash("Notes saved to the stay.");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not save the notes."); }
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
            <span className="font-mono">{a.patient.displayId}</span> · {a.wardName} · Bed <b className="text-[var(--p-ink)]">{a.bedNo}</b> ·
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
          <a href={`/print/discharge/${a.id}`} target="_blank" rel="noopener noreferrer"
            title={discharged ? "The discharge summary for this stay" : "Interim summary - the discharge document, as it stands"}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
            <Icon name="file" size={15} /> Discharge summary
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
            <span className="badge">{sheet.charges.length + 2} lines</span>
          </div>

          <div className="divide-y divide-[var(--p-border)]">
            {/* bed is always line 1 */}
            <div className="flex items-center justify-between gap-3 bg-[var(--p-bg)] px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[var(--p-ink)]">
                  Bed charges · {a.wardName} · {a.bedNo}
                </div>
                <div className="text-[12px] text-[var(--p-muted)]">
                  {sheet.days} day{sheet.days === 1 ? "" : "s"} × ₹{money(a.dailyCharge)}
                  {Number(a.gstRatePct) > 0 && ` · ${a.gstRatePct}% GST`}
                  {" · rate locked at admission"}
                </div>
              </div>
              <span className="font-mono text-[14px] font-bold text-[var(--p-ink)]">₹{money(sheet.bedTotal)}</span>
            </div>

            {/* nursing care - assigned by default, accrues per day like the bed */}
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
              <span className="font-mono text-[14px] font-bold text-[var(--p-ink)]">₹{money(sheet.nurseTotal)}</span>
            </div>

            {sheet.charges.length === 0 ? (
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
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money(c.amount)}</span>
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
              <div className="grid gap-3 sm:grid-cols-6">
                <div className="sm:col-span-2">
                  <Field label="What"><select className={fld} value={cat} onChange={(e) => setCat(e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
                  </select></Field>
                </div>
                <div className="sm:col-span-4">
                  <Field label="Description"><input className={fld} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Dressing change, ECG, night nursing…" /></Field>
                </div>
                <Field label="Qty"><input className={fld} value={qty} inputMode="numeric" onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} /></Field>
                <div className="sm:col-span-2">
                  <Field label="Rate (₹)"><input className={fld} value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
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
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Shift handover - vitals, intake, how the night went. Not billed; carried onto the discharge summary.</p>
            </div>
            {notesDirty && <span className="rounded bg-[var(--p-amber-soft)] px-2 py-0.5 text-[11px] font-semibold text-[#8a6414]">Unsaved</span>}
          </div>
          <div className="p-5">
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
              disabled={discharged}
              rows={5}
              placeholder="e.g. 08:00 - BP 130/80, afebrile, tolerating orals. 14:00 - dressing changed, wound clean…"
              className="w-full resize-y rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm leading-relaxed text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)] disabled:opacity-60" />
            {!discharged && (
              <div className="mt-3 flex items-center justify-end gap-3">
                {notesDirty && <button onClick={() => { setNotes(sheet.notes ?? ""); setNotesDirty(false); }} className="text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Discard</button>}
                <button onClick={saveNotes} disabled={savingNotes || !notesDirty}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                  {savingNotes ? <><Spinner /> Saving…</> : <><Icon name="check" size={14} /> Save notes</>}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* PATIENT HISTORY - billings, lab reports, prescriptions (like the profile) */}
        <section data-rise className="surface overflow-hidden">
          <div className="border-b border-[var(--p-border)] px-5 py-3.5">
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Patient history</h3>
            <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Billings, lab reports and pharmacy across every visit. Rows from this stay are marked.</p>
          </div>
          <div className="flex gap-1 border-b border-[var(--p-border)] px-3 py-2">
            {([["bills", "Billings", history?.bills.length], ["labs", "Lab reports", history?.labs.length], ["rx", "Prescriptions", history?.prescriptions.length]] as const).map(([k, label, n]) => (
              <button key={k} onClick={() => setHistoryTab(k)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${historyTab === k ? "bg-[var(--p-blue)] text-white" : "text-[var(--p-muted)] hover:bg-[var(--p-bg)]"}`}>
                {label}{n != null && n > 0 && <span className={`rounded-full px-1.5 text-[10.5px] font-bold ${historyTab === k ? "bg-white/25" : "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]"}`}>{n}</span>}
              </button>
            ))}
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {!history ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Loading history…</div>
            ) : historyTab === "bills" ? (
              history.bills.length === 0 ? <p className="px-5 py-8 text-center text-[13px] text-[var(--p-muted)]">No bills yet.</p> : history.bills.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium text-[var(--p-ink)]"><span className="font-mono">{b.receiptNo}</span> · {SRC_LABEL[b.source] ?? b.source}</div>
                    <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(b.date)} · Paid ₹{money(b.paid)} of ₹{money(b.total)}{Number(b.balance) > 0 && <span className="text-[var(--p-rose)]"> · ₹{money(b.balance)} due</span>}</div>
                  </div>
                  <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]"><Icon name="receipt" size={13} /> View</a>
                </div>
              ))
            ) : historyTab === "labs" ? (
              history.labs.length === 0 ? <p className="px-5 py-8 text-center text-[13px] text-[var(--p-muted)]">No lab tests yet.</p> : history.labs.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{l.testName}</span>{l.forThisStay && <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">This stay</span>}</div>
                    <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(l.date)} · {l.status === "COMPLETED" ? "Completed" : "Pending"}</div>
                  </div>
                  {l.reportUrl ? <a href={l.reportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--p-cyan)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"><Icon name="file" size={13} /> Report</a> : <span className="shrink-0 text-[11.5px] text-[var(--p-muted)]">No report yet</span>}
                </div>
              ))
            ) : (
              history.prescriptions.length === 0 ? <p className="px-5 py-8 text-center text-[13px] text-[var(--p-muted)]">No prescriptions yet.</p> : history.prescriptions.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{r.title || (r.items.length ? r.items.map((i) => i.medicineName).slice(0, 2).join(", ") + (r.items.length > 2 ? "…" : "") : "Prescription")}</span>{r.forThisStay && <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">This stay</span>}</div>
                    <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(r.date)} · {r.items.length} item{r.items.length === 1 ? "" : "s"} · {r.status.toLowerCase().replace(/_/g, " ")}</div>
                  </div>
                  {r.fileUrl && <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]"><Icon name="file" size={13} /> Scan</a>}
                </div>
              ))
            )}
          </div>
        </section>
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
                    <span className="text-[var(--p-ink)]">{l.wardName}</span> · {l.bedNo}
                    <span className="ml-1 text-[12px]">({l.days}d × ₹{money(l.dailyCharge)})</span>
                    {l.current && <span className="ml-1 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--p-blue)]">now</span>}
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

            <div className="flex items-center justify-between text-[14px]">
              <span className="text-[var(--p-muted)]">Nursing ({sheet.days}d × ₹{money(sheet.nursePerDay)})</span>
              <span className="font-mono text-[var(--p-ink)]">₹{money(sheet.nurseTotal)}</span>
            </div>

            <div className="flex items-center justify-between text-[14px]">
              <span className="text-[var(--p-muted)]">Charges ({sheet.charges.length})</span>
              <span className="font-mono text-[var(--p-ink)]">₹{money(sheet.chargesTotal)}</span>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--p-border)] pt-3">
              <span className="text-[14px] font-semibold text-[var(--p-ink)]">Total so far</span>
              <span className="font-mono text-[18px] font-bold text-[var(--p-ink)]">₹{money(sheet.grandTotal)}</span>
            </div>

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
      {xferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setXferOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-md overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Move to another bed</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                Currently {a.wardName} · {a.bedNo}. Only free beds are offered.
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
                          {w.beds.map((b) => <option key={b.id} value={b.id}>{w.name} · {b.bedNo}</option>)}
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
    </PortalScroll>
  );
}
