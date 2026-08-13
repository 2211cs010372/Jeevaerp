"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";
import { parseInvoiceHeader, type SupplierRef, type ParsedRow } from "@/lib/pharmacy/invoice-parse";
import { parsePack, packsToUnits, perUnitPrice } from "@/lib/pharmacy/pack";

/**
 * The catalogue entry a row can be matched to. `defaultPack` is what makes the
 * pack column checkable: a line scanned as "157" against a product whose master
 * says "15T" is an OCR misread, and this screen is the last place to catch it.
 */
interface MedRef {
  id: string; name: string; genericName?: string | null;
  defaultPack?: string | null; defaultPackSize?: number;
}
/** A grid row. Same shape the invoice parser produces, plus the edit state. */
type Row = ParsedRow;
interface ImportResult { row: number; medicine: string; batchNo: string; ok: boolean; error?: string; created?: boolean }
interface ImportReport { created: number; createdMedicines: number; supplierName?: string; results: ImportResult[] }

const blankRow = (): Row => ({
  medicine: "", pack: "", qty: "", free: "", oMrp: "", batchNo: "",
  mrp: "", expiry: "", rate: "", amount: "", gst: "", hsn: "", supplier: "",
});
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const HEADER_TEMPLATE = [
  "Medicine,Pack,Batch No,Expiry (YYYY-MM-DD or MM/YYYY),Quantity,Free,MRP,Purchase Rate,GST%,HSN,Supplier Ref",
  "Paracetamol 500mg,15T,B1234,2027-06-30,100,0,18.50,12.00,5,300490,INV-2024-001",
  "",
].join("\n");

/** Anything this screen knows how to open. */
const ACCEPT = [
  "image/*", "application/pdf", ".pdf",
  ".xlsx", ".xls", ".xlsm", ".csv", ".tsv",
  "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which of the three readers a dropped file needs. */
function kindOf(f: File): "SHEET" | "PDF" | "IMAGE" {
  if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "PDF";
  if (/\.(xlsx|xlsm|xlsb|xls|csv|tsv|ods)$/i.test(f.name)) return "SHEET";
  if (/spreadsheet|excel|ms-excel|csv/i.test(f.type)) return "SHEET";
  return "IMAGE";
}

export function BatchImport({ meds, suppliers, onClose, onDone }: {
  meds: MedRef[];
  suppliers: SupplierRef[];
  onClose: () => void;
  onDone: (created: number) => void;
}) {
  const [tab, setTab] = useState<"SHEET" | "SCAN">("SHEET");
  const [rows, setRows] = useState<Row[]>([]);
  /** One invoice, one distributor - so these belong to the import, not the row. */
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  /** True when the supplier below was read off the invoice rather than chosen. */
  const [supplierDetected, setSupplierDetected] = useState(false);
  /**
   * A distributor named on the invoice that isn't on file. Never auto-created -
   * a misread character would mint a second "Vishwanalh Medical Stores" and
   * split the ledger - but saying so beats leaving the field mysteriously blank.
   */
  const [supplierMissing, setSupplierMissing] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanPdf, setScanPdf] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPct, setOcrPct] = useState(0);
  /** What the reader is doing right now - a bare percentage that pauses reads as a crash. */
  const [ocrStage, setOcrStage] = useState("");
  /** The cleaned-up image recognition actually saw, for the before/after view. */
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [showPrepared, setShowPrepared] = useState(false);
  /** How the rows arrived - shown once, so nobody wonders what the machine did. */
  const [readNote, setReadNote] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Object URLs outlive the component unless revoked, and a scan is a few MB.
  useEffect(() => () => {
    if (scanUrl) URL.revokeObjectURL(scanUrl);
    if (preparedUrl) URL.revokeObjectURL(preparedUrl);
  }, [scanUrl, preparedUrl]);

  const resolve = useMemo(() => {
    const map = new Map<string, MedRef>();
    for (const m of meds) {
      map.set(m.name.trim().toLowerCase(), m);
      if (m.genericName) map.set(m.genericName.trim().toLowerCase(), m);
    }
    return (name: string) => map.get(name.trim().toLowerCase()) ?? null;
  }, [meds]);

  const today = todayISO();

  /**
   * WHAT THIS ROW ACTUALLY PUTS ON THE SHELF.
   *
   * The single most important number on this screen, and it was not here before:
   * quantity is in PACKS, exactly as the invoice counts them, and the shelf
   * holds UNITS. Three strips of 15T is forty-five tablets, and the MRP printed
   * on the strip is for all fifteen.
   *
   * Without the pack column the import sent packSize 1 for every row, so three
   * strips became three tablets and each was priced at the whole strip's MRP.
   * Showing the derived numbers live is what makes a wrong pack label visible
   * here rather than at a stock count months later.
   */
  const packOf = (r: Row) => {
    const matched = resolve(r.medicine);
    // The line's own label wins; the product's standard pack rescues a blank.
    const label = r.pack?.trim() || matched?.defaultPack?.trim() || "";
    const spec = parsePack(label);
    const size = spec.known && spec.size > 1
      ? spec.size
      : Math.max(1, matched?.defaultPackSize ?? 1);
    const packs = Number(r.qty || 0);
    const free = Number(r.free || 0);
    const units = packsToUnits(packs + free, size);
    const mrpN = Number(r.mrp || 0);
    // Flagged, never auto-corrected - only a person knows whether a differing
    // pack is a misread or a genuine repack by the distributor.
    const mismatch =
      !!matched?.defaultPackSize && matched.defaultPackSize > 1 &&
      spec.known && spec.size > 1 && spec.size !== matched.defaultPackSize;
    return {
      label, size, units, mismatch,
      fromMaster: !r.pack?.trim() && !!matched?.defaultPack,
      expected: matched?.defaultPack ?? null,
      unitMrp: mrpN > 0 ? perUnitPrice(mrpN, size) : 0,
      known: spec.known,
    };
  };

  const cellOk = (r: Row) => {
    const matched = !!resolve(r.medicine);
    return {
      matched,
      med: matched || (!!r.createNew && r.medicine.trim().length > 1),
      batch: r.batchNo.trim().length > 0,
      expiry: /^\d{4}-\d{2}-\d{2}$/.test(r.expiry) && r.expiry >= today,
      qty: /^\d+$/.test(r.qty.trim()) && Number(r.qty) >= 1,
      mrp: r.mrp.trim() !== "" && Number(r.mrp) >= 0 && !Number.isNaN(Number(r.mrp)),
      rate: r.rate.trim() === "" || (Number(r.rate) >= 0 && !Number.isNaN(Number(r.rate))),
      free: r.free.trim() === "" || (/^\d+$/.test(r.free.trim()) && Number(r.free) >= 0),
    };
  };
  const rowValid = (r: Row) => { const o = cellOk(r); return o.med && o.batch && o.expiry && o.qty && o.mrp && o.rate && o.free; };
  const validCount = rows.filter(rowValid).length;
  /** Rows whose pack disagrees with the product master - worth a look, not a block. */
  const mismatchCount = rows.filter((r) => r.medicine.trim() && packOf(r).mismatch).length;
  const unmatchedCount = rows.filter((r) => r.medicine.trim() && !resolve(r.medicine) && !r.createNew).length;
  /** Rows the reader had to guess at - worth a second look before importing. */
  const lowConfidenceCount = rows.filter((r) => r.confidence === "low").length;
  const newCount = rows.filter((r) => rowValid(r) && !resolve(r.medicine) && r.createNew).length;

  const setCell = (i: number, key: keyof Row, v: string) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  const toggleNew = (i: number) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, createNew: !r.createNew } : r)));
  const markAllNew = () => setRows((p) => p.map((r) => (r.medicine.trim() && !resolve(r.medicine) ? { ...r, createNew: true } : r)));
  const removeRow = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));

  /**
   * The invoice's own header - whoever sent it, its number and its date.
   *
   * The supplier is MATCHED, never created: an OCR slip in a distributor's name
   * would otherwise open a second account for the same firm and split every
   * report that reads by supplier. When nothing matches, the printed name is
   * held so the screen can say which distributor it couldn't find.
   */
  function applyHeader(h: { invoiceNo?: string; invoiceDate?: string; supplierId?: string; supplierName?: string }) {
    if (h.supplierId) {
      setSupplierId(h.supplierId); setSupplierDetected(true); setSupplierMissing(null);
    } else if (h.supplierName) {
      const flat = squash(h.supplierName);
      const hit = [...suppliers].sort((a, b) => b.name.length - a.name.length)
        .find((s) => squash(s.name).length >= 5 && flat.includes(squash(s.name)));
      if (hit) { setSupplierId(hit.id); setSupplierDetected(true); setSupplierMissing(null); }
      else setSupplierMissing(h.supplierName);
    }
    if (h.invoiceNo) setInvoiceNo(h.invoiceNo);
    if (h.invoiceDate) setInvoiceDate(h.invoiceDate);
  }

  /** One entry point for all three file types - the tab follows the file. */
  function onFile(f: File) {
    const kind = kindOf(f);
    setError(null); setReadNote(null); setSupplierMissing(null);
    if (kind === "SHEET") { setTab("SHEET"); void onSheet(f); return; }
    setTab("SCAN");
    onScan(f);
  }

  async function onSheet(f: File) {
    setError(null); setParsing(true); setFileName(f.name); setReadNote(null);
    try {
      const { readWorkbook } = await import("@/lib/pharmacy/sheet-parse");
      const res = await readWorkbook(f);
      if (!res.rows.length) {
        setRows([]);
        setError("Couldn't find any line items in that file. Check the column headings against the template - or upload the invoice as a PDF or a photo instead, which doesn't need headings at all.");
        return;
      }
      applyHeader(res);
      setRows(res.rows);
      setReadNote(
        res.inferred
          ? `${res.rows.length} rows from "${res.sheetName}". That sheet has no column headings, so the columns were worked out from the values themselves - check every one before importing.`
          : `${res.rows.length} rows from "${res.sheetName}".`,
      );
    } catch {
      setError("Couldn't read that file. Use .xlsx, .xls or .csv.");
    } finally { setParsing(false); }
  }

  function onScan(f: File) {
    setError(null);
    if (scanUrl) URL.revokeObjectURL(scanUrl);
    if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    setPreparedUrl(null); setShowPrepared(false); setReadNote(null);
    setScanUrl(URL.createObjectURL(f));
    setScanFile(f);
    setFileName(f.name);
    setScanPdf(kindOf(f) === "PDF");
    if (!rows.length) setRows([blankRow(), blankRow(), blankRow()]);
  }

  /**
   * Photo or PDF, into rows.
   *
   * A PDF exported by the distributor's billing software already CONTAINS every
   * character, positioned. Reading that text directly is instant and cannot
   * misread a digit, so it is always tried first; recognition is only for a PDF
   * that turns out to be a photograph in a wrapper.
   */
  async function runScan() {
    if (!scanFile) return;
    setError(null); setOcrBusy(true); setOcrPct(0); setOcrStage("Opening the file"); setReadNote(null);
    try {
      let sources: (Blob | HTMLCanvasElement)[] = [scanFile];

      if (scanPdf) {
        const { readPdfText, renderPdfPages } = await import("@/lib/pharmacy/pdf-extract");
        setOcrStage("Reading the PDF"); setOcrPct(6);
        const doc = await readPdfText(scanFile);
        if (doc.hasTextLayer) {
          const { parseInvoiceText } = await import("@/lib/pharmacy/invoice-parse");
          const parsed = parseInvoiceText(doc.text);
          if (parsed.length) {
            applyHeader(parseInvoiceHeader(doc.text, suppliers));
            setRows(parsed);
            setOcrPct(100); setOcrStage("Done");
            setReadNote(`${parsed.length} rows read straight out of the PDF's own text${doc.pageCount > 1 ? ` across ${doc.pageCount} pages` : ""} - no recognition involved, so no misread digits.`);
            return;
          }
        }
        setOcrStage("Scanned PDF - rendering the pages"); setOcrPct(10);
        sources = await renderPdfPages(scanFile, {
          onPage: (p, total) => setOcrStage(`Rendering page ${p} of ${total}`),
        });
        if (!sources.length) { setError("That PDF has no pages to read."); return; }
        // Recognition is capped at ten pages. Said out loud rather than left to
        // be discovered by a short delivery: pages nobody was told about are
        // stock nobody knows is missing.
        if (doc.pageCount > sources.length) {
          setError(`This PDF has ${doc.pageCount} pages and only the first ${sources.length} were read. Split it and import the rest separately.`);
        }
      }

      const { recognizeInvoice } = await import("@/lib/pharmacy/ocr");
      const res = await recognizeInvoice(sources, {
        onProgress: (p) => { setOcrPct(p.pct); setOcrStage(p.stage); },
      });

      // Show what recognition actually saw. A pharmacist looking at a black
      // rectangle knows instantly why nothing came out, which a percentage
      // never told them.
      const first = res.prepared[0];
      if (first) {
        const { canvasToBlob } = await import("@/lib/pharmacy/image-prep");
        setPreparedUrl(URL.createObjectURL(await canvasToBlob(first)));
      }

      applyHeader(parseInvoiceHeader(res.text, suppliers));
      if (!res.rows.length) {
        setError("Couldn't make out any line items. Look at the sharpened image (“what the reader saw”) - if the text is illegible there, retake the photo straight-on in better light. Otherwise key the rows in below.");
      } else {
        setRows(res.rows);
        const low = res.rows.filter((r) => r.confidence === "low").length;
        setReadNote([
          `${res.rows.length} rows read`,
          res.skewDeg ? `page straightened by ${Math.abs(res.skewDeg).toFixed(1)}°` : "",
          res.passes > 1 ? `took ${res.passes} passes - the scan was hard to read` : "",
          low ? `${low} without an expiry date - fill those in from the strip` : "",
        ].filter(Boolean).join(" · ") + ".");
      }
    } catch {
      const { resetOcr } = await import("@/lib/pharmacy/ocr");
      await resetOcr();
      setError("The reader couldn't run on this file. Try a JPG or PNG photo, or key the rows in below.");
    } finally { setOcrBusy(false); setOcrStage(""); }
  }

  function downloadTemplate() {
    const blob = new Blob([HEADER_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "jeeva-batch-import-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    const payload = rows.filter(rowValid).map((r) => {
      const matched = resolve(r.medicine);
      const p = packOf(r);
      const base = {
        batchNo: r.batchNo.trim(),
        expiryDate: r.expiry,
        quantity: Number(r.qty),
        mrp: Number(r.mrp),
        // ── THE FIELDS THIS SCREEN USED TO DROP ──
        // Every one of these was parsed off the invoice, shown to nobody, and
        // thrown away at submit. packSize defaulting to 1 is why a strip of ten
        // reached the shelf as one tablet priced at the whole strip's MRP.
        // Sent as the SIZE the grid displayed, so what was confirmed on screen
        // is exactly what is stored.
        ...(p.label ? { pack: p.label } : {}),
        packSize: p.size,
        ...(r.free.trim() ? { freeQty: Number(r.free) } : {}),
        ...(r.oMrp.trim() ? { oMrp: r.oMrp.trim() } : {}),
        ...(r.rate.trim() ? { purchasePrice: Number(r.rate) } : {}),
        ...(r.supplier.trim() ? { supplierRef: r.supplier.trim() } : {}),
      };
      return matched
        ? { medicineId: matched.id, ...base }
        : { createNew: true, medicine: r.medicine.trim(), ...(r.hsn ? { hsn: r.hsn } : {}), ...(r.gst ? { gstRatePct: Number(r.gst) } : {}), ...base };
    });
    if (!payload.length) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<ImportReport>("/pharmacy/batches/bulk", {
        supplierId,
        invoiceNo: invoiceNo.trim() || undefined,
        invoiceDate: invoiceDate || undefined,
        rows: payload,
      });
      setReport(res);
      if (res.created > 0) onDone(res.created);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Import failed.");
    } finally { setBusy(false); }
  }

  const inp = "w-full rounded-md border border-[var(--p-border)] bg-white px-2 py-1.5 text-[12px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";
  const bad = "!border-[var(--p-rose)] bg-[var(--p-rose-soft)]";

  return (
    <div className="import-veil" onClick={onClose}>
      <div className="import-sheet flex max-h-[94vh] w-full max-w-9xl flex-col overflow-hidden rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--p-border)] px-6 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Import stock batches</h3>
            <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Upload a spreadsheet, or key in the rows off a scanned invoice.</p>
          </div>
          <button onClick={onClose} className="shrink-0 text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
        </div>

        {/* WHOSE INVOICE IS THIS. Above the tabs because it governs every row
            below: one invoice is one distributor, and the same batch number
            from a different one is a separate consignment on the shelf. */}
        <div className="grid gap-3 border-b border-[var(--p-border)] bg-[var(--p-bg)] px-6 py-3.5 sm:grid-cols-[2fr_1.2fr_1fr]">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--p-muted)]">
              Supplier *
              {supplierDetected && (
                <span className="ml-1.5 rounded bg-[var(--p-teal-soft)] px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-[var(--p-teal-deep)]">
                  read from invoice — check it
                </span>
              )}
            </span>
            <select
              value={supplierId}
              onChange={(e) => { setSupplierId(e.target.value); setSupplierDetected(false); }}
              className={`w-full rounded-md border bg-white px-2 py-1.5 text-[12.5px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)] ${supplierId ? "border-[var(--p-border)]" : "border-[var(--p-rose)]"}`}
            >
              <option value="">Choose the distributor…</option>
              {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--p-muted)]">Invoice no.</span>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="From the bill"
              className="w-full rounded-md border border-[var(--p-border)] bg-white px-2 py-1.5 text-[12.5px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]" />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--p-muted)]">Invoice date</span>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full rounded-md border border-[var(--p-border)] bg-white px-2 py-1.5 text-[12.5px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]" />
          </label>

          {/* The invoice named a distributor we don't have. Never created from
              a scan - said out loud instead, so the blank field is explained. */}
          {supplierMissing && !supplierId && (
            <p className="text-[11.5px] leading-relaxed text-[#8a5a14] sm:col-span-3">
              This invoice says it&apos;s from <b>{supplierMissing}</b>, which isn&apos;t on your distributor list.
              Pick the right one above, or add them under <b>Suppliers</b> first - a distributor is never created
              off a scan, because one misread letter would open a second account for the same firm.
            </p>
          )}

          {suppliers.length === 0 && (
            <p className="text-[11.5px] text-[var(--p-rose)] sm:col-span-3">
              No distributors on file. Add one under <b>Suppliers</b> before importing - every batch has to trace to one.
            </p>
          )}
        </div>

        {report ? (
          /* ---- result report ---- */
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"><Icon name="check" size={22} /></span>
              <div>
                <p className="text-[16px] font-semibold text-[var(--p-ink)]">{report.created} of {report.results.length} batches received</p>
                <p className="text-[12px] text-[var(--p-muted)]">
                  Stock is updated with a PURCHASE ledger entry for each{report.createdMedicines > 0 ? ` · ${report.createdMedicines} new ${report.createdMedicines === 1 ? "medicine" : "medicines"} added to the catalog` : ""}.
                </p>
              </div>
            </div>
            {report.results.some((r) => !r.ok) && (
              <div className="mt-4 overflow-hidden rounded-xl border border-[var(--p-rose)]/30">
                <p className="bg-[var(--p-rose-soft)] px-4 py-2 text-[12px] font-semibold text-[var(--p-rose)]">
                  {report.results.filter((r) => !r.ok).length} rows didn&apos;t import - fix and try again:
                </p>
                <div className="divide-y divide-[var(--p-border)]">
                  {report.results.filter((r) => !r.ok).map((r) => (
                    <div key={r.row} className="flex items-center justify-between gap-3 px-4 py-2 text-[12px]">
                      <span className="text-[var(--p-ink)]">Row {r.row}: <b>{r.medicine || "-"}</b> · {r.batchNo || "no batch"}</span>
                      <span className="text-[var(--p-rose)]">{r.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-6 flex justify-end">
              <button onClick={onClose} className="btn-primary rounded-md px-5 py-2.5 text-sm font-semibold text-white">Done</button>
            </div>
          </div>
        ) : (
          <>
            {/* tabs */}
            <div className="flex gap-1 border-b border-[var(--p-border)] px-4 pt-3">
              {([["SHEET", "Spreadsheet"], ["SCAN", "Scanned invoice"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setTab(v)}
                  className={`rounded-t-lg px-4 py-2 text-[13px] font-semibold transition-colors ${tab === v ? "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>
                  {l}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {tab === "SHEET" ? (
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  {/* Accepts everything, on either tab. A file dropped on the
                      wrong one switches the tab rather than refusing - nobody
                      should have to know which reader their file needs. */}
                  <label className="btn-primary inline-flex cursor-pointer items-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold text-white">
                    <Icon name="file" size={14} /> {fileName ? "Replace file" : "Choose a file"}
                    <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
                      onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                  </label>
                  <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--p-blue)] hover:underline">
                    <Icon name="file" size={13} /> Download template
                  </button>
                  {parsing && <span className="flex items-center gap-1.5 text-[12px] text-[var(--p-muted)]"><Spinner size={13} /> Reading…</span>}
                  {fileName && !parsing && <span className="text-[12px] text-[var(--p-muted)]">{fileName} · {rows.length} rows</span>}
                  <p className="w-full text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                    Excel or CSV, in whatever layout your distributor sends. Every sheet in the workbook is
                    searched, the headings are found wherever they sit, and a sheet with no headings at all has
                    its columns worked out from the values. A PDF or a photo works here too.
                  </p>
                </div>
              ) : (
                <div className="mb-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="btn-primary inline-flex cursor-pointer items-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold text-white">
                        <Icon name="file" size={14} /> {scanUrl ? "Replace scan" : "Upload invoice"}
                        <input type="file" accept={ACCEPT} className="hidden"
                          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                      </label>
                      {/* WHAT THE READER SAW. The single most useful thing on
                          this screen when extraction comes back thin: a glance
                          at the sharpened image says "the photo was the
                          problem" or "the photo was fine", which no percentage
                          and no error message ever could. */}
                      {preparedUrl && (
                        <button onClick={() => setShowPrepared((v) => !v)}
                          className="rounded-md px-3 py-2 text-[12px] font-semibold text-[var(--p-blue)] ring-1 ring-[var(--p-border-strong)] hover:ring-[var(--p-blue)]">
                          {showPrepared ? "Show my photo" : "What the reader saw"}
                        </button>
                      )}
                    </div>

                    {scanUrl ? (
                      showPrepared && preparedUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preparedUrl} alt="Sharpened for reading" className="mt-3 max-h-[300px] w-full rounded-lg border border-[var(--p-border)] bg-white object-contain" />
                      ) : scanPdf ? (
                        <iframe src={scanUrl} title="Invoice" className="mt-3 h-[300px] w-full rounded-lg border border-[var(--p-border)]" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={scanUrl} alt="Scanned invoice" className="mt-3 max-h-[300px] w-full rounded-lg border border-[var(--p-border)] object-contain" />
                      )
                    ) : (
                      <div className="mt-3 flex h-[160px] items-center justify-center rounded-lg border border-dashed border-[var(--p-border-strong)] px-4 text-center text-[12px] text-[var(--p-muted)]">
                        A photo of the invoice, a PDF from the distributor, or a spreadsheet - whichever you have.
                      </div>
                    )}
                  </div>

                  <div className="lg:pt-1">
                    {scanUrl ? (
                      <>
                        <button onClick={runScan} disabled={ocrBusy}
                          className="btn-primary inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60">
                          {ocrBusy ? <><Spinner size={14} /> {ocrStage || "Reading"}… {ocrPct}%</> : <><Icon name="search" size={14} /> Extract rows from invoice</>}
                        </button>

                        {/* A BAR THAT MOVES. The old one only listened for the
                            recognition stage, so it sat at nothing through a
                            12MB model download and then stalled at 70 on the
                            last block of layout - which reads as a crash, and
                            people reloaded seconds before it would have
                            finished. Every stage reports now, and each one
                            says what it is doing. */}
                        {ocrBusy && (
                          <div className="mt-3">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--p-border)]">
                              <div className="h-full rounded-full bg-[var(--p-blue)] transition-[width] duration-300"
                                style={{ width: `${Math.max(3, ocrPct)}%` }} />
                            </div>
                            <p className="mt-1.5 text-[11.5px] text-[var(--p-muted)]">
                              {ocrStage}. A big photo takes 20-40 seconds - leave it running.
                            </p>
                          </div>
                        )}

                        <p className="mt-3 text-[12px] leading-relaxed text-[var(--p-muted)]">
                          {scanPdf
                            ? <>A PDF from the distributor&apos;s billing software is read <b className="text-[var(--p-ink)]">directly</b>, character for character - instant, and no digit can be misread. A scanned PDF falls back to recognition, page by page.</>
                            : <>The photo is straightened, sharpened and re-lit before reading, which is most of the difference between a full grid and an empty one.</>}
                          {" "}It all runs on this computer - nothing is uploaded.{" "}
                          <b className="text-[var(--p-ink)]">Always check the rows</b> - the invoice&apos;s product
                          names won&apos;t match your catalog, so pick the matching medicine for each (red = not
                          matched yet).
                        </p>
                      </>
                    ) : (
                      <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
                        Upload a clear, straight photo of the invoice and press <b>Extract</b> - the batch lines fill
                        in automatically. PDFs and spreadsheets work here too. You can also type rows by hand below.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* What the reader made of it, in one line. */}
              {readNote && !ocrBusy && (
                <div className="mb-3 rounded-lg border border-[var(--p-cyan)]/25 bg-[var(--p-cyan-soft)] px-3.5 py-2.5">
                  <p className="text-[12px] leading-relaxed text-[var(--p-cyan-deep)]">{readNote}</p>
                </div>
              )}

              {/* ── ROWS THE READER WASN'T SURE OF ──
                  A row recovered without its expiry is still worth having: the
                  name, the batch, the quantity and the prices are all typed for
                  you. But an expiry is what pulls stock off a shelf, so it is
                  left blank on purpose and the import stays blocked until a
                  person reads it off the strip. */}
              {lowConfidenceCount > 0 && (
                <div className="mb-3 rounded-lg border border-[var(--p-amber)]/40 bg-[var(--p-amber-soft)] px-3.5 py-2.5">
                  <p className="text-[12px] leading-relaxed text-[#8a5a14]">
                    <b>{lowConfidenceCount} {lowConfidenceCount === 1 ? "row was" : "rows were"} recovered from a hard-to-read part of the scan</b> (marked
                    &ldquo;check&rdquo; below). Their expiry dates couldn&apos;t be made out at all and were left
                    empty - read those off the strips and key them in. Check the batch numbers on those rows too.
                  </p>
                </div>
              )}

              {/* unmatched-medicine helper - the invoice's product names won't be in
                  the catalog, so let the whole lot be created in one click. */}
              {rows.length > 0 && unmatchedCount > 0 && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--p-amber)]/25 bg-[var(--p-amber-soft)] px-3.5 py-2.5">
                  <span className="text-[12px] text-[#8a5a14]">
                    <b>{unmatchedCount}</b> {unmatchedCount === 1 ? "medicine isn't" : "medicines aren't"} in your catalog yet - add them as new products, or pick the matching one per row.
                  </span>
                  <button onClick={markAllNew} className="shrink-0 rounded-md bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] ring-1 ring-[var(--p-border-strong)] hover:ring-[var(--p-blue)]">
                    Add all as new medicines
                  </button>
                </div>
              )}

              {/* ── A PACK THAT DISAGREES WITH THE PRODUCT MASTER ──
                  The single most expensive thing OCR gets wrong here: "15T"
                  read as "157" books 1570 tablets at 12 paise each. Warned,
                  never blocked and never auto-corrected - a distributor really
                  does change pack size between consignments, and only the
                  pharmacist holding the carton can tell the two apart. */}
              {mismatchCount > 0 && (
                <div className="mb-3 rounded-lg border border-[var(--p-amber)]/40 bg-[var(--p-amber-soft)] px-3.5 py-2.5">
                  <p className="text-[12px] leading-relaxed text-[#8a5a14]">
                    <b>{mismatchCount} {mismatchCount === 1 ? "row has" : "rows have"} a pack that isn&apos;t this product&apos;s usual one</b> (highlighted below).
                    Check it against the carton - a &ldquo;15T&rdquo; strip scanned as &ldquo;157&rdquo; would put ten times
                    the stock on the shelf at a tenth of the price. If the distributor really did change the
                    pack, leave it and carry on.
                  </p>
                </div>
              )}

              {/* the rows editor - shared by both tabs */}
              {rows.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-[var(--p-border)]">
                  <table className="w-full min-w-[1180px] border-collapse text-[12px]">
                    <thead>
                      {/* Column order follows the distributor's own invoice,
                          exactly as the Receive screen does, so the paper and
                          the screen are read left-to-right together. */}
                      <tr className="border-b border-[var(--p-border)] bg-[var(--p-bg)] text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                        <th className="px-2 py-2">Product name</th>
                        <th className="px-2 py-2 w-24">Match</th>
                        <th className="px-2 py-2 w-16">Pack</th>
                        <th className="px-2 py-2 w-14 text-right">Qty<span className="block text-[9px] font-normal normal-case">packs</span></th>
                        <th className="px-2 py-2 w-14 text-right">Free<span className="block text-[9px] font-normal normal-case">packs</span></th>
                        <th className="px-2 py-2 w-20 text-right">Units<span className="block text-[9px] font-normal normal-case">on shelf</span></th>
                        <th className="px-2 py-2 w-16">OMrp</th>
                        <th className="px-2 py-2 w-24">Batch</th>
                        <th className="px-2 py-2 w-20 text-right">MRP<span className="block text-[9px] font-normal normal-case">per pack</span></th>
                        <th className="px-2 py-2 w-32">Expiry</th>
                        <th className="px-2 py-2 w-20 text-right">Rate</th>
                        <th className="px-2 py-2 w-14 text-right">GST%</th>
                        <th className="px-2 py-2 w-20">HSN</th>
                        <th className="px-2 py-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const ok = cellOk(r);
                        const p = packOf(r);
                        return (
                          <tr key={i} className="border-b border-[var(--p-border)] last:border-0">
                            <td className="px-1.5 py-1.5">
                              <input list="jeeva-med-names" value={r.medicine} onChange={(e) => setCell(i, "medicine", e.target.value)}
                                placeholder="Medicine name" className={`${inp} min-w-[160px] ${r.medicine && !ok.med ? bad : ""}`} />
                              {r.confidence === "low" && (
                                <div className="mt-0.5 text-[9.5px] font-semibold text-[#8a5a14]">check — read from a blurred line</div>
                              )}
                            </td>
                            <td className="px-1.5 py-1.5 whitespace-nowrap">
                              {ok.matched ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--p-cyan-deep)]"><Icon name="check" size={11} /> in catalog</span>
                              ) : r.createNew ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--p-violet-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--p-violet)]">
                                  New <button onClick={() => toggleNew(i)} aria-label="Don't create" className="ml-0.5 hover:opacity-70">✕</button>
                                </span>
                              ) : r.medicine.trim() ? (
                                <button onClick={() => toggleNew(i)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--p-blue)] ring-1 ring-[var(--p-border-strong)] hover:ring-[var(--p-blue)]">+ add new</button>
                              ) : (
                                <span className="text-[11px] text-[var(--p-muted)]">-</span>
                              )}
                            </td>
                            {/* PACK - the field whose absence was the bug. */}
                            <td className="px-1.5 py-1.5">
                              <input value={r.pack} onChange={(e) => setCell(i, "pack", e.target.value.toUpperCase())}
                                placeholder={p.expected ?? "15T"}
                                className={`${inp} ${p.mismatch ? "!border-[var(--p-amber)] bg-[var(--p-amber-soft)]" : ""}`} />
                              {p.fromMaster && p.label && (
                                <div className="mt-0.5 text-[9.5px] text-[var(--p-muted)]">from master</div>
                              )}
                            </td>
                            <td className="px-1.5 py-1.5"><input inputMode="numeric" value={r.qty} onChange={(e) => setCell(i, "qty", e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className={`${inp} text-right ${r.qty && !ok.qty ? bad : ""}`} /></td>
                            <td className="px-1.5 py-1.5"><input inputMode="numeric" value={r.free} onChange={(e) => setCell(i, "free", e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className={`${inp} text-right ${r.free && !ok.free ? bad : ""}`} /></td>
                            {/* WHAT ACTUALLY REACHES THE SHELF. 3 strips of 15T
                                is 45 tablets. Live, so a wrong pack label is
                                caught here rather than at a stock count. */}
                            <td className="px-1.5 py-1.5 text-right">
                              <div className="text-[12.5px] font-bold text-[var(--p-ink)]">{p.units || "-"}</div>
                              <div className="text-[9.5px] text-[var(--p-muted)]">
                                {p.size > 1 ? `${p.size}/pack` : "loose units"}
                              </div>
                              {p.unitMrp > 0 && p.size > 1 && (
                                <div className="text-[9.5px] font-semibold text-[var(--p-cyan-deep)]">₹{p.unitMrp.toFixed(2)}/unit</div>
                              )}
                            </td>
                            <td className="px-1.5 py-1.5"><input value={r.oMrp} onChange={(e) => setCell(i, "oMrp", e.target.value.toUpperCase())} placeholder="—" className={inp} /></td>
                            <td className="px-1.5 py-1.5"><input value={r.batchNo} onChange={(e) => setCell(i, "batchNo", e.target.value.toUpperCase())} placeholder="On the strip" className={`${inp} ${r.batchNo || !ok.batch ? (ok.batch ? "" : bad) : ""}`} /></td>
                            <td className="px-1.5 py-1.5"><input inputMode="decimal" value={r.mrp} onChange={(e) => setCell(i, "mrp", e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" className={`${inp} text-right ${r.mrp && !ok.mrp ? bad : ""}`} /></td>
                            <td className="px-1.5 py-1.5"><input type="date" min={today} value={r.expiry} onChange={(e) => setCell(i, "expiry", e.target.value)} className={`${inp} ${r.expiry && !ok.expiry ? bad : ""}`} /></td>
                            <td className="px-1.5 py-1.5"><input inputMode="decimal" value={r.rate} onChange={(e) => setCell(i, "rate", e.target.value.replace(/[^\d.]/g, ""))} placeholder="-" className={`${inp} text-right ${r.rate && !ok.rate ? bad : ""}`} /></td>
                            <td className="px-1.5 py-1.5"><input inputMode="decimal" value={r.gst} onChange={(e) => setCell(i, "gst", e.target.value.replace(/[^\d.]/g, ""))} placeholder="—" className={`${inp} text-right`} /></td>
                            <td className="px-1.5 py-1.5"><input inputMode="numeric" value={r.hsn} onChange={(e) => setCell(i, "hsn", e.target.value.replace(/\D/g, ""))} placeholder="—" className={inp} /></td>
                            <td className="px-1.5 py-1.5 text-center"><button onClick={() => removeRow(i)} aria-label="Remove row" className="text-[var(--p-rose)] hover:opacity-70">✕</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <datalist id="jeeva-med-names">{meds.map((m) => <option key={m.id} value={m.name} />)}</datalist>
                </div>
              )}

              {rows.length > 0 && (
                <button onClick={() => setRows((p) => [...p, blankRow()])} className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--p-blue)] hover:underline">
                  <Icon name="plus" size={13} /> Add a row
                </button>
              )}

              {error && <p className="mt-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-2.5 text-[12.5px] text-[var(--p-rose)]">{error}</p>}
            </div>

            {/* footer */}
            <div className="flex items-center justify-between gap-3 border-t border-[var(--p-border)] px-6 py-4">
              <p className="text-[12px] text-[var(--p-muted)]">
                {rows.length === 0 ? "No rows yet." : <><b className="text-[var(--p-ink)]">{validCount}</b> of {rows.length} rows ready{validCount < rows.length ? " · fix the red cells" : ""}</>}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="rounded-md border border-[var(--p-border)] px-4 py-2.5 text-[13px] font-medium text-[var(--p-text)]">Cancel</button>
                <button onClick={submit} disabled={busy || validCount === 0 || !supplierId}
                  title={!supplierId ? "Choose the supplier this invoice is from" : undefined}
                  className="btn-primary inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
                  {busy ? <><Spinner size={14} /> Importing…</> : <><Icon name="check" size={15} /> Import {validCount} {validCount === 1 ? "batch" : "batches"}{newCount > 0 ? ` · ${newCount} new` : ""}</>}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .import-veil { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(7, 26, 32, 0.5); backdrop-filter: blur(2px); }
        .import-sheet { box-shadow: 0 30px 70px -20px rgba(7, 26, 32, 0.5); animation: sheetIn 0.22s cubic-bezier(0.22, 0.68, 0.28, 1) both; }
        @keyframes sheetIn { from { opacity: 0; transform: translateY(10px) scale(0.99); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .import-sheet { animation: none; } }
      `}</style>
    </div>
  );
}
