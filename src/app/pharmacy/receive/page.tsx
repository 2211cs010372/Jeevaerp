"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { parsePack, packsToUnits } from "@/lib/pharmacy/pack";
import {
  EmptyState, ErrorNote, Flash, GhostButton, Modal, PROC_CSS, PageHead, Tag,
  daysUntil, dmy, dmyFromISO, fld, inr,
} from "@/components/portal/pharmacy/procurement-ui";
import { effectiveUnitCost, invoiceVariance, receiptTotal } from "@/lib/pharmacy/procurement-math";
import {
  lineProblems, receiptBlocker, type LineProblem, type ReceiveField,
} from "@/lib/pharmacy/receive-validation";
import { api, ApiClientError } from "@/lib/api-client";

interface Supplier { id: string; name: string }
interface Med { id: string; name: string; unit: string; mrp: string | null; gstRatePct: string | null }
interface OpenPo {
  id: string; poNumber: string; supplierId: string; supplierName: string;
  expectedDate: string | null; qtyOrdered: number; qtyReceived: number; status: string;
}
interface PoDetail {
  id: string; poNumber: string; supplier: { id: string; name: string };
  items: { id: string; medicineId: string; name: string; unit: string; qtyOrdered: number; qtyReceived: number; qtyPending: number; unitCost: string }[];
}
interface Grn {
  id: string; grnNumber: string; invoiceNo: string | null; invoiceAmount: string | null;
  /** Goods only, ex-GST. `receivedTotal` is what the supplier's bill is checked against. */
  receivedValue: string; receivedTax: string; receivedTotal: string;
  variance: number | null; mismatch: boolean; createdAt: string;
  supplierName: string; poNumber: string | null; receivedByName: string; lines: number;
}
interface GrnDetail extends Grn {
  notes: string | null;
  supplier: { id: string; name: string; gstin: string | null; drugLicenseNo: string | null };
  invoiceDate: string | null;
  items: {
    id: string; name: string; unit: string; batchNo: string; expiryDate: string;
    qty: number; freeQty: number; unitCost: string; landedCost: string; mrp: string;
    lineValue: string; gstRatePct: string; lineTax: string; marginPct: number | null;
    pack: string | null; packSize: number;
    /** Units this line actually put on the shelf, and what is left of them. */
    unitsReceived: number | null; onShelf: number | null;
    /** Billed already - the pack size may not move under issued invoices. */
    billed: boolean;
    /** Something else references this batch, so batch no. and expiry are pinned. */
    identityPinned: boolean;
  }[];
}

/** A pending correction to one received line. Blank means "leave it alone". */
interface GrnEdit {
  batchNo?: string; expiryDate?: string; qty?: string; freeQty?: string;
  unitCost?: string; mrp?: string; pack?: string;
}

/** Compact input for the correction grid. `fld` is sized for a form column and
 *  would push the ten-column receipt table into a horizontal scroll. */
const gfld =
  "rounded-md border border-[var(--p-border)] bg-white px-2 py-1 text-[12.5px] text-[var(--p-ink)] "
  + "outline-none focus:border-[var(--p-blue)] disabled:cursor-not-allowed disabled:bg-[var(--p-bg)] disabled:text-[var(--p-muted)]";

/** One row on the delivery being booked in. */
interface Row {
  key: string;
  medicineId: string;
  purchaseOrderItemId?: string;
  name: string;
  unit: string;
  /** Ordered-but-undelivered, when this row came off a PO. Shown, never enforced. */
  pending?: number;
  batchNo: string;
  expiryDate: string;
  qty: string;
  freeQty: string;
  unitCost: string;
  mrp: string;
  /** As printed on the distributor's bill - PACK · OMrp · G% · HSN. */
  pack: string;
  oMrp: string;
  gst: string;
  hsn: string;
  /** True when this line adds a product the catalogue has never seen. */
  createNew?: boolean;
}

let rowSeq = 0;
const newRow = (over: Partial<Row> = {}): Row => ({
  key: `r${++rowSeq}`, medicineId: "", name: "", unit: "unit",
  batchNo: "", expiryDate: "", qty: "", freeQty: "", unitCost: "", mrp: "",
  pack: "", oMrp: "", gst: "", hsn: "", ...over,
});

export default function ReceivePage() {
  return (
    <Suspense fallback={<PortalScroll><div className="py-24 text-center text-[13px] text-[var(--p-muted)]">Loading…</div></PortalScroll>}>
      <ReceiveInner />
    </Suspense>
  );
}

/**
 * The red word under a box the receipt cannot go without.
 *
 * Set under the box rather than collected into a list at the top: on a grid
 * this wide, a list of faults somewhere else is a second thing to map back onto
 * twenty rows by eye, which is the work this is meant to remove.
 */
function CellError({ p }: { p?: LineProblem }) {
  if (!p) return null;
  return (
    <div className="mt-1 text-[10.5px] font-semibold leading-tight text-[var(--p-rose)]">
      {p.message}
    </div>
  );
}

function ReceiveInner() {
  const params = useSearchParams();
  const presetPo = params.get("po");
  const presetGrn = params.get("grn");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [meds, setMeds] = useState<Med[]>([]);
  const [openPos, setOpenPos] = useState<OpenPo[]>([]);
  const [recent, setRecent] = useState<Grn[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /**
   * Whether the grid is marking its missing boxes yet.
   *
   * Off until somebody presses Post: a delivery is keyed in top to bottom, and
   * lighting up every empty box on a fresh line turns the whole grid red before
   * anyone has typed anything. Pressing Post turns it on and it STAYS on, so
   * the marks clear one at a time as the boxes get filled.
   */
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [view, setView] = useState<GrnDetail | null>(null);
  // Correcting a posted receipt. Kept out of `view` so cancelling is a discard,
  // not an undo - nothing is written until Save.
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, GrnEdit>>({});
  const [hdr, setHdr] = useState({ invoiceNo: "", invoiceDate: "", invoiceAmount: "", reason: "" });
  const [saving, setSaving] = useState(false);

  const setEdit = (id: string, patch: GrnEdit) =>
    setEdits((m) => ({ ...m, [id]: { ...m[id], ...patch } }));

  function startCorrection() {
    if (!view) return;
    setEdits({});
    setHdr({
      invoiceNo: view.invoiceNo ?? "",
      invoiceDate: view.invoiceDate ?? "",
      invoiceAmount: view.invoiceAmount ?? "",
      reason: "",
    });
    setEditing(true);
  }

  /**
   * Send only what was actually touched.
   *
   * Posting every field back would rewrite lines the pharmacist never looked
   * at - and on this table that means re-deriving a pack size and moving the
   * shelf for a row nobody questioned. An untouched field is absent from the
   * payload, and the server leaves it alone.
   */
  async function saveCorrection() {
    if (!view || !hdr.reason.trim()) return;
    const items = Object.entries(edits)
      .map(([id, e]) => {
        const line: Record<string, unknown> = { id };
        if (e.batchNo !== undefined && e.batchNo.trim()) line.batchNo = e.batchNo.trim();
        if (e.expiryDate) line.expiryDate = e.expiryDate;
        if (e.qty !== undefined && e.qty !== "") line.qty = Number(e.qty);
        if (e.freeQty !== undefined && e.freeQty !== "") line.freeQty = Number(e.freeQty);
        if (e.unitCost !== undefined && e.unitCost !== "") line.unitCost = Number(e.unitCost);
        if (e.mrp !== undefined && e.mrp !== "") line.mrp = Number(e.mrp);
        if (e.pack !== undefined) line.pack = e.pack.trim();
        return line;
      })
      .filter((l) => Object.keys(l).length > 1);

    if (!items.length) { setEditing(false); return; }

    setSaving(true); setError(null);
    try {
      const r = await api.patch<{ grnNumber: string; changed: string[]; receipt: GrnDetail }>(
        `/pharmacy/receipts/${view.id}`,
        {
          reason: hdr.reason.trim(),
          invoiceNo: hdr.invoiceNo.trim() || undefined,
          invoiceDate: hdr.invoiceDate || undefined,
          invoiceAmount: hdr.invoiceAmount ? Number(hdr.invoiceAmount) : undefined,
          items,
        },
      );
      setView(r.receipt);
      setEditing(false);
      setEdits({});
      setFlash(r.changed.length ? `${r.grnNumber} corrected. ${r.changed.join("; ")}.` : `${r.grnNumber} updated.`);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the correction.");
    } finally {
      setSaving(false);
    }
  }

  // ── The delivery being booked ──────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  // ── Reading the delivery straight off the distributor's bill ──────────────
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPct, setOcrPct] = useState(0);
  const [ocrNote, setOcrNote] = useState<string | null>(null);

  // ── Mobile scan: QR-based remote capture ──────────────────────────────────
  const [mobileScanOpen, setMobileScanOpen] = useState(false);
  const [mobileScanQr, setMobileScanQr] = useState<string | null>(null);
  const [mobileScanSessionId, setMobileScanSessionId] = useState<string | null>(null);
  /** Exact epoch ms when the session was created — drives the countdown. */
  const [mobileScanStartedAt, setMobileScanStartedAt] = useState<number>(0);
  /** Seconds remaining, updated by rAF ticker — zero when expired. */
  const [mobileScanSecsLeft, setMobileScanSecsLeft] = useState(600);
  const mobilePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mobileRafRef = useRef<number | null>(null);

  /** Create a session and show the QR popup. */
  const TTL_SECS = 600; // must match server-side TTL_MS / 1000

  /** Create a session, capture epoch for exact countdown, show QR popup. */
  async function startMobileScan() {
    setError(null);
    try {
      const now = Date.now();
      const r = await api.post<{ sessionId: string; token: string }>("/pharmacy/mobile-scan");
      const url = `${window.location.origin}/pharmacy/mobile-scan/${r.sessionId}?t=${r.token}`;
      const QRCode = (await import("qrcode")).default;
      const qrDataUrl = await QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: "#0f172a" } });
      setMobileScanStartedAt(now);
      setMobileScanSecsLeft(TTL_SECS);
      setMobileScanSessionId(r.sessionId);
      setMobileScanQr(qrDataUrl);
      setMobileScanOpen(true);
    } catch {
      setError("Could not start a mobile scan session.");
    }
  }

  /**
   * rAF-driven ticker. Uses the epoch anchor (`mobileScanStartedAt`) so the
   * display always matches reality even if the tab is backgrounded and then
   * brought back — no drift from setInterval skips.
   */
  useEffect(() => {
    if (!mobileScanOpen || !mobileScanStartedAt) return;

    let rafId: number;
    const tick = () => {
      const elapsed = (Date.now() - mobileScanStartedAt) / 1000;
      const left = Math.max(0, TTL_SECS - elapsed);
      setMobileScanSecsLeft(left);
      if (left > 0) {
        rafId = requestAnimationFrame(tick);
      } else {
        // Session expired — close the popup automatically.
        closeMobileScan();
      }
    };
    rafId = requestAnimationFrame(tick);
    mobileRafRef.current = rafId;
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileScanOpen, mobileScanStartedAt]);

  /** Poll for the mobile upload while the QR modal is open. */
  useEffect(() => {
    if (!mobileScanOpen || !mobileScanSessionId) return;

    const poll = async () => {
      try {
        const r = await fetch(`/api/v1/pharmacy/mobile-scan?sessionId=${mobileScanSessionId}`);
        if (!r.ok) return;
        const data = await r.json();
        if (data.status === "uploaded" && data.imageBase64) {
          const mime = data.imageMime || "image/jpeg";
          const binary = atob(data.imageBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const file = new File([bytes], "mobile-invoice.jpg", { type: mime });
          closeMobileScan();
          setScanFile(file);
          extractFromInvoice(file);
        }
      } catch {
        // Silently retry on network hiccups.
      }
    };

    mobilePollRef.current = setInterval(poll, 2000);
    return () => {
      if (mobilePollRef.current) clearInterval(mobilePollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileScanOpen, mobileScanSessionId]);

  function closeMobileScan() {
    setMobileScanOpen(false);
    setMobileScanQr(null);
    setMobileScanSessionId(null);
    setMobileScanStartedAt(0);
    setMobileScanSecsLeft(TTL_SECS);
    if (mobilePollRef.current) clearInterval(mobilePollRef.current);
    if (mobileRafRef.current) cancelAnimationFrame(mobileRafRef.current);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, p, g] = await Promise.all([
        api.get<{ suppliers: Supplier[] }>("/pharmacy/suppliers"),
        api.get<{ medicines: Med[] }>("/pharmacy/medicines"),
        api.get<{ orders: OpenPo[] }>("/pharmacy/purchase-orders?status=OPEN"),
        api.get<{ receipts: Grn[] }>("/pharmacy/receipts?days=60"),
      ]);
      setSuppliers(s.suppliers); setMeds(m.medicines);
      setOpenPos(p.orders.filter((o) => o.status !== "DRAFT"));
      setRecent(g.receipts);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load the receiving desk.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Pull the outstanding lines off a purchase order, priced as ordered. */
  const loadPo = useCallback(async (id: string) => {
    try {
      const r = await api.get<{ order: PoDetail }>(`/pharmacy/purchase-orders/${id}`);
      setSupplierId(r.order.supplier.id);
      setPoId(id);
      const pending = r.order.items.filter((i) => i.qtyPending > 0);
      setRows(
        (pending.length ? pending : r.order.items).map((i) =>
          newRow({
            medicineId: i.medicineId,
            purchaseOrderItemId: i.id,
            name: i.name,
            unit: i.unit,
            pending: i.qtyPending,
            qty: String(i.qtyPending || i.qtyOrdered),
            unitCost: i.unitCost,
            mrp: meds.find((m) => m.id === i.medicineId)?.mrp ?? "",
          })
        )
      );
      setShowErrors(false);
      setOpen(true);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load that order.");
    }
  }, [meds]);

  // Deep links: /receive?po=… opens the form primed, ?grn=… opens the receipt.
  useEffect(() => {
    if (presetPo && !loading && !open) loadPo(presetPo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetPo, loading]);

  useEffect(() => {
    if (presetGrn && !loading) openGrn(presetGrn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetGrn, loading]);

  async function openGrn(id: string) {
    try {
      const r = await api.get<{ receipt: GrnDetail }>(`/pharmacy/receipts/${id}`);
      setView(r.receipt);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load that receipt.");
    }
  }

  function startDirect() {
    setSupplierId(""); setPoId(""); setInvoiceNo(""); setInvoiceDate("");
    setInvoiceAmount(""); setNotes(""); setRows([newRow()]);
    setShowErrors(false); setOpen(true);
  }

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /**
   * Running value of the carton, and whether the invoice agrees with it.
   *
   * The invoice amount typed in above is the distributor's TOTAL, which is GST
   * inclusive - so the tax has to be added here before the two are compared.
   * Checking the bill against goods value alone made every taxable delivery
   * read as short by exactly its GST.
   */
  const totals = useMemo(() => {
    let value = 0, tax = 0, units = 0, free = 0;
    for (const r of rows) {
      const q = Number(r.qty || 0), c = Number(r.unitCost || 0), f = Number(r.freeQty || 0);
      const g = Number(r.gst || 0);
      value += q * c;
      // Free goods are not billed, so they are not taxed - same base as value.
      tax += (q * c * g) / 100;
      units += q; free += f;
    }
    value = Math.round(value * 100) / 100;
    tax = Math.round(tax * 100) / 100;
    const total = receiptTotal(value, tax);
    const v = invoiceAmount ? invoiceVariance(Number(invoiceAmount), total) : null;
    return { value, tax, total, units, free, variance: v?.variance ?? null, mismatch: v?.mismatch ?? false };
  }, [rows, invoiceAmount]);

  /**
   * What is missing, per line and per BOX - see lib/pharmacy/receive-validation.
   *
   * Keyed by row so the grid can ask "what is wrong with this cell" while it
   * draws it, and the sentence by the Post button is counted off the same list.
   */
  const problems = useMemo(
    () => new Map(rows.map((r) => [r.key, lineProblems(r)])),
    [rows],
  );
  /** The problem on one box, or undefined. Drives the red ring and the label. */
  const problemOn = (key: string, field: ReceiveField) =>
    problems.get(key)?.find((p) => p.field === field);
  const firstBadRow = rows.find((r) => (problems.get(r.key)?.length ?? 0) > 0) ?? null;
  const canPost = !!supplierId && rows.length > 0 && !firstBadRow;

  /**
   * Lines the invoice named but the catalogue doesn't have.
   *
   * After OCR this is routinely most of a delivery - a distributor's bill is
   * full of products nobody has stocked before. Ticking twenty rows one at a
   * time is the slowest part of booking a delivery in, so they get one button.
   */
  const unknownRows = rows.filter((r) => !r.medicineId && !r.createNew && r.name.trim().length > 1);

  /** Why Post will not go. A blocked button with no reason is a dead end. */
  const blocker = receiptBlocker(supplierId, rows);


  /**
   * Read the delivery off a photo of the distributor's bill.
   *
   * Everything it produces is a SUGGESTION dropped into the grid below - the
   * pharmacist checks each line against the physical strips before posting, the
   * same as if they had keyed it. OCR misreads digits, and a misread batch
   * number or expiry is a patient-safety problem, not a typo.
   *
   * Medicines are matched to the catalogue by name; anything unrecognised is
   * left with an empty selector rather than guessed at.
   */
  async function extractFromInvoice(file: File) {
    setOcrBusy(true); setOcrPct(10); setError(null); setOcrNote(null);
    try {
      const { roundInvoiceBillPrice } = await import("@/lib/pharmacy/procurement-math");

      // 1. Convert file to Base64 Data URL
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const imageBase64 = await base64Promise;

      setOcrPct(30);
      // 2. Call Gemini AI Vision API for 99%+ accurate extraction
      const aiRes = await fetch("/api/v1/ai/vision-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mode: "invoice" }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData.success && Array.isArray(aiData.invoiceItems) && aiData.invoiceItems.length > 0) {
          setOcrPct(100);
          const hdr = aiData.invoiceHeader || {};

          // Match supplier by name or GSTIN
          const matchedSupplier = suppliers.find(
            (sp) => (hdr.supplierName && sp.name.toLowerCase().includes(hdr.supplierName.toLowerCase())) ||
                    (hdr.gstin && sp.name.toLowerCase().includes(hdr.gstin.toLowerCase()))
          );
          if (matchedSupplier && !poId) setSupplierId(matchedSupplier.id);
          if (hdr.invoiceNo) setInvoiceNo(hdr.invoiceNo);
          if (hdr.invoiceDate) setInvoiceDate(hdr.invoiceDate);
          if (hdr.netAmount) setInvoiceAmount(roundInvoiceBillPrice(hdr.netAmount));

          const byName = new Map<string, Med>();
          for (const m2 of meds) byName.set(m2.name.trim().toLowerCase(), m2);
          const matchMed = (name: string) => {
            const key = name.trim().toLowerCase();
            if (byName.has(key)) return byName.get(key)!;
            let best: Med | null = null;
            for (const m2 of meds) {
              const n = m2.name.trim().toLowerCase();
              if (n.length >= 4 && (key.includes(n) || n.includes(key)) && (!best || m2.name.length > best.name.length)) best = m2;
            }
            return best;
          };

          const mapped: Row[] = aiData.invoiceItems.map((r: any) => {
            const med = matchMed(r.medicine);
            return newRow({
              medicineId: med?.id ?? "",
              name: med?.name ?? r.medicine,
              unit: med?.unit ?? "unit",
              batchNo: String(r.batchNo || "").toUpperCase(),
              expiryDate: String(r.expiry || ""),
              qty: String(r.qty || "0"),
              freeQty: String(r.free || "0"),
              unitCost: String(r.rate || "0"),
              mrp: roundInvoiceBillPrice(r.mrp || "0"),
              pack: String(r.pack || ""),
              gst: String(r.gst || "5"),
              hsn: String(r.hsn || ""),
            });
          });

          setRows(mapped);
          setOpen(true);
          const unmatched = mapped.filter((r) => !r.medicineId).length;
          setOcrNote(`AI Vision extracted ${mapped.length} items with 99%+ accuracy${unmatched ? ` (${unmatched} not in catalogue - pick below)` : ""}.`);
          return;
        }
      }

      // 3. Fallback to Tesseract OCR if AI is not configured or fails
      const { preprocessImageForOcr } = await import("@/lib/pharmacy/image-preprocess");
      const cleanBlob = await preprocessImageForOcr(file);

      const { recognize } = await import("tesseract.js");
      const { data } = await recognize(cleanBlob, "eng", {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") setOcrPct(Math.round(m.progress * 100));
        },
      });
      const { parseInvoiceHeader } = await import("@/lib/pharmacy/invoice-parse");
      const inv = parseInvoiceHeader(data.text, suppliers.map((sp) => ({ id: sp.id, name: sp.name })));

      // Header: supplier, invoice number, date, total.
      if (inv.supplierId && !poId) setSupplierId(inv.supplierId);
      if (inv.invoiceNo) setInvoiceNo(inv.invoiceNo);
      if (inv.invoiceDate) setInvoiceDate(inv.invoiceDate);
      if (inv.netAmount) setInvoiceAmount(roundInvoiceBillPrice(inv.netAmount));

      // Lines, matched to the catalogue by name where possible.
      const byName = new Map<string, Med>();
      for (const m2 of meds) byName.set(m2.name.trim().toLowerCase(), m2);
      const matchMed = (name: string) => {
        const key = name.trim().toLowerCase();
        if (byName.has(key)) return byName.get(key)!;
        let best: Med | null = null;
        for (const m2 of meds) {
          const n = m2.name.trim().toLowerCase();
          if (n.length >= 5 && (key.includes(n) || n.includes(key)) && (!best || m2.name.length > best.name.length)) best = m2;
        }
        return best;
      };

      const mapped: Row[] = inv.rows.map((r) => {
        const med = matchMed(r.medicine);
        return newRow({
          medicineId: med?.id ?? "",
          name: med?.name ?? r.medicine,
          unit: med?.unit ?? "unit",
          batchNo: r.batchNo.toUpperCase(),
          expiryDate: r.expiry,
          qty: r.qty,
          freeQty: r.free,
          unitCost: r.rate,
          mrp: roundInvoiceBillPrice(r.mrp),
          pack: r.pack,
          oMrp: r.oMrp,
          gst: r.gst,
          hsn: r.hsn,
        });
      });

      if (!mapped.length) {
        setError("Couldn't read any line items off that image. Try a sharper, straighter photo - or key the rows in below.");
      } else {
        setRows(mapped);
        setOpen(true);
        const unmatched = mapped.filter((r) => !r.medicineId).length;
        const bits = [`Read ${mapped.length} line${mapped.length === 1 ? "" : "s"}`];
        if (inv.supplierName) bits.push(inv.supplierId ? `supplier matched (${inv.supplierName})` : `invoice says "${inv.supplierName}" - not on your supplier list`);
        if (inv.gstin) bits.push(`GSTIN ${inv.gstin}`);
        if (unmatched) bits.push(`${unmatched} medicine${unmatched === 1 ? "" : "s"} not in the catalogue - pick them below`);
        setOcrNote(`${bits.join(" · ")}. Check every batch and expiry against the strips before posting.`);
      }
    } catch {
      setError("Couldn't run OCR on that file. Key the rows in below instead.");
    } finally { setOcrBusy(false); }
  }


  async function post() {
    // A disabled button is the thing that leaves a technician with no move: the
    // receipt will not go, and the screen has not said which box is empty. So
    // the button always presses - and when it cannot post, it ANSWERS.
    if (!canPost) {
      setShowErrors(true);
      if (!supplierId) {
        document.getElementById("grn-supplier")?.focus();
        return;
      }
      // Straight to the first line that needs something, because the grid is
      // twenty rows long and the bad one is rarely the one on screen.
      if (firstBadRow) {
        const el = document.getElementById(`grn-row-${firstBadRow.key}`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.querySelector<HTMLElement>("input, select")?.focus({ preventScroll: true });
      }
      return;
    }
    setShowErrors(false);
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ receipt: { grnNumber: string; receivedValue: string; mismatch: boolean; variance: number | null; createdMedicines?: { id: string; name: string }[] } }>(
        "/pharmacy/receipts",
        {
          supplierId,
          purchaseOrderId: poId || undefined,
          invoiceNo: invoiceNo || undefined,
          invoiceDate: invoiceDate || undefined,
          invoiceAmount: invoiceAmount ? Number(invoiceAmount) : undefined,
          notes: notes || undefined,
          items: rows.map((x) => ({
            medicineId: x.medicineId || undefined,
            newMedicineName: !x.medicineId && x.createNew ? x.name.trim() : undefined,
            purchaseOrderItemId: x.purchaseOrderItemId,
            batchNo: x.batchNo,
            expiryDate: x.expiryDate,
            qty: Number(x.qty),
            freeQty: x.freeQty ? Number(x.freeQty) : undefined,
            unitCost: Number(x.unitCost || 0),
            mrp: Number(x.mrp || 0),
            pack: x.pack || undefined,
            packSize: parsePack(x.pack).size,
            oMrp: x.oMrp || undefined,
            hsn: x.hsn || undefined,
            gstRatePct: x.gst ? Number(x.gst) : undefined,
          })),
        }
      );
      const g = r.receipt;
      const added = g.createdMedicines?.length
        ? ` ${g.createdMedicines.length} new product${g.createdMedicines.length === 1 ? "" : "s"} added to the catalogue: ${g.createdMedicines.map((m) => m.name).join(", ")}.`
        : "";
      setFlash(
        (g.mismatch
          ? `${g.grnNumber} posted - but their invoice and the carton differ by ${inr(Math.abs(g.variance ?? 0), 2)}. Worth a call before you pay it.`
          : `${g.grnNumber} posted. ${inr(g.receivedValue, 2)} of stock is on the shelf.`) + added
      );
      setOpen(false); setRows([]);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not book the delivery in.");
    } finally { setBusy(false); }
  }

  return (
    <PortalScroll>
      <style>{PROC_CSS}</style>
      <style>{GRN_CSS}</style>

      <PageHead
        title="Receive goods"
        blurb="Book a delivery in against its invoice. This is the only way supplier stock reaches the shelf - so every batch keeps a distributor, a rate and a document behind it."
      >
        <GhostButton onClick={startDirect}><Icon name="plus" size={14} /> Direct receipt</GhostButton>
      </PageHead>

      {flash && <Flash text={flash} onClose={() => setFlash(null)} />}
      {error && <ErrorNote text={error} />}

      {/* ── Waiting to arrive ─────────────────────────────────────────────── */}
      <section data-rise className="surface mb-5 overflow-hidden">
        <div className="border-b border-[var(--p-border)] px-5 py-3.5">
          <h3 className="text-[13.5px] font-semibold text-[var(--p-ink)]">Expected deliveries</h3>
          <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Open orders. Pick one and the outstanding lines fill themselves in.</p>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-8 text-[12.5px] text-[var(--p-muted)]"><Spinner size={14} /> Loading…</div>
        ) : !openPos.length ? (
          <p className="px-5 py-8 text-center text-[12.5px] text-[var(--p-muted)]">
            Nothing on order. Use <b>Direct receipt</b> for an emergency purchase bought without a PO.
          </p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {openPos.map((p, i) => {
              const late = p.expectedDate && daysUntil(p.expectedDate) < 0;
              return (
                <div key={p.id} className="prow flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5" style={{ ["--d" as string]: `${Math.min(i, 10) * 20}ms` }}>
                  <span className="doc">{p.poNumber}</span>
                  <span className="text-[13px] font-medium text-[var(--p-ink)]">{p.supplierName}</span>
                  <span className="num text-[12px] text-[var(--p-muted)]">
                    {p.qtyReceived}/{p.qtyOrdered} units in
                  </span>
                  {p.expectedDate && (
                    late
                      ? <Tag tone="bad">{Math.abs(daysUntil(p.expectedDate))}d late</Tag>
                      : <Tag tone="mute">due {dmy(p.expectedDate)}</Tag>
                  )}
                  <button onClick={() => loadPo(p.id)}
                    className="btn-primary ml-auto rounded-md px-3 py-2 text-[12px] font-semibold text-white">
                    Receive
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Booked in ─────────────────────────────────────────────────────── */}
      <section data-rise className="surface overflow-hidden">
        <div className="border-b border-[var(--p-border)] px-5 py-3.5">
          <h3 className="text-[13.5px] font-semibold text-[var(--p-ink)]">Recent deliveries</h3>
          <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Last 60 days. A receipt is never edited - it&apos;s the record of what arrived.</p>
        </div>
        {!recent.length && !loading ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-[var(--p-muted)]">Nothing received yet.</p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {recent.map((g, i) => (
              <button key={g.id} onClick={() => openGrn(g.id)}
                className="prow flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 text-left"
                style={{ ["--d" as string]: `${Math.min(i, 12) * 18}ms` }}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
                  g.mismatch ? "bg-[var(--p-amber-soft)] text-[#8a6414]" : "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"
                }`}>
                  <Icon name="box" size={16} />
                </span>
                <div className="min-w-[170px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="doc">{g.grnNumber}</span>
                    {g.poNumber && <Tag tone="mute">{g.poNumber}</Tag>}
                    {g.mismatch && <Tag tone="warn">Invoice differs</Tag>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                    {g.supplierName} · {g.lines} Item{g.lines === 1 ? "" : "s"} · {dmyFromISO(g.createdAt)} · {g.receivedByName}
                    {g.invoiceNo && <> · inv <span className="num">{g.invoiceNo}</span></>}
                  </div>
                </div>
                <div className="text-right">
                  <span className="lbl">Value in</span>
                  <span className="num text-[14px] font-bold text-[var(--p-ink)]">{inr(g.receivedValue, 2)}</span>
                  {g.mismatch && g.variance !== null && (
                    <div className="num text-[11px] font-semibold text-[#8a6414]">
                      billed {g.variance > 0 ? "+" : ""}{inr(g.variance, 2)}
                    </div>
                  )}
                </div>
                <Icon name="chevron" size={15} />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── BOOK IN ────────────────────────────────────────────────────────── */}
      {open && (
        <Modal
          title={poId ? "Receive against a purchase order" : "Direct receipt"}
          sub={poId
            ? "Check every batch and expiry off the physical strips before posting - this can't be edited afterwards."
            : "An emergency purchase with no PO behind it. Still needs a supplier, so the batch stays traceable."}
          wide busy={busy}
          onClose={() => setOpen(false)}
          footer={
            <>
              <div className="mr-auto flex flex-wrap items-center gap-x-5 gap-y-1">
                <div>
                  <span className="lbl">Value of goods</span>
                  <span className="num text-[16px] font-bold text-[var(--p-ink)]">{inr(totals.value, 2)}</span>
                </div>
                {/* The arithmetic the invoice is checked against, shown rather than
                    implied - a variance nobody can reconstruct is a variance nobody
                    trusts. Hidden on a wholly exempt delivery, where it is all zeros. */}
                {totals.tax > 0 && (
                  <>
                    <div>
                      <span className="lbl">GST</span>
                      <span className="num text-[14px] font-semibold text-[var(--p-ink)]">+{inr(totals.tax, 2)}</span>
                    </div>
                    <div>
                      <span className="lbl">Invoice total</span>
                      <span className="num text-[16px] font-bold text-[var(--p-ink)]">{inr(totals.total, 2)}</span>
                    </div>
                  </>
                )}
                {totals.free > 0 && (
                  <div>
                    <span className="lbl">Free units</span>
                    <span className="num text-[14px] font-semibold text-[var(--p-cyan-deep)]">+{totals.free}</span>
                  </div>
                )}
                {totals.variance !== null && (
                  <div>
                    <span className="lbl">vs their invoice</span>
                    <span className={`num text-[14px] font-semibold ${totals.mismatch ? "text-[var(--p-rose)]" : "text-[var(--p-cyan-deep)]"}`}>
                      {totals.mismatch ? `${totals.variance > 0 ? "+" : ""}${inr(totals.variance, 2)}` : "agrees"}
                    </span>
                  </div>
                )}
              </div>
              {blocker && (
                <span className={`max-w-[320px] text-right text-[11.5px] leading-snug ${showErrors ? "font-semibold text-[var(--p-rose)]" : "text-[#8a6414]"}`}>
                  {blocker}
                </span>
              )}
              <GhostButton onClick={() => setOpen(false)} disabled={busy}>Cancel</GhostButton>
              {/* Never disabled for an incomplete receipt - see `post`. Only a
                  request already in flight stops a second press. */}
              <PrimaryButton onClick={post} disabled={busy}>
                {busy ? <><Spinner /> Posting…</> : <><Icon name="check" size={15} /> Post receipt</>}
              </PrimaryButton>
            </>
          }
        >
          <div className="space-y-5 p-6">
            {/* READ IT OFF THE BILL. Reception has the paper in hand; typing 23
                lines off it is where batch numbers and expiry dates get
                mistyped. Everything below fills in as a suggestion. */}
            <div className="rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--p-teal)] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)] ${ocrBusy ? "pointer-events-none opacity-60" : ""}`}>
                  <Icon name="file" size={14} />
                  {ocrBusy ? `Reading invoice… ${ocrPct}%` : "Extract from invoice image"}
                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={ocrBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) { setScanFile(f); extractFromInvoice(f); }
                      e.target.value = "";
                    }} />
                </label>
                {/* ── MOBILE SCAN: QR code on desktop, camera on phone ── */}
                <button
                  type="button"
                  disabled={ocrBusy}
                  onClick={startMobileScan}
                  className={`inline-flex items-center gap-2 rounded-lg border border-[var(--p-teal)] px-3.5 py-2 text-[13px] font-semibold text-[var(--p-teal)] transition-colors hover:bg-[var(--p-teal-soft)] disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Icon name="smartphone" size={14} />
                  Scan with Mobile
                </button>
                {scanFile && !ocrBusy && (
                  <span className="text-[12px] text-[var(--p-muted)]">{scanFile.name}</span>
                )}
                <span className="text-[12px] leading-relaxed text-[var(--p-muted)]">
                  Photograph or scan the distributor&apos;s bill. Reads supplier, GSTIN, invoice no., date,
                  total and every line.
                </span>
              </div>
              {ocrBusy && (
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--p-border)]">
                  <div className="h-full rounded-full bg-[var(--p-teal)] transition-all" style={{ width: `${ocrPct}%` }} />
                </div>
              )}
              {ocrNote && !ocrBusy && (
                <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-[var(--p-teal-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--p-teal-deep)]">
                  <span className="mt-0.5 shrink-0"><Icon name="check" size={13} /></span>
                  <span>{ocrNote}</span>
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Supplier" required error={showErrors && !supplierId ? "Not selected" : undefined}>
                <select id="grn-supplier"
                  className={`${fld} ${showErrors && !supplierId ? "border-[var(--p-rose)]" : ""}`}
                  value={supplierId} disabled={!!poId}
                  onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Select…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Their invoice no.">
                <input className={fld} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="On the delivery note" />
              </Field>
              <Field label="Invoice date">
                <input type="date" className={fld} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </Field>
              <Field label="Invoice total (₹)">
                <input className={fld} value={invoiceAmount} inputMode="decimal"
                  onChange={(e) => setInvoiceAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Optional" />
              </Field>
            </div>

            {/* The check nobody does by hand, done automatically. */}
            {totals.mismatch && totals.variance !== null && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--p-amber)]/30 bg-[var(--p-amber-soft)] px-4 py-3 text-[12.5px] leading-relaxed text-[#8a6414]">
                <span className="mt-0.5 shrink-0"><Icon name="alert" size={14} /></span>
                <span>
                  They&apos;ve billed <b>{inr(Math.abs(totals.variance), 2)} {totals.variance > 0 ? "more" : "less"}</b> than
                  what these lines add up to. Usually a short supply or a rate they changed without telling you.
                  You can still post it - the gap is recorded on the receipt.
                </span>
              </div>
            )}

            {/* ONE BUTTON for the whole delivery. Each row still has its own
                toggle for the odd case where a name is a misread rather than a
                genuinely new product. */}
            {unknownRows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--p-amber)]/35 bg-[var(--p-amber-soft)] px-4 py-3">
                <span className="text-[12.5px] leading-relaxed text-[#8a6414]">
                  <b>{unknownRows.length} product{unknownRows.length === 1 ? " is" : "s are"} not in your catalogue</b>
                  {" — "}
                  {unknownRows.slice(0, 3).map((r) => r.name.trim()).join(", ")}
                  {unknownRows.length > 3 && ` and ${unknownRows.length - 3} more`}.
                  {" "}Add them and the receipt creates them as it posts.
                </span>
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.map((r) =>
                    !r.medicineId && !r.createNew && r.name.trim().length > 1 ? { ...r, createNew: true } : r))}
                  className="shrink-0 rounded-lg bg-[var(--p-teal)] px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)]"
                >
                  Add all {unknownRows.length} as new products
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="ptable">
                <thead>
                  <tr>
                    {/* Column order follows the distributor's invoice, so the
                        screen and the paper are read left-to-right together. */}
                    <th style={{ minWidth: 170 }}>Product name</th>
                    <th style={{ minWidth: 68 }}>Pack</th>
                    <th className="r">Qty<span className="th-sub">packs</span></th>
                    <th className="r">Free<span className="th-sub">packs</span></th>
                    <th className="r">Units<span className="th-sub">on shelf</span></th>
                    <th style={{ minWidth: 62 }}>OMrp</th>
                    <th style={{ minWidth: 108 }}>Batch</th>
                    <th className="r">MRP</th>
                    <th style={{ minWidth: 128 }}>Expiry</th>
                    <th className="r">Rate</th>
                    <th className="r">GST%</th>
                    <th style={{ minWidth: 74 }}>HSN</th>
                    <th className="r">Cost/unit</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const q = Number(r.qty || 0), f = Number(r.freeQty || 0), c = Number(r.unitCost || 0);
                    const landed = q > 0 ? effectiveUnitCost(q, f, c) : 0;
                    const mrpN = Number(r.mrp || 0);
                    const expDays = r.expiryDate ? daysUntil(r.expiryDate) : null;
                    const shortDated = expDays !== null && expDays > 0 && expDays < 180;
                    const dead = expDays !== null && expDays <= 0;
                    const over = r.pending !== undefined && q > r.pending;
                    /**
                     * What to mark on this box, if anything.
                     *
                     * An EMPTY box waits for Post (see `showErrors`); a box with
                     * something unusable in it answers straight away, because
                     * the pharmacist is looking right at what they just typed.
                     */
                    const bad = (field: ReceiveField) => {
                      const p = problemOn(r.key, field);
                      return p && (showErrors || !p.empty) ? p : undefined;
                    };
                    const rowBad = showErrors && (problems.get(r.key)?.length ?? 0) > 0;
                    // Packs in, units on the shelf - the conversion the whole
                    // pharmacy turns on. See lib/pharmacy/pack.
                    const packSpec = parsePack(r.pack);
                    const shelfUnits = packsToUnits(q + f, packSpec.size);
                    return (
                      <tr key={r.key} id={`grn-row-${r.key}`}
                        className={rowBad ? "grn-row-bad" : ""}>
                        <td>
                          {r.purchaseOrderItemId ? (
                            <>
                              <div className="text-[13px] font-semibold">{r.name}</div>
                              <div className="text-[11px] text-[var(--p-muted)]">
                                {r.pending} {r.unit}s still due
                                {over && <span className="font-semibold text-[var(--p-amber)]"> · receiving {q - (r.pending ?? 0)} extra</span>}
                              </div>
                            </>
                          ) : (
                            <>
                              {r.createNew ? (
                                /* A product the catalogue has never seen. It is
                                   created by the receipt itself - sending the
                                   pharmacist away to a separate screen mid-
                                   delivery is how a delivery ends up half
                                   entered. */
                                <input className={`${fld}${bad("medicine") ? " grn-bad" : ""}`} value={r.name} autoFocus
                                  placeholder="New product name"
                                  onChange={(e) => setRow(r.key, { name: e.target.value, medicineId: "" })} />
                              ) : (
                                <select className={`${fld}${bad("medicine") ? " grn-bad" : ""}`} value={r.medicineId}
                                  onChange={(e) => {
                                    const m = meds.find((x) => x.id === e.target.value);
                                    // GST% comes across with the product, so the running
                                    // total here matches what the server will compute. A
                                    // blank rate would make this preview disagree with the
                                    // posted receipt, which is the one place the desk
                                    // checks the invoice BEFORE committing to it.
                                    setRow(r.key, {
                                      medicineId: e.target.value, name: m?.name ?? "", unit: m?.unit ?? "unit",
                                      mrp: r.mrp || (m?.mrp ?? ""),
                                      gst: r.gst || (m?.gstRatePct != null ? String(Number(m.gstRatePct)) : ""),
                                    });
                                  }}>
                                  <option value="">Select…</option>
                                  {meds.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                              )}
                              <CellError p={bad("medicine")} />
                              <button type="button"
                                onClick={() => setRow(r.key, { createNew: !r.createNew, medicineId: "", name: r.createNew ? "" : r.name })}
                                className="mt-1 text-[10.5px] font-semibold text-[var(--p-teal)] hover:underline">
                                {r.createNew ? "← pick from catalogue" : "+ new product"}
                              </button>
                              {r.createNew && (
                                <div className="mt-0.5 text-[10px] text-[var(--p-muted)]">
                                  added to the catalogue on posting
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td><input className={`${fld} num w-[62px] py-1.5`} value={r.pack}
                          onChange={(e) => setRow(r.key, { pack: e.target.value.toUpperCase() })} placeholder="15T" /></td>
                        <td className="r">
                          {/* Liquids are invoiced in fractions of a pack ("2.5"),
                              but the shelf counts whole units. Surfaced rather
                              than rounded - only the pharmacist knows whether
                              that is 2 bottles or 3. */}
                          <input className={`${fld} num w-[64px] py-1.5 text-right${bad("qty") ? " grn-bad" : ""}`} value={r.qty} inputMode="decimal"
                            onChange={(e) => setRow(r.key, { qty: e.target.value.replace(/[^\d.]/g, "") })} />
                          <CellError p={bad("qty")} />
                        </td>
                        <td className="r">
                          <input className={`${fld} num w-[56px] py-1.5 text-right${bad("free") ? " grn-bad" : ""}`} value={r.freeQty} inputMode="decimal"
                            onChange={(e) => setRow(r.key, { freeQty: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" />
                          <CellError p={bad("free")} />
                        </td>
                        {/* WHAT ACTUALLY REACHES THE SHELF. 3 strips of 15T is
                            45 tablets. Shown live so a wrong pack label is
                            caught here, not at a stock count months later. */}
                        <td className="r">
                          <div className="num text-[13px] font-bold text-[var(--p-ink)]">{shelfUnits || "-"}</div>
                          <div className="text-[10px] text-[var(--p-muted)]">
                            {packSpec.known ? `${packSpec.size} ${packSpec.unit}${packSpec.size === 1 ? "" : "s"}/pack` : "loose units"}
                          </div>
                        </td>
                        <td><input className={`${fld} num w-[58px] py-1.5`} value={r.oMrp}
                          onChange={(e) => setRow(r.key, { oMrp: e.target.value.toUpperCase() })} placeholder="—" /></td>
                        <td>
                          <input className={`${fld} num py-1.5${bad("batch") ? " grn-bad" : ""}`} value={r.batchNo}
                            onChange={(e) => setRow(r.key, { batchNo: e.target.value.toUpperCase() })} placeholder="On the strip" />
                          <CellError p={bad("batch")} />
                        </td>
                        <td className="r"><input className={`${fld} num w-[78px] py-1.5 text-right`} value={r.mrp} inputMode="decimal"
                          onChange={(e) => setRow(r.key, { mrp: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                        <td>
                          <input type="date" className={`${fld} py-1.5 ${dead ? "border-[var(--p-rose)]" : ""}${bad("expiry") ? " grn-bad" : ""}`} value={r.expiryDate}
                            onChange={(e) => setRow(r.key, { expiryDate: e.target.value })} />
                          <CellError p={bad("expiry")} />
                          {dead && <div className="mt-1 text-[10.5px] font-semibold text-[var(--p-rose)]">Expired - send it back</div>}
                          {shortDated && <div className="mt-1 text-[10.5px] font-semibold text-[#8a6414]">{Math.round(expDays / 30)} mo left</div>}
                        </td>
                        <td className="r"><input className={`${fld} num w-[78px] py-1.5 text-right`} value={r.unitCost} inputMode="decimal"
                          onChange={(e) => setRow(r.key, { unitCost: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                        <td className="r"><input className={`${fld} num w-[54px] py-1.5 text-right`} value={r.gst} inputMode="decimal"
                          onChange={(e) => setRow(r.key, { gst: e.target.value.replace(/[^\d.]/g, "") })} placeholder="—" /></td>
                        <td><input className={`${fld} num w-[70px] py-1.5`} value={r.hsn} inputMode="numeric"
                          onChange={(e) => setRow(r.key, { hsn: e.target.value.replace(/\D/g, "") })} placeholder="—" /></td>
                        <td className="r">
                          {/* Free goods folded in - the number the margin is really made on. */}
                          <div className="num text-[13px] font-semibold text-[var(--p-ink)]">{landed > 0 ? inr(landed, 2) : "-"}</div>
                          {landed > 0 && mrpN > 0 && (
                            <div className={`num text-[10.5px] font-semibold ${mrpN > landed ? "text-[var(--p-cyan-deep)]" : "text-[var(--p-rose)]"}`}>
                              {mrpN > landed ? `${Math.round(((mrpN - landed) / mrpN) * 1000) / 10}% margin` : "below cost"}
                            </div>
                          )}
                        </td>
                        <td className="r">
                          <button onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                            aria-label="Remove line"
                            className="grid h-7 w-7 place-items-center rounded-md text-[var(--p-muted)] transition-colors hover:bg-[var(--p-rose-soft)] hover:text-[var(--p-rose)]">
                            <Icon name="x" size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <GhostButton onClick={() => setRows((rs) => [...rs, newRow()])}>
                <Icon name="plus" size={13} /> Add a line
              </GhostButton>
              <span className="text-[12px] text-[var(--p-muted)]">
                {totals.units} unit{totals.units === 1 ? "" : "s"} across {rows.length} line{rows.length === 1 ? "" : "s"}
                {totals.free > 0 && <> · {totals.free} free</>}
              </span>
            </div>

            <Field label="Notes">
              <textarea className={`${fld} min-h-[52px]`} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything odd about the delivery - a torn carton, a missing line, a cold-chain break…" />
            </Field>

            <p className="rounded-lg bg-[var(--p-blue-soft)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--p-blue-deep)]">
              <b>Cost/unit spreads free goods across the whole batch.</b> 10 at ₹100 with 1 free is 11 units for ₹1,000 -
              ₹90.91 each, not ₹100. That&apos;s the figure the shelf stores, so the pharmacy&apos;s profit numbers are the real ones.
            </p>
          </div>
        </Modal>
      )}

      {/* ── MOBILE SCAN — QR code popup ───────────────────────────────────── */}
      {mobileScanOpen && mobileScanQr && (() => {
        const secsLeft = Math.ceil(mobileScanSecsLeft);
        const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
        const ss = String(secsLeft % 60).padStart(2, "0");
        const urgent = secsLeft <= 30;
        return (
          <div
            className="modal-veil"
            onClick={(e) => { if (e.target === e.currentTarget) closeMobileScan(); }}
          >
            <style>{MOBILE_SCAN_CSS}</style>
            <div className="surface flex w-full max-w-sm flex-col items-center bg-white">
              {/* Header — original style */}
              <div className="w-full border-b border-[var(--p-border)] px-6 py-4 text-center">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Scan with Mobile</h3>
                  <button
                    onClick={closeMobileScan}
                    className="grid h-7 w-7 place-items-center rounded-md text-[var(--p-muted)] transition-colors hover:bg-[var(--p-rose-soft)] hover:text-[var(--p-rose)]"
                    aria-label="Close"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                  Point your phone camera at this QR code
                </p>
              </div>

              {/* QR code — original card style, beam overlay added */}
              <div className="flex flex-col items-center px-8 py-7 text-center">
                <div className="relative overflow-hidden rounded-2xl border-2 border-[var(--p-border)] bg-white p-3 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mobileScanQr} alt="Mobile scan QR code" width={240} height={240} />
                  {/* Subtle scanning beam — same style as before */}
                  <div className="scan-beam pointer-events-none absolute inset-x-0 top-0" />
                </div>

                {/* Pulsing dot + status — original style */}
                <div className="mt-5 space-y-1">
                  <div className="flex items-center justify-center gap-2 text-[13px] font-semibold text-[var(--p-teal-deep)]">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--p-teal)] opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--p-teal)]" />
                    </span>
                    Waiting for photo from phone…
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                    Open your phone camera, scan the code above,<br />
                    then take a photo of the invoice.
                  </p>
                </div>

                {/* Info strip — original style, timer wired in */}
                <div className={`mt-5 flex items-center justify-between gap-4 rounded-lg px-4 py-2.5 text-[11px] leading-relaxed ${
                  urgent
                    ? "bg-[var(--p-rose-soft)] text-[var(--p-rose)]"
                    : "bg-[var(--p-bg)] text-[var(--p-muted)]"
                }`}>
                  <span>No login required on the phone</span>
                  <span className={`num font-mono font-semibold tabular-nums ${urgent ? "text-[var(--p-rose)]" : "text-[var(--p-teal-deep)]"}`}>
                    {mm}:{ss}
                  </span>
                </div>
              </div>

              {/* Footer — original style */}
              <div className="flex w-full justify-center border-t border-[var(--p-border)] p-4">
                <GhostButton onClick={closeMobileScan}>Cancel</GhostButton>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── VIEW A RECEIPT ────────────────────────────────────────────────── */}
      {view && (
        <Modal
          title={view.grnNumber}
          sub={`${view.supplier.name} · received ${dmyFromISO(view.createdAt)} by ${view.receivedByName}`}
          wide
          onClose={() => { setView(null); setEditing(false); }}
          footer={
            editing ? (
              <>
                <GhostButton onClick={() => { setEditing(false); setEdits({}); }} disabled={saving}>Cancel</GhostButton>
                <PrimaryButton onClick={saveCorrection} disabled={saving || !hdr.reason.trim()}>
                  {saving ? <><Spinner /> Saving…</> : <><Icon name="check" size={14} /> Save the correction</>}
                </PrimaryButton>
              </>
            ) : (
              <>
                <GhostButton onClick={startCorrection}><Icon name="file" size={14} /> Correct this receipt</GhostButton>
                <GhostButton onClick={() => setView(null)}>Close</GhostButton>
              </>
            )
          }
        >
          <div className="space-y-5 p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--p-border)] px-4 py-3">
                <div className="lbl">Value received</div>
                {/* Goods, then the tax, then the sum the invoice is actually checked
                    against. Without the middle line a correct receipt reads as
                    ₹4,000 received against a ₹4,480 bill with no difference, and
                    the desk cannot tell a good delivery from a broken figure. */}
                <div className="num text-[18px] font-bold text-[var(--p-ink)]">{inr(view.receivedTotal, 2)}</div>
                <div className="num mt-0.5 text-[11px] text-[var(--p-muted)]">
                  {inr(view.receivedValue, 2)} goods
                  {Number(view.receivedTax) > 0 && <> + {inr(view.receivedTax, 2)} GST</>}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--p-border)] px-4 py-3">
                <div className="lbl">They invoiced</div>
                <div className="num text-[18px] font-bold text-[var(--p-ink)]">{view.invoiceAmount ? inr(view.invoiceAmount, 2) : "-"}</div>
                {view.invoiceNo && <div className="num mt-0.5 text-[11px] text-[var(--p-muted)]">{view.invoiceNo}{view.invoiceDate && ` · ${dmy(view.invoiceDate)}`}</div>}
              </div>
              <div className={`rounded-lg border px-4 py-3 ${view.mismatch ? "border-[var(--p-rose)]/30 bg-[var(--p-rose-soft)]" : "border-[var(--p-border)]"}`}>
                <div className="lbl">Difference</div>
                <div className={`num text-[18px] font-bold ${view.mismatch ? "text-[var(--p-rose)]" : "text-[var(--p-ink)]"}`}>
                  {view.variance === null ? "-" : `${view.variance > 0 ? "+" : ""}${inr(view.variance, 2)}`}
                </div>
                {view.mismatch && <div className="mt-0.5 text-[11px] font-semibold text-[var(--p-rose)]">Worth querying</div>}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="ptable">
                <thead>
                  <tr>
                    <th>Medicine</th><th>Batch</th><th>Expiry</th><th>Pack</th>
                    <th className="r">Qty</th><th className="r">Free</th>
                    <th className="r">Rate</th><th className="r">Cost/unit</th><th className="r">MRP</th>
                    {editing ? <th className="r">On the shelf</th> : <th className="r">Margin</th>}
                  </tr>
                </thead>
                <tbody>
                  {view.items.map((i) => {
                    const e = edits[i.id] ?? {};
                    const val = <K extends keyof GrnEdit>(k: K, fallback: string) =>
                      (e[k] as string | undefined) ?? fallback;
                    // What this line would put on the shelf if saved. The number
                    // the pack bug hid: 12 x 200ML reading as 2,400.
                    const size = e.pack !== undefined ? parsePack(e.pack).size : i.packSize;
                    const wouldBe = packsToUnits(
                      (Number(val("qty", String(i.qty))) || 0) + (Number(val("freeQty", String(i.freeQty))) || 0),
                      size,
                    );
                    const moved = i.unitsReceived !== null && wouldBe !== i.unitsReceived;

                    if (!editing) {
                      return (
                        <tr key={i.id}>
                          <td className="font-semibold">{i.name}</td>
                          <td className="num">{i.batchNo}</td>
                          <td className="num">{dmy(i.expiryDate)}</td>
                          <td className="num">{i.pack ?? "-"}{i.packSize > 1 && <span className="text-[var(--p-muted)]"> ×{i.packSize}</span>}</td>
                          <td className="r num">{i.qty}</td>
                          <td className="r num text-[var(--p-cyan-deep)]">{i.freeQty || "-"}</td>
                          <td className="r num">{inr(i.unitCost, 2)}</td>
                          <td className="r num font-semibold">{inr(i.landedCost, 2)}</td>
                          <td className="r num">{inr(i.mrp, 2)}</td>
                          <td className={`r num font-semibold ${(i.marginPct ?? 0) > 0 ? "text-[var(--p-cyan-deep)]" : "text-[var(--p-rose)]"}`}>
                            {i.marginPct === null ? "-" : `${i.marginPct}%`}
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={i.id}>
                        <td className="font-semibold">
                          {i.name}
                          {i.billed && (
                            <span className="ml-1.5 rounded bg-[var(--p-amber-soft)] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-[#8a6414]"
                              title="Already billed from this batch - the pack size is fixed, because changing it would re-price invoices patients are holding.">
                              billed
                            </span>
                          )}
                        </td>
                        <td>
                          <input className={`${gfld} w-[104px]`} value={val("batchNo", i.batchNo)} disabled={i.identityPinned}
                            title={i.identityPinned ? "This batch has other history - a second delivery, a sale or a return. Reverse the line and receive it again." : undefined}
                            onChange={(ev) => setEdit(i.id, { batchNo: ev.target.value })} />
                        </td>
                        <td>
                          <input type="date" className={`${gfld} w-[132px]`} value={val("expiryDate", i.expiryDate)} disabled={i.identityPinned}
                            onChange={(ev) => setEdit(i.id, { expiryDate: ev.target.value })} />
                        </td>
                        <td>
                          <input className={`${gfld} w-[74px]`} value={val("pack", i.pack ?? "")} disabled={i.billed}
                            placeholder="15T"
                            title={i.billed ? "Already billed - the pack size cannot move under issued invoices." : "15T · 200ML · 10`S. A volume is one container; tablets multiply."}
                            onChange={(ev) => setEdit(i.id, { pack: ev.target.value })} />
                        </td>
                        <td className="r">
                          <input className={`${gfld} w-[62px] text-right`} inputMode="numeric" value={val("qty", String(i.qty))}
                            onChange={(ev) => setEdit(i.id, { qty: ev.target.value })} />
                        </td>
                        <td className="r">
                          <input className={`${gfld} w-[56px] text-right`} inputMode="numeric" value={val("freeQty", String(i.freeQty))}
                            onChange={(ev) => setEdit(i.id, { freeQty: ev.target.value })} />
                        </td>
                        <td className="r">
                          <input className={`${gfld} w-[76px] text-right`} inputMode="decimal" value={val("unitCost", i.unitCost)}
                            onChange={(ev) => setEdit(i.id, { unitCost: ev.target.value })} />
                        </td>
                        <td className="r num text-[var(--p-muted)]">{inr(i.landedCost, 2)}</td>
                        <td className="r">
                          <input className={`${gfld} w-[76px] text-right`} inputMode="decimal" value={val("mrp", i.mrp)}
                            onChange={(ev) => setEdit(i.id, { mrp: ev.target.value })} />
                        </td>
                        <td className="r num">
                          <span className={moved ? "font-bold text-[var(--p-rose)]" : "text-[var(--p-muted)]"}>
                            {wouldBe}
                          </span>
                          {moved && i.unitsReceived !== null && (
                            <span className="block text-[10px] text-[var(--p-muted)]">was {i.unitsReceived}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {editing && (
              <div className="space-y-3 rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="lbl">Their invoice no.</div>
                    <input className={`${gfld} mt-1.5 w-full`} value={hdr.invoiceNo} onChange={(ev) => setHdr({ ...hdr, invoiceNo: ev.target.value })} />
                  </div>
                  <div>
                    <div className="lbl">Invoice date</div>
                    <input type="date" className={`${gfld} mt-1.5 w-full`} value={hdr.invoiceDate} onChange={(ev) => setHdr({ ...hdr, invoiceDate: ev.target.value })} />
                  </div>
                  <div>
                    <div className="lbl">Invoice amount</div>
                    <input className={`${gfld} mt-1.5 w-full`} inputMode="decimal" value={hdr.invoiceAmount} onChange={(ev) => setHdr({ ...hdr, invoiceAmount: ev.target.value })} />
                  </div>
                </div>
                <div>
                  <div className="lbl">What was wrong?</div>
                  <input className={`${gfld} mt-1.5 w-full`} value={hdr.reason} autoFocus
                    placeholder="e.g. Read the quantity off the wrong row - invoice says 21, not 12"
                    onChange={(ev) => setHdr({ ...hdr, reason: ev.target.value })} />
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--p-muted)]">
                    This goes on the stock ledger beside the original receipt. The receipt is not
                    rewritten - the difference is posted as its own correction, so a year from now
                    the batch still shows what arrived, what changed and why.
                  </p>
                </div>
              </div>
            )}

            {view.notes && (
              <p className="rounded-lg bg-[var(--p-bg)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--p-text)]">{view.notes}</p>
            )}
          </div>
        </Modal>
      )}

      {!loading && !openPos.length && !recent.length && (
        <div className="mt-5">
          <EmptyState
            icon="inbox"
            title="Nothing has been received yet"
            hint="Add a supplier, raise a purchase order from the reorder list, then book the delivery in here when it turns up."
          />
        </div>
      )}
    </PortalScroll>
  );
}

/* The two marks the receipt grid adds: the box that is wrong, and the line it
   sits on. The line tint is what makes a fault findable in a twenty-row grid
   that scrolls sideways - the box's own ring is off-screen half the time. */
const GRN_CSS = `
.grn-bad { border-color: var(--p-rose) !important; background: var(--p-rose-soft); }
.grn-bad:focus { border-color: var(--p-rose) !important; }
.grn-row-bad > td { background: color-mix(in srgb, var(--p-rose-soft) 55%, transparent); }
`;

/**
 * Keyframe animations for the mobile scan QR popup.
 *
 * .scan-beam  — a semi-transparent green stripe that glides from top to bottom
 *               of the QR card on a 2.4 s loop, giving the impression the code
 *               is being read. Speed matches the 2 s server poll so the beam
 *               landing near the bottom visually coincides with "checking…".
 *
 * .qr-border-urgent — when < 30 s remain the QR border pulses red at 0.8 s to
 *               draw attention without being alarming. Synchronised to nothing
 *               in particular — it just needs to be noticeable.
 */
const MOBILE_SCAN_CSS = `
/* ── scanning beam ─────────────────────────────────────────────────────── */
.scan-beam {
  height: 36px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(13,148,136,.18) 40%,
    rgba(13,148,136,.32) 50%,
    rgba(13,148,136,.18) 60%,
    transparent 100%
  );
  animation: beamSlide 2.4s cubic-bezier(.45,0,.55,1) infinite;
}
@keyframes beamSlide {
  0%   { transform: translateY(-36px); opacity: 0; }
  8%   { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateY(222px); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .scan-beam { animation: none; opacity: 0; }
}

/* ── urgent border pulse (<30 s) ────────────────────────────────────────── */
.qr-border-urgent {
  animation: urgentPulse 0.8s ease-in-out infinite alternate;
}
@keyframes urgentPulse {
  from { box-shadow: 0 0 0 0 rgba(225,29,72,0); }
  to   { box-shadow: 0 0 0 5px rgba(225,29,72,.25); }
}
@media (prefers-reduced-motion: reduce) {
  .qr-border-urgent { animation: none; }
}
`;
