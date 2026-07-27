"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import { effectiveUnitCost, invoiceVariance } from "@/lib/pharmacy/procurement-math";
import { api, ApiClientError } from "@/lib/api-client";

interface Supplier { id: string; name: string }
interface Med { id: string; name: string; unit: string; mrp: string | null }
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
  receivedValue: string; variance: number | null; mismatch: boolean; createdAt: string;
  supplierName: string; poNumber: string | null; receivedByName: string; lines: number;
}
interface GrnDetail extends Grn {
  notes: string | null;
  supplier: { id: string; name: string; gstin: string | null; drugLicenseNo: string | null };
  invoiceDate: string | null;
  items: {
    id: string; name: string; unit: string; batchNo: string; expiryDate: string;
    qty: number; freeQty: number; unitCost: string; landedCost: string; mrp: string;
    lineValue: string; marginPct: number | null;
  }[];
}

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
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [view, setView] = useState<GrnDetail | null>(null);

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
    setInvoiceAmount(""); setNotes(""); setRows([newRow()]); setOpen(true);
  }

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Running value of the carton, and whether the invoice agrees with it. */
  const totals = useMemo(() => {
    let value = 0, units = 0, free = 0;
    for (const r of rows) {
      const q = Number(r.qty || 0), c = Number(r.unitCost || 0), f = Number(r.freeQty || 0);
      value += q * c; units += q; free += f;
    }
    value = Math.round(value * 100) / 100;
    const v = invoiceAmount ? invoiceVariance(Number(invoiceAmount), value) : null;
    return { value, units, free, variance: v?.variance ?? null, mismatch: v?.mismatch ?? false };
  }, [rows, invoiceAmount]);

  const valid = rows.filter((r) =>
    (r.medicineId || (r.createNew && r.name.trim().length > 1)) && r.batchNo.trim() && r.expiryDate &&
    Number(r.qty) > 0 &&
    // Whole units only - StockBatch.quantity is an integer, and posting a
    // fraction is a 400 from the API with nothing on screen explaining why.
    Number.isInteger(Number(r.qty)) &&
    Number.isInteger(Number(r.freeQty || 0))
  );
  const canPost = !!supplierId && valid.length > 0 && valid.length === rows.length;

  /**
   * Lines the invoice named but the catalogue doesn't have.
   *
   * After OCR this is routinely most of a delivery - a distributor's bill is
   * full of products nobody has stocked before. Ticking twenty rows one at a
   * time is the slowest part of booking a delivery in, so they get one button.
   */
  const unknownRows = rows.filter((r) => !r.medicineId && !r.createNew && r.name.trim().length > 1);

  /** Why Post is greyed out. A disabled button with no reason is a dead end. */
  const blocker = (() => {
    if (!rows.length) return "Add at least one line.";
    if (!supplierId) return "Choose the supplier this delivery came from.";
    const bad = rows.length - valid.length;
    if (bad > 0) {
      const noMed = rows.filter((r) => !r.medicineId && !(r.createNew && r.name.trim().length > 1)).length;
      const noBatch = rows.filter((r) => r.medicineId && !r.batchNo.trim()).length;
      const noExp = rows.filter((r) => r.medicineId && !r.expiryDate).length;
      const frac = rows.filter((r) => !Number.isInteger(Number(r.qty)) || !Number.isInteger(Number(r.freeQty || 0))).length;
      const parts: string[] = [];
      if (noMed) parts.push(`${noMed} without a medicine picked`);
      if (noBatch) parts.push(`${noBatch} without a batch number`);
      if (noExp) parts.push(`${noExp} without an expiry`);
      if (frac) parts.push(`${frac} with a fractional quantity`);
      return `${bad} line${bad === 1 ? "" : "s"} need attention${parts.length ? ` - ${parts.join(", ")}` : ""}.`;
    }
    return null;
  })();


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
    setOcrBusy(true); setOcrPct(0); setError(null); setOcrNote(null);
    try {
      const { recognize } = await import("tesseract.js");
      const { data } = await recognize(file, "eng", {
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
      if (inv.netAmount) setInvoiceAmount(inv.netAmount);

      // Lines, matched to the catalogue by name where possible.
      const byName = new Map<string, Med>();
      for (const m2 of meds) byName.set(m2.name.trim().toLowerCase(), m2);
      const matchMed = (name: string) => {
        const key = name.trim().toLowerCase();
        if (byName.has(key)) return byName.get(key)!;
        // Fall back to the longest catalogue name contained in the OCR'd text.
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
          // Kept verbatim, decimal point and all. Stripping non-digits turned
          // the invoice's "2.5" into "25" - twenty-five bottles instead of two
          // and a half, silently, with nothing on screen to notice. A
          // fractional quantity is flagged below and the pharmacist resolves it.
          qty: r.qty,
          freeQty: r.free,
          unitCost: r.rate,
          mrp: r.mrp,
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
                    className="btn-primary ml-auto rounded-md px-3 py-1.5 text-[12px] font-semibold text-white">
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
                    {g.supplierName} · {g.lines} line{g.lines === 1 ? "" : "s"} · {dmyFromISO(g.createdAt)} · {g.receivedByName}
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
                <span className="max-w-[320px] text-right text-[11.5px] leading-snug text-[#8a6414]">{blocker}</span>
              )}
              <GhostButton onClick={() => setOpen(false)} disabled={busy}>Cancel</GhostButton>
              <PrimaryButton onClick={post} disabled={busy || !canPost}>
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
              <Field label="Supplier">
                <select className={fld} value={supplierId} disabled={!!poId}
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
                    const fractional = !Number.isInteger(q) || !Number.isInteger(f);
                    // Packs in, units on the shelf - the conversion the whole
                    // pharmacy turns on. See lib/pharmacy/pack.
                    const packSpec = parsePack(r.pack);
                    const shelfUnits = packsToUnits(q + f, packSpec.size);
                    return (
                      <tr key={r.key}>
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
                                <input className={fld} value={r.name} autoFocus
                                  placeholder="New product name"
                                  onChange={(e) => setRow(r.key, { name: e.target.value, medicineId: "" })} />
                              ) : (
                                <select className={fld} value={r.medicineId}
                                  onChange={(e) => {
                                    const m = meds.find((x) => x.id === e.target.value);
                                    setRow(r.key, { medicineId: e.target.value, name: m?.name ?? "", unit: m?.unit ?? "unit", mrp: r.mrp || (m?.mrp ?? "") });
                                  }}>
                                  <option value="">Select…</option>
                                  {meds.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                              )}
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
                          <input className={`${fld} num w-[64px] py-1.5 text-right ${fractional ? "border-[var(--p-amber)]" : ""}`} value={r.qty} inputMode="decimal"
                            onChange={(e) => setRow(r.key, { qty: e.target.value.replace(/[^\d.]/g, "") })} />
                          {/* Liquids are invoiced in fractions of a pack ("2.5"),
                              but the shelf counts whole units. Surfaced rather
                              than rounded - only the pharmacist knows whether
                              that is 2 bottles or 3. */}
                          {fractional && <div className="mt-1 text-[10px] font-semibold text-[#8a6414]">whole units only</div>}
                        </td>
                        <td className="r"><input className={`${fld} num w-[56px] py-1.5 text-right`} value={r.freeQty} inputMode="decimal"
                          onChange={(e) => setRow(r.key, { freeQty: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" /></td>
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
                          <input className={`${fld} num py-1.5`} value={r.batchNo}
                            onChange={(e) => setRow(r.key, { batchNo: e.target.value.toUpperCase() })} placeholder="On the strip" />
                        </td>
                        <td className="r"><input className={`${fld} num w-[78px] py-1.5 text-right`} value={r.mrp} inputMode="decimal"
                          onChange={(e) => setRow(r.key, { mrp: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                        <td>
                          <input type="date" className={`${fld} py-1.5 ${dead ? "border-[var(--p-rose)]" : ""}`} value={r.expiryDate}
                            onChange={(e) => setRow(r.key, { expiryDate: e.target.value })} />
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

      {/* ── VIEW A RECEIPT ────────────────────────────────────────────────── */}
      {view && (
        <Modal
          title={view.grnNumber}
          sub={`${view.supplier.name} · received ${dmyFromISO(view.createdAt)} by ${view.receivedByName}`}
          wide
          onClose={() => setView(null)}
          footer={<GhostButton onClick={() => setView(null)}>Close</GhostButton>}
        >
          <div className="space-y-5 p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--p-border)] px-4 py-3">
                <div className="lbl">Value received</div>
                <div className="num text-[18px] font-bold text-[var(--p-ink)]">{inr(view.receivedValue, 2)}</div>
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
                    <th>Medicine</th><th>Batch</th><th>Expiry</th>
                    <th className="r">Qty</th><th className="r">Free</th>
                    <th className="r">Rate</th><th className="r">Cost/unit</th><th className="r">MRP</th><th className="r">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {view.items.map((i) => (
                    <tr key={i.id}>
                      <td className="font-semibold">{i.name}</td>
                      <td className="num">{i.batchNo}</td>
                      <td className="num">{dmy(i.expiryDate)}</td>
                      <td className="r num">{i.qty}</td>
                      <td className="r num text-[var(--p-cyan-deep)]">{i.freeQty || "-"}</td>
                      <td className="r num">{inr(i.unitCost, 2)}</td>
                      <td className="r num font-semibold">{inr(i.landedCost, 2)}</td>
                      <td className="r num">{inr(i.mrp, 2)}</td>
                      <td className={`r num font-semibold ${(i.marginPct ?? 0) > 0 ? "text-[var(--p-cyan-deep)]" : "text-[var(--p-rose)]"}`}>
                        {i.marginPct === null ? "-" : `${i.marginPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
