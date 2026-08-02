"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PrimaryButton, Pill } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import { AdmissionBanner, useAdmission } from "@/components/portal/reception/admission-banner";
import { InpatientPicker } from "@/components/portal/reception/inpatient-picker";
import { PRINT_CSS, RxTable } from "@/components/print/stationery";
import { parsePrescriptionText, isEmptyParse, describeParse, type ParsedVitals } from "@/lib/prescription-parse";

interface Patient { id: string; displayId: string; fullName: string; phone: string; }
interface Visit { id: string; opNumber: string; visitDate: string; doctorName: string; department: string; }
interface Med { id: string; name: string; unit: string; inStock: number; }
interface RxItem { medicineName: string; medicineId?: string; qty: number; dosage: string; }
interface Existing { id: string; appointmentId: string | null; fileName: string | null; title: string | null; fileUrl: string | null; status: string; createdAt: string; }
interface VitalsForm { bpSystolic: string; bpDiastolic: string; pulse: string; heightCm: string; weightKg: string; tempF: string; spo2: string; }
const BLANK_VITALS: VitalsForm = { bpSystolic: "", bpDiastolic: "", pulse: "", heightCm: "", weightKg: "", tempF: "", spo2: "" };

/**
 * What is already ON FILE against the picked consultation - the same bundle the
 * OPD sheet prints from, read back so the form can be filled with it instead of
 * retyped. Only the clinical slice is declared; the endpoint also returns
 * hospital/doctor/patient blocks the print sheet needs and this form does not.
 */
interface OpBundle {
  rxItems: { medicineName: string; medicineId: string | null; qty: number; dosage: string | null }[];
  vitals: { bpSystolic: number | null; bpDiastolic: number | null; pulse: number | null; heightCm: number | null; weightKg: number | null; tempF: number | null; spo2: number | null } | null;
  clinical: {
    diagnosis: string | null; advice: string | null;
    labs: { name: string; ordered: boolean; declined: boolean }[];
    nextVisit: string | null; caseHistory: string | null;
  } | null;
}

const fromNum = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function vitalsToForm(v: OpBundle["vitals"]): VitalsForm {
  if (!v) return BLANK_VITALS;
  return {
    bpSystolic: fromNum(v.bpSystolic), bpDiastolic: fromNum(v.bpDiastolic), pulse: fromNum(v.pulse),
    heightCm: fromNum(v.heightCm), weightKg: fromNum(v.weightKg), tempF: fromNum(v.tempF), spo2: fromNum(v.spo2),
  };
}

/** How much of this visit is already recorded - drives the "load it" prompt. */
function bundleCounts(b: OpBundle) {
  const labs = b.clinical?.labs ?? [];
  return {
    meds: b.rxItems.length,
    labs: labs.length,
    labsOrdered: labs.filter((l) => l.ordered).length,
    vitals: b.vitals ? Object.values(vitalsToForm(b.vitals)).filter((x) => x !== "").length : 0,
    notes: [b.clinical?.diagnosis, b.clinical?.advice, b.clinical?.nextVisit, b.clinical?.caseHistory].filter(Boolean).length,
  };
}
function hasAnything(b: OpBundle): boolean {
  const c = bundleCounts(b);
  return c.meds + c.labs + c.vitals + c.notes > 0;
}

/**
 * The transcription in progress. Compared by value (not identity) so the loader
 * can tell "nobody has typed here" from "somebody is half-way through a sheet" -
 * the difference between filling a form in and destroying somebody's work.
 * Key order is part of the comparison: build these objects with this literal.
 */
interface Draft {
  items: RxItem[]; labs: string[];
  diagnosis: string; advice: string; nextVisit: string; caseHistory: string;
  vitals: VitalsForm;
}
const EMPTY_DRAFT: Draft = { items: [], labs: [], diagnosis: "", advice: "", nextVisit: "", caseHistory: "", vitals: BLANK_VITALS };
const snapshot = (d: Draft) => JSON.stringify(d);

/** "4 medicines · 2 tests (1 already ordered) · vitals" - what's on the visit. */
function summarize(b: OpBundle): string {
  const c = bundleCounts(b);
  const bits: string[] = [];
  if (c.meds) bits.push(`${c.meds} medicine${c.meds === 1 ? "" : "s"}`);
  if (c.labs) bits.push(`${c.labs} test${c.labs === 1 ? "" : "s"}${c.labsOrdered ? ` (${c.labsOrdered} already ordered)` : ""}`);
  if (c.vitals) bits.push("vitals");
  if (c.notes) bits.push("clinical notes");
  return bits.join(" · ");
}

/** An OP record, poured into the shape the form edits. */
function bundleToDraft(b: OpBundle): Draft {
  return {
    items: b.rxItems.map((it) => ({
      medicineName: it.medicineName,
      medicineId: it.medicineId ?? undefined,
      qty: it.qty,
      dosage: it.dosage ?? "",
    })),
    labs: (b.clinical?.labs ?? []).map((l) => l.name),
    diagnosis: b.clinical?.diagnosis ?? "",
    advice: b.clinical?.advice ?? "",
    nextVisit: b.clinical?.nextVisit ?? "",
    caseHistory: b.clinical?.caseHistory ?? "",
    vitals: vitalsToForm(b.vitals),
  };
}

/** A ward chit is filed as-is, so a PDF of it is a perfectly good document. */
const ACCEPT_CHIT = "application/pdf,image/jpeg,image/png,image/webp";
/** An OP photo exists only to be read, and a PDF can't be - so don't offer it. */
const ACCEPT_PHOTO = "image/jpeg,image/png,image/webp";

const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

/** Three blank boxes are an untouched dosage, not a prescription of nothing. */
const joinDosage = (parts: string[]) => (parts.every((p) => p === "") ? "" : parts.join("-"));

/**
 * Morning - afternoon - night, the way it is written on every OPD sheet in the
 * country. One string in the model, three boxes on screen: the person at the
 * desk is copying three digits off a piece of paper, not composing a string.
 */
function DosageBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = value.split("-");
  const at = (i: number) => parts[i] ?? "";
  const set = (i: number, raw: string) => {
    const next = [at(0), at(1), at(2)];
    next[i] = raw.replace(/\D/g, "").slice(-1);
    onChange(joinDosage(next));
  };
  return (
    <div className="flex items-center gap-1.5">
      {([0, 1, 2] as const).map((i) => (
        <div key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="font-semibold text-[var(--p-muted)]">-</span>}
          <input
            className={`${fld} w-12 px-1 text-center`}
            inputMode="numeric" maxLength={1}
            value={at(i)} onChange={(e) => set(i, e.target.value)}
            placeholder={i === 1 ? "0" : "1"}
            aria-label={["Morning", "Afternoon", "Night"][i]}
          />
        </div>
      ))}
    </div>
  );
}

/** ?patient=JMH... -> preselect. Visits and history load reactively off it. */
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

export default function UploadPrescriptionPage() {
  // ---- patient ----
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [recent, setRecent] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  // the bed board decides IP vs OP - reception never has to.
  const { admission, checking: checkingAdm } = useAdmission(patient?.id);

  // ---- which consultation this scan belongs to ----
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitId, setVisitId] = useState<string>("");

  // ---- the scan ----
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");

  // ---- vitals typed in from the doctor's handwritten sheet (BP, height, weight…) ----
  const [vitals, setVitals] = useState<VitalsForm>(BLANK_VITALS);
  const [vitalsBusy, setVitalsBusy] = useState(false);
  const [vitalsSavedAt, setVitalsSavedAt] = useState<number | null>(null);
  const [vitalsError, setVitalsError] = useState<string | null>(null);

  // ---- typed medicines (the latency killer) ----
  const [items, setItems] = useState<RxItem[]>([]);
  const [medQuery, setMedQuery] = useState("");
  const [medResults, setMedResults] = useState<Med[]>([]);
  /** Catalog id of the picked suggestion - dropped the moment the name is edited. */
  const [medId, setMedId] = useState<string | undefined>(undefined);
  const [qty, setQty] = useState("1");
  const [dosage, setDosage] = useState("");
  const medBox = useRef<HTMLInputElement>(null);
  const qtyBox = useRef<HTMLInputElement>(null);

  // ---- clinical details typed from the sheet - labs, diagnosis, advice ----
  const [labs, setLabs] = useState<string[]>([]);
  const [labInput, setLabInput] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [advice, setAdvice] = useState("");
  const [nextVisit, setNextVisit] = useState("");
  const [caseHistory, setCaseHistory] = useState("");

  // ---- reading the doctor's handwriting off the scan ----
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPct, setOcrPct] = useState(0);
  /** Set once a scan has been read - the tally shown beside "check every field". */
  const [extracted, setExtracted] = useState<string | null>(null);
  /** The form as it stood before the extract, so one click puts it back. */
  const [preExtract, setPreExtract] = useState<Draft | null>(null);

  // ---- what the picked consultation already has on file ----
  const [opRecord, setOpRecord] = useState<OpBundle | null>(null);
  const [opLoading, setOpLoading] = useState(false);
  /** The visit whose record is currently sitting in the fields above. */
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  // ---- existing uploads for this patient ----
  const [existing, setExisting] = useState<Existing[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sent: boolean; visitId: string | null; fileUrl?: string | null; generated?: boolean } | null>(null);

  // Everything the form currently holds, mirrored into a ref. The loader needs
  // to know whether a human has typed anything before it fills the fields in,
  // and it must be able to ask that WITHOUT the question becoming a dependency -
  // otherwise picking a visit refetches on every keystroke.
  const draft = useRef<Draft>(EMPTY_DRAFT);
  // No dep array on purpose: this mirrors after every commit, and it is
  // declared above the loader so the loader always fires with a current draft.
  useEffect(() => {
    draft.current = { items, labs, diagnosis, advice, nextVisit, caseHistory, vitals };
  });
  /** Snapshot of the last record we poured in, so our own fill isn't mistaken
   *  for the user's typing when they move to another visit. */
  const filled = useRef<string>("");
  const untouched = useCallback(() => {
    const now = snapshot(draft.current);
    return now === filled.current || now === snapshot(EMPTY_DRAFT);
  }, []);

  useEffect(() => {
    api.get<{ patients: Patient[] }>("/reception/patients/recent").then((r) => setRecent(r.patients)).catch(() => { });
  }, []);

  // patient search
  useEffect(() => {
    if (patient || !query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { patients } = await api.get<{ patients: Patient[] }>(`/reception/patients?q=${encodeURIComponent(query)}&limit=6`);
        setResults(patients);
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [query, patient]);

  const loadExisting = useCallback(async (displayId: string) => {
    try {
      const r = await api.get<{ prescriptions: Existing[] }>(`/reception/patients/${displayId}/prescriptions`);
      setExisting(r.prescriptions);
    } catch { setExisting([]); }
  }, []);

  // when a patient is picked: their recent COMPLETED visits + past uploads
  useEffect(() => {
    if (!patient) return;
    api.get<{ visits: Visit[] }>(`/reception/patients/${patient.displayId}/completed-visits`)
      .then((r) => {
        setVisits(r.visits);
        // preselect the most recent completed consult - the usual case
        setVisitId(r.visits[0]?.id ?? "");
      })
      .catch(() => setVisits([]));
    loadExisting(patient.displayId);
  }, [patient, loadExisting]);

  // Only the PAST prescriptions list follows the hospital - never the form the
  // user is filling in. The pharmacy dispensing a chit changes its status here,
  // and that status is why somebody would otherwise send it twice. Everything
  // typed above is local state and is deliberately left alone.
  useLive(
    [TOPICS.RECEPTION],
    () => { if (patient) return loadExisting(patient.displayId); },
    {
      events: [EVENTS.PRESCRIPTION_QUEUED, EVENTS.PRESCRIPTION_DISPENSED],
      enabled: !!patient,
    }
  );

  /**
   * Pour a visit's record into the fields. This is the screen's whole point:
   * the medicines, vitals, advised tests and notes already filed against that
   * OP number are what reception is about to retype, so hand them back instead.
   */
  /**
   * Take a fill back out. Used when the consultation it came from stops being
   * the target - deselected, or the patient turns out to be in a bed. An
   * inpatient chit is uploaded with whatever `items` holds and charged to the
   * room, so an old visit's medicines surviving into it is not a cosmetic bug.
   */
  /** Every clinical field at once. The one place the form is written wholesale. */
  const applyDraft = useCallback((d: Draft) => {
    setItems(d.items); setLabs(d.labs);
    setDiagnosis(d.diagnosis); setAdvice(d.advice);
    setNextVisit(d.nextVisit); setCaseHistory(d.caseHistory);
    setVitals(d.vitals);
    setLabInput("");
  }, []);

  const clearDraft = useCallback(() => {
    applyDraft(EMPTY_DRAFT);
    filled.current = ""; setLoadedFrom(null);
    setExtracted(null); setPreExtract(null);
  }, [applyDraft]);

  const fillFrom = useCallback((b: OpBundle, forVisitId: string) => {
    const d = bundleToDraft(b);
    applyDraft(d);
    // Remember what we poured in, so moving to another visit can tell our own
    // fill from the user's typing.
    filled.current = snapshot(d);
    setLoadedFrom(forVisitId);
    setExtracted(null); setPreExtract(null);
  }, [applyDraft]);

  // The picked consultation is the source. Vitals, medicines, advised tests and
  // the clinical notes all belong to the OP visit - not to the stay - so
  // changing which visit is selected reloads all of it.
  useEffect(() => {
    setVitalsSavedAt(null); setVitalsError(null);
    setOpRecord(null); setLoadedFrom(null);
    if (!visitId || admission) {
      // Our own fill must not outlive the visit it came from. What the user
      // typed themselves is theirs and stays.
      if (untouched()) clearDraft();
      setVitals(BLANK_VITALS);
      return;
    }

    let cancelled = false;
    setOpLoading(true);
    api.get<OpBundle>(`/reception/appointments/${visitId}/print`)
      .then((b) => {
        if (cancelled) return;
        setOpRecord(b);
        // Fill only into a form nobody has typed in. If a receptionist is
        // half-way through a sheet and then corrects the visit they picked,
        // silently replacing their work is the one thing this must not do -
        // the prompt below offers them the load instead.
        if (untouched()) fillFrom(b, visitId);
      })
      .catch(() => { if (!cancelled) setOpRecord(null); })
      .finally(() => { if (!cancelled) setOpLoading(false); });

    return () => { cancelled = true; };
  }, [visitId, admission, fillFrom, untouched, clearDraft]);

  // medicine autocomplete against the pharmacy catalog. A picked suggestion
  // puts its own name in the box, so searching again would reopen the list over
  // the qty field the picker just sent them to - `medId` means "already chosen".
  useEffect(() => {
    if (!medQuery.trim() || medId) { setMedResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { medicines } = await api.get<{ medicines: Med[] }>(`/pharmacy/medicines?q=${encodeURIComponent(medQuery)}`);
        setMedResults(medicines.slice(0, 6));
      } catch { setMedResults([]); }
    }, 220);
    return () => clearTimeout(t);
  }, [medQuery, medId]);

  /**
   * Choosing a name off the catalog fills the line in - it does not file it.
   * A medicine is a name AND how much of it and when; committing on the click
   * that picks the name is what was putting "× 1, no dosage" rows on the sheet
   * before anybody had said how much. So: fill the name, then send them to the
   * count. Adding stays an explicit act - the Add button, or Enter.
   */
  function pickMed(m: Med) {
    setMedQuery(m.name); setMedId(m.id); setMedResults([]);
    qtyBox.current?.focus(); qtyBox.current?.select();
  }

  /** Name typed over a picked one is no longer that catalog product. */
  function typeMedName(v: string) {
    setMedQuery(v);
    if (medId) setMedId(undefined);
  }

  function addItem() {
    const n = medQuery.trim();
    if (!n) return;
    setItems((p) => [...p, { medicineName: n, medicineId: medId, qty: Math.max(1, Number(qty) || 1), dosage: dosage.trim() }]);
    setMedQuery(""); setMedId(undefined); setMedResults([]); setQty("1"); setDosage("");
    medBox.current?.focus();
  }

  /** A filed line stays editable - the qty and dosage most of all, since they
   *  are what somebody corrects after reading the paper again. */
  function updateItem(i: number, patch: Partial<RxItem>) {
    setItems((p) => p.map((it, x) => (x === i ? { ...it, ...patch } : it)));
  }

  function addLab(name: string) {
    const n = name.trim();
    if (!n || labs.some((l) => l.toLowerCase() === n.toLowerCase())) { setLabInput(""); return; }
    setLabs((p) => [...p, n]);
    setLabInput("");
  }

  function resetClinical() {
    setLabs([]); setLabInput(""); setDiagnosis(""); setAdvice(""); setNextVisit(""); setCaseHistory("");
    // Nothing of ours is in the fields any more - so an empty form must read as
    // untouched again, not as "the user deleted what we loaded".
    filled.current = ""; setLoadedFrom(null);
  }

  // Tesseract reads IMAGES. A PDF has to be exported as one first - saying so
  // is more use than a button that fails.
  const isPdfFile = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  const isPdf = !!file && isPdfFile(file);

  /** Empty the scan slot - the photo, the read it produced and its undo together. */
  function resetScan() {
    setFile(null); setExtracted(null); setPreExtract(null); setOcrPct(0);
  }

  function pickFile(f: File | null) {
    setError(null);
    // A new scan invalidates the last read - the undo would put back a form
    // that belonged to a different sheet.
    setExtracted(null); setPreExtract(null); setOcrPct(0);
    if (!f) { setFile(null); return; }
    if (f.size > 10 * 1024 * 1024) { setError("File too large (max 10 MB)."); return; }
    setFile(f);
    // Attaching the sheet IS the request to read it - nobody photographs the
    // doctor's handwriting and then wants it left alone. So don't make them
    // ask twice: the read starts here, and there is no button for it.
    if (!isPdfFile(f)) void runExtract(f);
  }

  /**
   * Read the doctor's sheet and put it in the fields. Fires the moment a photo
   * is attached, so the photo is a reading aid rather than an upload.
   *
   * Runs entirely in this browser - the scan is never sent anywhere to be read,
   * which for a document carrying a patient's name and their diagnosis is the
   * whole reason this is tesseract and not a cloud OCR service.
   *
   * The result is a DRAFT, never a decision. Handwriting is genuinely hard to
   * read and this will get things wrong; the receptionist has the paper in
   * their hand, and everything lands in an editable field with the original
   * still one click away. Undo restores the form exactly as it was.
   *
   * Takes the file as an argument rather than off state: it is called straight
   * out of the picker, one commit before `file` holds it.
   */
  async function runExtract(f: File) {
    if (isPdfFile(f)) return;
    setError(null); setOcrBusy(true); setOcrPct(0);
    try {
      const { recognize } = await import("tesseract.js");
      const { data } = await recognize(f, "eng", {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") setOcrPct(Math.round(m.progress * 100));
        },
      });

      const parsed = parsePrescriptionText(data.text);
      if (isEmptyParse(parsed)) {
        setExtracted(null);
        setError("Couldn't read anything usable off that scan. Try a sharper, straighter photo in better light - or type the sheet in below.");
        return;
      }

      // Only what the scan actually produced. A field it found nothing for
      // keeps whatever is already in it, so extracting never empties a box
      // somebody has already filled from the paper.
      const before = draft.current;
      const mergedVitals = { ...before.vitals };
      for (const k of Object.keys(mergedVitals) as (keyof ParsedVitals)[]) {
        if (parsed.vitals[k]) mergedVitals[k] = parsed.vitals[k];
      }
      applyDraft({
        items: parsed.medicines.length
          ? parsed.medicines.map((m) => ({
              medicineName: m.medicineName,
              // Deliberately no medicineId: an OCR'd brand name matched to a
              // real product is how the wrong drug gets dispensed. It stays
              // free text, and the pharmacist matches it.
              qty: Math.max(1, Number(m.qty) || 1),
              dosage: m.dosage,
            }))
          : before.items,
        labs: parsed.labs.length ? parsed.labs : before.labs,
        diagnosis: parsed.diagnosis || before.diagnosis,
        advice: parsed.advice || before.advice,
        nextVisit: parsed.nextVisit || before.nextVisit,
        caseHistory: parsed.caseHistory || before.caseHistory,
        vitals: mergedVitals,
      });
      setPreExtract(before);
      setExtracted(describeParse(parsed));
    } catch {
      setError("The reader couldn't run on this file. Type the sheet in below instead.");
    } finally { setOcrBusy(false); }
  }

  function undoExtract() {
    if (!preExtract) return;
    applyDraft(preExtract);
    setPreExtract(null); setExtracted(null);
  }

  /**
   * Send the attached file itself. This is the INPATIENT path: a stay has no
   * OPD sheet to generate, so the ward chit is the document. An outpatient
   * prescription never comes through here - there the photo is only ever read,
   * and what gets filed is the sheet built from the fields below.
   */
  async function upload(sendNow: boolean) {
    if (!patient || !file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("patientId", patient.id);
      // An admitted patient's Rx belongs to the STAY, not a visit. Filing it
      // against an appointment would strand it outside the discharge bill.
      if (admission) fd.append("admissionId", admission.id);
      else if (visitId) fd.append("appointmentId", visitId);
      if (title.trim()) fd.append("title", title.trim());
      if (items.length) fd.append("items", JSON.stringify(items));
      if (sendNow) fd.append("sendNow", "1");

      const res = await fetch("/api/v1/reception/prescriptions", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Upload failed");
      }
      // Snapshot now: pinning to a visit is optional, and an admitted
      // patient's Rx has no OPD sheet to print (it's charged to the room).
      const printableVisitId = !admission && visitId ? visitId : null;
      setDone({ sent: sendNow, visitId: printableVisitId });
      if (sendNow && printableVisitId) {
        // Best-effort: still within the click's promise chain, so most
        // browsers allow it. The banner's own Print button is the fallback
        // if a popup blocker steps in.
        window.open(`/print/opd/${printableVisitId}`, "_blank");
      }
      resetScan(); setTitle(""); setItems([]);
      await loadExisting(patient.displayId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally { setBusy(false); }
  }

  /**
   * The outpatient path: send the OPD sheet *itself*, built from the vitals and
   * medicines in the fields - whether they were typed or read off a photo. It's
   * filed to the patient's record (their copy, by UHID) and, when sendNow,
   * dropped into the pharmacy queue. No file is uploaded: a photo of the sheet
   * is a way of filling this form in, not a second document to keep.
   */
  async function sendOpdSheet(sendNow: boolean) {
    if (!patient || !visitId || admission) return;
    setBusy(true); setError(null);
    try {
      // persist whatever vitals are typed so the sheet carries them
      try { await saveVitals(); } catch { /* non-blocking */ }
      const res = await api.post<{ prescription: { fileUrl: string } }>("/reception/prescriptions/opd", {
        appointmentId: visitId,
        items,
        title: title.trim() || undefined,
        sendNow,
        diagnosis: diagnosis.trim() || undefined,
        advice: advice.trim() || undefined,
        nextVisit: nextVisit.trim() || undefined,
        caseHistory: caseHistory.trim() || undefined,
        labs,
      });
      setDone({ sent: sendNow, visitId, fileUrl: res.prescription?.fileUrl ?? null, generated: true });
      // The photo has done its job the moment the sheet is filed - leaving it
      // attached is how the next patient gets read off the last one's paper.
      setItems([]); setTitle(""); resetClinical(); resetScan();
      // The vitals stay on screen - they belong to the visit and were just
      // saved - so the form still reads as ours rather than half-typed.
      filled.current = snapshot({ ...EMPTY_DRAFT, vitals });
      await loadExisting(patient.displayId);
      // What's on file has just changed. Re-read it so the prompt below
      // describes what was actually saved, not the pre-send state.
      try { setOpRecord(await api.get<OpBundle>(`/reception/appointments/${visitId}/print`)); } catch { /* leave the old summary */ }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not send the OPD sheet.");
    } finally { setBusy(false); }
  }

  async function saveVitals() {
    if (!visitId) return;
    setVitalsBusy(true); setVitalsError(null);
    try {
      const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
      const raw: Record<keyof VitalsForm, number | undefined> = {
        bpSystolic: num(vitals.bpSystolic), bpDiastolic: num(vitals.bpDiastolic),
        pulse: num(vitals.pulse), heightCm: num(vitals.heightCm),
        weightKg: num(vitals.weightKg), tempF: num(vitals.tempF), spo2: num(vitals.spo2),
      };
      const payload: Record<string, number> = {};
      for (const k of Object.keys(raw) as (keyof VitalsForm)[]) {
        const v = raw[k];
        if (v !== undefined && !Number.isNaN(v)) payload[k] = v;
      }
      await api.put(`/reception/appointments/${visitId}/vitals`, payload);
      setVitalsSavedAt(Date.now());
    } catch (e) {
      setVitalsError(e instanceof ApiClientError ? e.message : "Could not save vitals.");
    } finally { setVitalsBusy(false); }
  }

  async function sendToPharmacy(id: string) {
    setBusyId(id); setError(null);
    try { await api.post(`/reception/prescriptions/${id}/send`, {}); if (patient) await loadExisting(patient.displayId); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not send to pharmacy."); }
    finally { setBusyId(null); }
  }
  async function recallFromPharmacy(id: string) {
    setBusyId(id); setError(null);
    try { await api.del(`/reception/prescriptions/${id}/send`); if (patient) await loadExisting(patient.displayId); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not recall."); }
    finally { setBusyId(null); }
  }
  async function removeFile(id: string) {
    setBusyId(id); setError(null);
    try { await api.del(`/reception/prescriptions/${id}`); if (patient) await loadExisting(patient.displayId); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not remove."); }
    finally { setBusyId(null); }
  }

  const selectedVisit = visits.find((v) => v.id === visitId);

  // One pair of buttons for both worlds. An OP visit files the generated OPD
  // sheet; a stay files the ward chit that's attached. Reception is doing the
  // same thing either way - "save it" or "send it" - so it reads the same way,
  // and which document that means is the system's problem, not theirs.
  const canSend = !!patient && (admission ? !!file : !!visitId);
  const submit = (sendNow: boolean) => (admission ? upload(sendNow) : sendOpdSheet(sendNow));

  return (
    <PortalScroll>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <Suspense fallback={null}>
        <PatientFromUrl onFound={(p) => setPatient(p)} />
      </Suspense>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Prescriptions</h1>
        <p className="mt-1 text-[14px] text-[var(--p-muted)]">
          The doctor wrote it by hand. Photograph the sheet and it reads itself into the fields - check it, send it, and it&apos;s at the pharmacy before the patient is.
        </p>
      </div>

      {done && (
        <div data-rise className="mb-4 flex items-center justify-between rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3">
          <p className="text-[14px] font-medium text-[var(--p-cyan-deep)]">
            {done.generated
              ? (done.sent
                ? "OPD sheet sent to the pharmacy queue and saved to the patient's record. ✓"
                : "OPD sheet saved to the patient's record - send it to pharmacy when ready.")
              : (done.sent
                ? "Uploaded and sent - the pharmacy can already see it in their queue. ✓"
                : "Uploaded. It's on the patient's record - send it to pharmacy when ready.")}
          </p>
          <span className="flex items-center gap-3">
            {done.fileUrl && (
              <a href={done.fileUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-[var(--p-cyan-deep)]/40 px-3 py-1.5 text-[13px] font-semibold text-[var(--p-cyan-deep)] hover:bg-white/50">
                <Icon name="file" size={13} /> Patient&apos;s copy
              </a>
            )}
            {done.visitId && (
              <a href={`/print/opd/${done.visitId}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-[var(--p-cyan-deep)] px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90">
                <Icon name="printer" size={13} /> Print OPD sheet
              </a>
            )}
            <a href="/" className="text-[13px] font-semibold text-[var(--p-cyan-deep)] underline underline-offset-2">Back to today</a>
            <button onClick={() => setDone(null)} className="text-[var(--p-cyan-deep)]">✕</button>
          </span>
        </div>
      )}
      {error && <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {/* Inpatient work starts at a BED, not a name. The ward says "ICU 3" -
              so that's what reception should be able to tap. */}
          <InpatientPicker
            pickedPatientId={patient?.id}
            onPick={(ip) => {
              setPatient({
                id: ip.patient.id, displayId: ip.patient.displayId,
                fullName: ip.patient.fullName, phone: ip.patient.phone,
              });
              setQuery("");
              setVisitId("");   // an IP Rx files to the STAY - never to an old visit
            }}
          />

          {/* ---- 1 · patient ---- */}
          <section data-rise className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-6 py-4"><h3 className="text-[14px] font-semibold text-[var(--p-ink)]">1 · Patient</h3></div>
            <div className="p-6">
              {!patient ? (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3.5 py-2.5">
                    <Icon name="search" size={16} />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, phone or JMH2026OP00123…" className="w-full text-sm outline-none" autoFocus />
                  </div>
                  {(results.length ? results : recent).length > 0 && (
                    <div className="mt-3 space-y-2">
                      {!results.length && <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Recent</p>}
                      {(results.length ? results : recent).map((p) => (
                        <button key={p.id} onClick={() => { setPatient(p); setQuery(""); }} className="surface-hover flex w-full items-center justify-between rounded-lg border border-[var(--p-border)] p-3 text-left">
                          <div><div className="text-[14px] font-medium text-[var(--p-ink)]">{p.fullName}</div><div className="text-[12px] text-[var(--p-muted)]"><span className="tabular">{p.displayId}</span> · {p.phone}</div></div>
                          <Icon name="chevron" size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-[var(--p-blue)] bg-[var(--p-blue-soft)] p-4">
                  <div><div className="text-[14px] font-semibold text-[var(--p-ink)]">{patient.fullName}</div><div className="text-[12px] text-[var(--p-muted)]"><span className="tabular">{patient.displayId}</span> · {patient.phone}</div></div>
                  {/* Clinical text left over from the previous patient is the
                      worst thing this form can carry, now that it fills itself
                      in - so changing patient empties all of it, not just ℞. */}
                  <button onClick={() => { setPatient(null); setVisits([]); setVisitId(""); clearDraft(); resetScan(); }} className="rounded-lg border border-[var(--p-border)] bg-white px-3 py-1.5 text-[13px] font-medium text-[var(--p-blue)]">Change</button>
                </div>
              )}
            </div>
          </section>

          {/* The bed board answers IP vs OP. Reception reads it; they don't decide it. */}
          {patient && <AdmissionBanner admission={admission} checking={checkingAdm} what="This prescription" />}

          {/* ---- 2 · which consultation (OP) - or which stay (IP) ---- */}
          <section data-rise className={`surface overflow-hidden ${patient ? "" : "pointer-events-none opacity-55"}`}>
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">
                2 · {admission ? "Filing against the stay" : "Which consultation?"}
              </h3>
              <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">
                {admission
                  ? "They're in a bed - so this pins to the admission, not to an old outpatient visit."
                  : "Pick the visit and whatever is already on it - vitals, medicines, tests, next visit - fills the form in below."}
              </p>
            </div>
            <div className="p-6">
              {admission ? (
                /* An inpatient Rx does not attach to a consultation. Choosing one
                   would strand the document outside the discharge bill - so the
                   picker is replaced, not merely disabled. */
                <div className="flex items-center gap-3 rounded-lg border border-[var(--p-blue)]/30 bg-[var(--p-blue-soft)] p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--p-blue)] text-white">
                    <Icon name="bed" size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[var(--p-ink)]">
                      <span className="font-mono">{admission.ipNumber}</span> - {admission.wardName} · {admission.bedNo}
                    </p>
                    <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                      Under Dr. {admission.doctorName}. The pharmacy will charge these medicines to the room.
                    </p>
                  </div>
                  <Icon name="check" size={18} />
                </div>
              ) : visits.length === 0 ? (
                <p className="rounded-lg bg-[var(--p-bg)] px-4 py-3 text-[13px] text-[var(--p-muted)]">
                  No completed consultations yet. You can still upload - it just won&apos;t be pinned to a visit.
                </p>
              ) : (
                <div className="space-y-2">
                  {visits.map((v) => (
                    <button key={v.id} onClick={() => setVisitId(visitId === v.id ? "" : v.id)}
                      className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${visitId === v.id ? "border-[var(--p-blue)] bg-[var(--p-blue-soft)]" : "border-[var(--p-border)] hover:border-[var(--p-border-strong)]"}`}>
                      <div>
                        <div className="text-[14px] font-medium text-[var(--p-ink)]">{v.doctorName} · {v.department}</div>
                        <div className="text-[12px] text-[var(--p-muted)]"><span className="font-mono">{v.opNumber}</span> · {v.visitDate}</div>
                      </div>
                      {visitId === v.id && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
              )}

              {/* What that OP number already holds. A visit that has been typed
                  up once should never be typed up twice - so the record is read
                  back and dropped into the fields below. It only fills a form
                  nobody has touched; if there's typing in progress the load
                  becomes this button, and the choice stays with the user. */}
              {!admission && visitId && (
                opLoading ? (
                  <p className="mt-3 flex items-center gap-2 text-[13px] text-[var(--p-muted)]">
                    <Spinner /> Reading what&apos;s already on this visit…
                  </p>
                ) : opRecord && hasAnything(opRecord) ? (
                  loadedFrom === visitId ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3">
                      <p className="text-[13px] text-[var(--p-cyan-deep)]">
                        <span className="font-semibold">Filled in from this visit</span> - {summarize(opRecord)}. Correct anything below before sending.
                      </p>
                      <button onClick={() => fillFrom(opRecord, visitId)}
                        className="rounded-lg border border-[var(--p-cyan-deep)]/40 px-3 py-1.5 text-[12.5px] font-semibold text-[var(--p-cyan-deep)] hover:bg-white/60">
                        Reload
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-blue)]/30 bg-[var(--p-blue-soft)] px-4 py-3">
                      <p className="text-[13px] text-[var(--p-blue-deep)]">
                        This visit already has <span className="font-semibold">{summarize(opRecord)}</span> on record - loading it will replace what&apos;s typed in below.
                      </p>
                      <button onClick={() => fillFrom(opRecord, visitId)}
                        className="btn-primary rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white">
                        Load into the form
                      </button>
                    </div>
                  )
                ) : opRecord ? (
                  <p className="mt-3 text-[13px] text-[var(--p-muted)]">
                    Nothing recorded against this visit yet - type it in below.
                  </p>
                ) : null
              )}
            </div>
          </section>

          {/* ---- 3 · vitals (OP visits only - a stay's vitals are a ward-round concern) ---- */}
          {!admission && (
            <section data-rise className={`surface overflow-hidden ${patient && visitId ? "" : "pointer-events-none opacity-55"}`}>
              <div className="border-b border-[var(--p-border)] px-6 py-4">
                <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">3 · Vitals</h3>
                <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">
                  BP, height, weight - whatever the doctor or nurse wrote by hand at triage. Once saved, it prints on the OPD sheet instead of a blank box.
                </p>
              </div>
              <div className="p-6">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="BP systolic">
                    <input className={fld} inputMode="numeric" value={vitals.bpSystolic} placeholder="120"
                      onChange={(e) => setVitals((v) => ({ ...v, bpSystolic: e.target.value.replace(/\D/g, "") }))} />
                  </Field>
                  <Field label="BP diastolic">
                    <input className={fld} inputMode="numeric" value={vitals.bpDiastolic} placeholder="80"
                      onChange={(e) => setVitals((v) => ({ ...v, bpDiastolic: e.target.value.replace(/\D/g, "") }))} />
                  </Field>
                  <Field label="Pulse (bpm)">
                    <input className={fld} inputMode="numeric" value={vitals.pulse} placeholder="76"
                      onChange={(e) => setVitals((v) => ({ ...v, pulse: e.target.value.replace(/\D/g, "") }))} />
                  </Field>
                  <Field label="SpO₂ (%)">
                    <input className={fld} inputMode="numeric" value={vitals.spo2} placeholder="98"
                      onChange={(e) => setVitals((v) => ({ ...v, spo2: e.target.value.replace(/\D/g, "") }))} />
                  </Field>
                  <Field label="Height (cm)">
                    <input className={fld} inputMode="decimal" value={vitals.heightCm} placeholder="165"
                      onChange={(e) => setVitals((v) => ({ ...v, heightCm: e.target.value.replace(/[^0-9.]/g, "") }))} />
                  </Field>
                  <Field label="Weight (kg)">
                    <input className={fld} inputMode="decimal" value={vitals.weightKg} placeholder="68"
                      onChange={(e) => setVitals((v) => ({ ...v, weightKg: e.target.value.replace(/[^0-9.]/g, "") }))} />
                  </Field>
                  <Field label="Temp (°F)">
                    <input className={fld} inputMode="decimal" value={vitals.tempF} placeholder="98.6"
                      onChange={(e) => setVitals((v) => ({ ...v, tempF: e.target.value.replace(/[^0-9.]/g, "") }))} />
                  </Field>
                </div>
                {vitalsError && <p className="mt-3 text-[13px] text-[var(--p-rose)]">{vitalsError}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--p-border)] pt-4">
                  <p className="text-[12px] text-[var(--p-muted)]">
                    {vitalsSavedAt ? "Saved ✓ - visible on the printed OPD sheet." : "Leave a box blank if it wasn't written down - nothing here is required."}
                  </p>
                  <button onClick={saveVitals} disabled={!visitId || vitalsBusy}
                    className="btn-primary rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                    {vitalsBusy ? <><Spinner /> Saving…</> : "Save vitals"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ---- 4 · scan + medicines ---- */}
          <section data-rise className={`surface overflow-hidden ${patient ? "" : "pointer-events-none opacity-55"}`}>
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">4 · Medicines, labs &amp; sheet</h3>
              <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">
                {admission
                  ? "Attach the ward chit and type the medicines in - the pharmacy charges them to the room."
                  : "Photograph the doctor's sheet and it reads itself in - or type it. Either way you check the fields before sending, and the OPD sheet carries all of it."}
              </p>
            </div>
            <div className="space-y-5 p-6">
              {/* The photo is a READING AID, not a document: attaching it starts
                  the read, and it never leaves this browser. The one file that
                  does get uploaded is a ward chit - an inpatient Rx has no
                  generated sheet for it to turn into. */}
              <label className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${ocrBusy ? "pointer-events-none" : "cursor-pointer"} ${file ? "border-[var(--p-cyan)] bg-[var(--p-cyan-soft)]" : "border-[var(--p-border-strong)] hover:border-[var(--p-blue)]"}`}>
                {/* Value cleared after every pick: picking the SAME photo again
                    is otherwise a no-op event, and re-attaching is now the only
                    way to ask for another read. */}
                <input type="file" accept={admission ? ACCEPT_CHIT : ACCEPT_PHOTO} className="hidden"
                  onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                <Icon name="file" size={22} />
                {file ? (
                  <>
                    <p className="mt-2 text-[14px] font-semibold text-[var(--p-ink)]">{file.name}</p>
                    <p className="flex items-center gap-1.5 text-[12px] text-[var(--p-muted)]">
                      {ocrBusy
                        ? <><Spinner size={12} /> Reading the handwriting… {ocrPct}%</>
                        : <>{(file.size / 1024).toFixed(0)} KB · click to replace</>}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-[14px] font-medium text-[var(--p-ink)]">
                      {admission ? "Attach the ward chit" : "Photograph the doctor's sheet"}
                    </p>
                    <p className="text-[12px] text-[var(--p-muted)]">
                      {admission
                        ? "PDF · JPG · PNG · WebP, up to 10 MB - filed against the stay."
                        : "JPG · PNG · WebP, up to 10 MB. It's read as soon as you attach it, on this computer - the photo itself is never uploaded."}
                    </p>
                  </>
                )}
              </label>

              {/* Tesseract needs pixels. Only worth saying once a PDF is sitting there. */}
              {isPdf && (
                <p className="rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-4 text-[13px] leading-relaxed text-[var(--p-muted)]">
                  {admission
                    ? "A PDF chit files fine - it just can't be read automatically. Type the medicines in below."
                    : <>The reader works on a <b className="text-[var(--p-ink)]">photo or image</b> of the sheet. For a PDF, export the page as an image - or type the fields in below.</>}
                </p>
              )}

              {/* What the read actually produced. Sits above the fields it filled
                  so nobody reaches the Send button without passing it. */}
              {extracted && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-amber)]/25 bg-[var(--p-amber-soft)] px-4 py-3">
                  <p className="text-[13px] text-[#8a5a14]">
                    <b>Read off the photo - check it against the paper.</b> Filled in: {extracted}. Handwriting is hard to
                    read and this gets things wrong; medicines came in as free text, so the pharmacist matches each one.
                  </p>
                  <button onClick={undoExtract} disabled={!preExtract || ocrBusy}
                    className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[var(--p-blue)] ring-1 ring-[var(--p-border-strong)] hover:ring-[var(--p-blue)] disabled:opacity-40">
                    Undo
                  </button>
                </div>
              )}

              <Field label="Title (optional)">
                <input className={fld} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={selectedVisit ? `${selectedVisit.department} consult - ${selectedVisit.visitDate}` : "e.g. Cardiology consult"} />
              </Field>

              {/* typed medicines */}
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-[var(--p-text)]">Prescribed medicines <span className="text-[var(--p-muted)]">(typed from the handwriting - this is what makes pharmacy fast)</span></p>

                {/* One column layout for the composer and every line it produces,
                    so a filed medicine sits directly under the boxes that made
                    it - and is corrected in exactly the same places. */}
                <div className="mb-1.5 hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)] sm:grid sm:grid-cols-[1fr_72px_1fr_auto]">
                  <span>Medicine</span>
                  <span>Qty</span>
                  <span>Dosage · morning-afternoon-night</span>
                  <span />
                </div>

                {/* Enter anywhere in the composer files the line. Skipped for
                    buttons, whose own click already does it - otherwise Enter on
                    Add would add twice, and Enter on a suggestion would file a
                    medicine instead of choosing it. */}
                <div className="grid gap-2 sm:grid-cols-[1fr_72px_1fr_auto]"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || (e.target as HTMLElement).tagName === "BUTTON") return;
                    e.preventDefault(); addItem();
                  }}>
                  <div className="relative">
                    <input ref={medBox} className={fld} value={medQuery} onChange={(e) => typeMedName(e.target.value)}
                      placeholder="Medicine name…" />
                    {medResults.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--p-border)] bg-white shadow-lg">
                        {medResults.map((m) => (
                          <button key={m.id} onClick={() => pickMed(m)}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-[14px] hover:bg-[var(--p-bg)]">
                            <span className="font-medium text-[var(--p-ink)]">{m.name}</span>
                            <span className={`text-[12px] ${m.inStock > 0 ? "text-[var(--p-muted)]" : "text-[var(--p-rose)]"}`}>{m.inStock > 0 ? `${m.inStock} in stock` : "out of stock"}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input ref={qtyBox} className={fld} value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} placeholder="Qty" inputMode="numeric" />
                  <DosageBoxes value={dosage} onChange={setDosage} />
                  {/* Same width as a line's remove button, so the two grids
                      resolve to identical columns and a filed medicine lands
                      under the boxes that made it. */}
                  <button onClick={addItem} disabled={!medQuery.trim()}
                    className="w-full rounded-lg border border-[var(--p-border)] text-[14px] font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)] disabled:opacity-40 sm:w-14">Add</button>
                </div>

                {items.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {/* Filed, not frozen. The count and the timing are what gets
                        corrected on a second read of the paper, so they stay in
                        the same editable boxes they were entered in. */}
                    {items.map((it, i) => (
                      <div key={i} className="grid items-center gap-2 rounded-lg border border-[var(--p-border)] p-2 sm:grid-cols-[1fr_72px_1fr_auto]">
                        <div className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${it.medicineId ? "bg-[var(--p-cyan)]" : "bg-[var(--p-amber, #d9a514)]"}`} title={it.medicineId ? "Matched to pharmacy catalog" : "Free text - pharmacist will match"} />
                          {/* Retyping the name unpicks the catalog product: the
                              id must never outlive the name it was matched to. */}
                          <input className={fld} value={it.medicineName} aria-label={`Medicine ${i + 1}`}
                            onChange={(e) => updateItem(i, { medicineName: e.target.value, medicineId: undefined })} />
                        </div>
                        <input className={fld} value={String(it.qty)} inputMode="numeric" aria-label={`Quantity of ${it.medicineName}`}
                          onChange={(e) => updateItem(i, { qty: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} />
                        <DosageBoxes value={it.dosage} onChange={(d) => updateItem(i, { dosage: d })} />
                        <button onClick={() => setItems((p) => p.filter((_, x) => x !== i))}
                          aria-label={`Remove ${it.medicineName}`}
                          className="justify-self-end px-2 text-[var(--p-rose)] sm:w-14">✕</button>
                      </div>
                    ))}

                    {/* Live preview - the same RxTable component the OPD sheet
                        prints with, fed straight from this draft. Nothing is
                        saved yet; this is just what it'll look like once it is. */}
                    <div className="mt-4 overflow-hidden rounded-lg border border-[var(--p-border)]">
                      <p className="border-b border-[var(--p-border)] bg-[var(--p-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                        Live preview - how this prints on the OPD sheet
                      </p>
                      <div className="print-stage" style={{ background: "transparent", minHeight: 0, padding: "10px 14px" }}>
                        <div id="print-sheet" style={{ width: "100%", minHeight: 0, boxShadow: "none", padding: 0, background: "transparent" }}>
                          <RxTable items={items} blankRows={0} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ---- prescribed labs & clinical details - print on the sheet ---- */}
              <div className="border-t border-dashed border-[var(--p-border)] pt-4">
                <p className="mb-1.5 text-[13px] font-medium text-[var(--p-text)]">
                  Prescribed labs &amp; clinical details{" "}
                  <span className="text-[var(--p-muted)]">(optional - whatever is typed prints on the sheet instead of a blank pen line)</span>
                </p>

                {/* labs - chip list, Enter to add */}
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input className={fld} value={labInput} onChange={(e) => setLabInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLab(labInput); } }}
                    placeholder="Prescribed lab test - e.g. CBP, RBS, Lipid profile… (Enter to add)" />
                  <button onClick={() => addLab(labInput)} disabled={!labInput.trim()}
                    className="rounded-lg border border-[var(--p-border)] px-3.5 py-2 text-[14px] font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)] disabled:opacity-40">
                    Add lab
                  </button>
                </div>
                {labs.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {labs.map((l, i) => (
                      <span key={l} className="inline-flex items-center gap-2 rounded-full border border-[var(--p-blue)]/30 bg-[var(--p-blue-soft)] py-1 pl-3 pr-2 text-[12.5px] font-medium text-[var(--p-blue-deep)]">
                        <span className="font-mono text-[10px]">{i + 1}.</span> {l}
                        <button onClick={() => setLabs((p) => p.filter((x) => x !== l))} aria-label={`Remove ${l}`}
                          className="grid h-4 w-4 place-items-center rounded-full text-[10px] hover:bg-white/70">✕</button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {/* Typed first because it is what the doctor wrote first, and
                      it prints in the top block of the OPD sheet. */}
                  <Field label="Case history" span>
                    <textarea className={`${fld} min-h-[76px] resize-y`} value={caseHistory} onChange={(e) => setCaseHistory(e.target.value)}
                      placeholder="Presenting complaints and history as written - e.g. Fever 3 days, dry cough, no vomiting. K/c/o type 2 diabetes on metformin." />
                  </Field>
                  <Field label="Diagnosis">
                    <input className={fld} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)}
                      placeholder="As written on the sheet - e.g. Viral fever" />
                  </Field>
                  <Field label="Next visit">
                    <input className={fld} value={nextVisit} onChange={(e) => setNextVisit(e.target.value)}
                      placeholder="e.g. After 5 days / 21 Aug" />
                  </Field>
                  <Field label="Advice" span>
                    <textarea className={`${fld} min-h-[64px] resize-y`} value={advice} onChange={(e) => setAdvice(e.target.value)}
                      placeholder="Diet, rest, follow-up instructions - prints under the ℞ table" />
                  </Field>
                </div>
              </div>

              {/* Two buttons, one decision: keep it, or hand it to the pharmacy.
                  Which document that files - the generated OPD sheet or the
                  attached ward chit - follows from the patient being in a bed,
                  and reception never has to pick between them. */}
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--p-border)] pt-4">
                <span className="mr-auto text-[12px] text-[var(--p-muted)]">
                  {admission
                    ? (file ? "Files the ward chit against the stay." : "Attach the ward chit above to send this.")
                    : (visitId ? "Sends the typed OPD sheet to pharmacy and files the patient's copy." : "Pick the consultation above to enable this.")}
                </span>
                <button onClick={() => submit(false)} disabled={!canSend || busy}
                  className="rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)] disabled:opacity-40">
                  Save to record
                </button>
                <PrimaryButton onClick={() => submit(true)} disabled={!canSend || busy}>
                  {busy ? <><Spinner /> Working…</> : <><Icon name="pill" size={15} /> Send to pharmacy</>}
                </PrimaryButton>
              </div>
            </div>
          </section>
        </div>

        {/* ---- existing uploads ---- */}
        <aside data-rise className="lg:sticky lg:top-24 lg:self-start">
          <div className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">On this patient&apos;s record</h3>
            </div>
            {!patient ? (
              <p className="px-5 py-10 text-center text-[13px] text-[var(--p-muted)]">Pick a patient to see their prescriptions.</p>
            ) : existing.length === 0 ? (
              <p className="px-5 py-10 text-center text-[13px] text-[var(--p-muted)]">Nothing uploaded yet.</p>
            ) : (
              <div className="max-h-[520px] divide-y divide-[var(--p-border)] overflow-y-auto overscroll-contain">
                {existing.map((e) => (
                  <div key={e.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium text-[var(--p-ink)]">{e.title || e.fileName || "OPD prescription"}</div>
                        <div className="text-[12px] text-[var(--p-muted)]">{new Date(e.createdAt).toLocaleDateString("en-IN")}</div>
                      </div>
                      <Pill tone={e.status === "DISPENSED" ? "completed" : e.status === "SENT_TO_PHARMACY" ? "waiting" : "neutral"}>
                        {e.status === "DISPENSED" ? "Dispensed" : e.status === "SENT_TO_PHARMACY" ? "At pharmacy" : "Scanned"}
                      </Pill>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {e.fileUrl ? (
                        <a href={e.fileUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[var(--p-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]">View scan</a>
                      ) : e.appointmentId ? (
                        <a href={`/print/opd/${e.appointmentId}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[var(--p-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]">OPD sheet</a>
                      ) : null}
                      {e.status === "UPLOADED" && (
                        <button onClick={() => sendToPharmacy(e.id)} disabled={busyId === e.id}
                          className="btn-primary rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-60">
                          {busyId === e.id ? "…" : "Send to pharmacy"}
                        </button>
                      )}
                      {e.status === "SENT_TO_PHARMACY" && (
                        <button onClick={() => recallFromPharmacy(e.id)} disabled={busyId === e.id}
                          className="rounded-lg border border-[var(--p-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)] disabled:opacity-60">
                          {busyId === e.id ? "…" : "Recall"}
                        </button>
                      )}
                      {e.status !== "DISPENSED" && (
                        <button onClick={() => removeFile(e.id)} disabled={busyId === e.id}
                          className="rounded-md border border-[var(--p-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-rose)] hover:border-[var(--p-rose)] disabled:opacity-60">Remove</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </PortalScroll>
  );
}