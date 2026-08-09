import { collectionByMode, type ModeTotal } from "./reports.service";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import { parsePack, packsToUnits, perUnitPrice, describeStock } from "@/lib/pharmacy/pack";
import { resolveMaster, effectiveGstRate } from "@/lib/pharmacy/masters";
import { createInvoice, counterDues, type BillLineInput, type CounterDue, type CounterDues, type CounterIpdDue } from "./billing.service";
import { getSettings } from "./admin.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// The clinical reality this models: the doctor writes the prescription BY HAND.
// Reception scans it and dispatches it here. The pharmacist reads the scan on
// screen, picks the medicines, and the system does FEFO batch selection,
// stock decrement, traceability and GST billing.
// ---------------------------------------------------------------------------

export interface MedicineDTO {
  id: string; name: string; genericName: string | null; manufacturer: string | null;
  hsnCode: string | null; gstRatePct: string; unit: string; rackLocation: string | null;
  reorderThreshold: number; active: boolean;
  // ── MASTER DATA ──────────────────────────────────────────────────────────
  // The four descriptor fields above are RESOLVED: the master's name when one
  // is linked, the legacy free-text column when it is not. See lib/pharmacy/
  // masters. Callers that just want to show a manufacturer keep reading
  // `manufacturer` and get the right answer either way.
  //
  // The ids and the `…FromMaster` flags are for the screens that have to act on
  // the difference - the medicine form, which must preselect the right option,
  // and the stock list, which marks rows still running on free text so the
  // changeover is finishable rather than perpetual.
  categoryId: string | null; category: string | null;
  genericId: string | null; manufacturerId: string | null;
  dosageFormId: string | null; dosageForm: string | null;
  unitId: string | null; hsnId: string | null; taxRateId: string | null;
  scheduleId: string | null;
  /// Regulatory classification, or null. NEVER inferred - see DrugSchedule.
  schedule: string | null;
  genericFromMaster: boolean;
  manufacturerFromMaster: boolean;
  hsnFromMaster: boolean;
  unitFromMaster: boolean;
  /// True when the product's own GST rate differs from its HSN's default. Shown,
  /// never auto-corrected: repricing on a master edit is how a wrong bill
  /// happens. See effectiveGstRate.
  gstDiffersFromHsn: boolean;
  hsnDefaultGstRatePct: string | null;
  /// Any descriptor still on free text. The "left to link" signal.
  needsMasterLink: boolean;
  courseCritical: boolean;   // antibiotic / TB drug - a partial course is harmful
  inStock: number;              // sum of non-expired batch qty
  expiredQty: number;           // expired stock STILL PHYSICALLY ON THE SHELF - must be pulled
  /** MRP of the batch we'd dispense next (FEFO), PER PACK as printed. */
  mrp: string | null;
  /** THE PRICE A PATIENT PAYS FOR ONE UNIT. mrp / packSize.
   *  Counters must bill with this - charging the pack price per tablet was a
   *  15x overcharge on a strip of 15. */
  unitMrp: string | null;
  /** Dispensing units in one pack of that batch, and its printed label. */
  packSize: number;
  packLabel: string | null;
  /** The product master's own standard pack - "10T". What a delivery is checked
   *  against, and the fallback when an invoice line does not state one. */
  defaultPack: string | null;
  defaultPackSize: number;
  /** The shelf's pack label disagrees with the product's standard pack. Usually
   *  an OCR misread ("15T" scanned as "157"), occasionally a genuine repack. */
  packMismatch: boolean;
  nearestExpiry: string | null; // that batch's expiry
  lowStock: boolean;
  // ── Procurement ──────────────────────────────────────────────────────────
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  reorderQty: number | null;
  /** Units on a sent-but-undelivered PO. "It's low, but it's already coming." */
  onOrder: number;
}

/** Catalog with live stock. Stock excludes expired batches - they can't be sold. */
export async function listMedicines(query?: string): Promise<MedicineDTO[]> {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const meds = await prisma.medicine.findMany({
    where: {
      active: true,
      ...(query
        ? { OR: [
            { name: { contains: query, mode: "insensitive" } },
            { genericName: { contains: query, mode: "insensitive" } },
            // SEARCH REACHES THROUGH THE MASTER TOO. A pharmacist typing
            // "paracetamol" against a product whose salt lives on a Generic row
            // rather than in the legacy column would otherwise get nothing -
            // which reads as "we don't stock it" at exactly the wrong moment.
            { generic: { name: { contains: query, mode: "insensitive" } } },
            { manufacturerRef: { name: { contains: query, mode: "insensitive" } } },
          ] }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true, name: true, genericName: true, manufacturer: true, hsnCode: true,
      defaultPack: true, defaultPackSize: true,
      gstRatePct: true, unit: true, rackLocation: true, reorderThreshold: true, active: true,
      courseCritical: true, reorderQty: true,
      categoryId: true, genericId: true, manufacturerId: true, dosageFormId: true,
      unitId: true, hsnId: true, taxRateId: true, scheduleId: true,
      category: { select: { name: true } },
      generic: { select: { name: true } },
      manufacturerRef: { select: { name: true } },
      dosageForm: { select: { name: true } },
      unitRef: { select: { name: true } },
      hsn: { select: { code: true, defaultTaxRate: { select: { ratePct: true } } } },
      schedule: { select: { code: true } },
      preferredSupplier: { select: { id: true, name: true } },
      batches: {
        // ALL batches with stock - expired ones are split out below so the
        // pharmacist is told what to physically pull off the shelf.
        where: { quantity: { gt: 0 } },
        orderBy: { expiryDate: "asc" }, // FEFO
        select: { quantity: true, mrp: true, expiryDate: true, packSize: true, pack: true },
      },
      // Stock the distributor already owes us. Without this the shelf reads
      // "low" and the pharmacist orders a second time.
      poItems: {
        where: { purchaseOrder: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] } } },
        select: { qtyOrdered: true, qtyReceived: true },
      },
    },
  });

  type Row = {
    id: string; name: string; genericName: string | null; manufacturer: string | null;
    hsnCode: string | null; gstRatePct: { toString(): string }; unit: string;
    rackLocation: string | null; reorderThreshold: number; active: boolean; courseCritical: boolean;
    reorderQty: number | null;
    categoryId: string | null; genericId: string | null; manufacturerId: string | null;
    dosageFormId: string | null; unitId: string | null; hsnId: string | null;
    taxRateId: string | null; scheduleId: string | null;
    category: { name: string } | null;
    generic: { name: string } | null;
    manufacturerRef: { name: string } | null;
    dosageForm: { name: string } | null;
    unitRef: { name: string } | null;
    hsn: { code: string; defaultTaxRate: { ratePct: { toString(): string } } | null } | null;
    schedule: { code: string } | null;
    preferredSupplier: { id: string; name: string } | null;
    defaultPack: string | null;
    defaultPackSize: number;
    batches: { quantity: number; mrp: { toString(): string }; expiryDate: Date; packSize: number; pack: string | null }[];
    poItems: { qtyOrdered: number; qtyReceived: number }[];
  };

  return (meds as Row[]).map((m) => {
    const live = m.batches.filter((b) => b.expiryDate >= today);
    const expired = m.batches.filter((b) => b.expiryDate < today);
    const inStock = live.reduce((s, b) => s + b.quantity, 0);
    const first = live[0]; // FEFO: the batch we'd dispense next

    // ── DUAL READ ── master first, legacy column second. One rule, one place.
    const generic = resolveMaster(m.generic?.name, m.genericName);
    const maker = resolveMaster(m.manufacturerRef?.name, m.manufacturer);
    const hsn = resolveMaster(m.hsn?.code, m.hsnCode);
    const unit = resolveMaster(m.unitRef?.name, m.unit);

    const gstRate = Number(m.gstRatePct.toString());
    const hsnDefault = m.hsn?.defaultTaxRate ? Number(m.hsn.defaultTaxRate.ratePct.toString()) : null;
    const gst = effectiveGstRate({ medicineRatePct: gstRate, hsnDefaultRatePct: hsnDefault });

    return {
      id: m.id, name: m.name,
      genericName: generic.value, manufacturer: maker.value,
      hsnCode: hsn.value, gstRatePct: m.gstRatePct.toString(),
      // `unit` must never come back null - it is interpolated straight into
      // dispense line descriptions and a blank there reads as a broken bill.
      unit: unit.value ?? "unit",
      rackLocation: m.rackLocation, reorderThreshold: m.reorderThreshold, active: m.active,
      courseCritical: m.courseCritical,
      categoryId: m.categoryId, category: m.category?.name ?? null,
      genericId: m.genericId, manufacturerId: m.manufacturerId,
      dosageFormId: m.dosageFormId, dosageForm: m.dosageForm?.name ?? null,
      unitId: m.unitId, hsnId: m.hsnId, taxRateId: m.taxRateId,
      scheduleId: m.scheduleId, schedule: m.schedule?.code ?? null,
      genericFromMaster: generic.source === "master",
      manufacturerFromMaster: maker.source === "master",
      hsnFromMaster: hsn.source === "master",
      unitFromMaster: unit.source === "master",
      gstDiffersFromHsn: gst.disagreesWithHsn,
      hsnDefaultGstRatePct: hsnDefault === null ? null : hsnDefault.toFixed(2),
      // Only counts descriptors that HAVE a value still living in free text.
      // A medicine with no manufacturer at all is incomplete, not unlinked, and
      // flagging it here would make the list cry wolf on every blank field.
      needsMasterLink:
        generic.source === "legacy" || maker.source === "legacy" ||
        hsn.source === "legacy" || unit.source === "legacy",
      inStock,
      expiredQty: expired.reduce((s, b) => s + b.quantity, 0),
      mrp: first ? first.mrp.toString() : null,
      unitMrp: first ? perUnitPrice(Number(first.mrp.toString()), first.packSize).toFixed(2) : null,
      packSize: first?.packSize ?? m.defaultPackSize ?? 1,
      packLabel: first?.pack ?? null,
      defaultPack: m.defaultPack,
      defaultPackSize: m.defaultPackSize,
      // A pack size on the shelf that is not the product's own, flagged rather
      // than corrected. "15T" scanned as "157" books 1570 tablets at 12 paise;
      // only a person can say whether that is a misread or a genuine repack.
      // Compared on SIZE, not on the label text - "15s" and "15T" are the same
      // fifteen and disagreeing about the suffix would cry wolf constantly.
      packMismatch:
        !!first && m.defaultPackSize > 1 && first.packSize !== m.defaultPackSize,
      nearestExpiry: first ? first.expiryDate.toISOString().slice(0, 10) : null,
      lowStock: inStock <= m.reorderThreshold,
      preferredSupplierId: m.preferredSupplier?.id ?? null,
      preferredSupplierName: m.preferredSupplier?.name ?? null,
      reorderQty: m.reorderQty,
      onOrder: m.poItems.reduce((s, p) => s + Math.max(0, p.qtyOrdered - p.qtyReceived), 0),
    };
  });
}

/**
 * The supplier must exist and still be trading. `active:false` covers both a
 * distributor the hospital has stopped using and the synthetic "Opening stock"
 * record created when supplier became mandatory - neither may take new stock.
 */
async function assertReceivableSupplier(supplierId: string): Promise<{ id: string; name: string }> {
  const s = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, active: true },
  });
  if (!s) throw new ApiError(404, "That supplier doesn't exist");
  if (!s.active) throw new ApiError(409, `${s.name} is not an active supplier - stock can't be booked against it.`);
  return { id: s.id, name: s.name };
}

/**
 * A batch number is printed on the manufacturer's strip, so the same number on
 * the same medicine carries the same expiry whoever delivered it. Two different
 * expiries under one number is a typing error, and letting it through puts two
 * real expiry dates into FEFO behind a single label.
 */
async function assertConsistentExpiry(
  medicineId: string, batchNo: string, expiry: Date, supplierId: string, medName: string
): Promise<void> {
  const elsewhere = await prisma.stockBatch.findFirst({
    where: { medicineId, batchNo, supplierId: { not: supplierId } },
    select: { expiryDate: true, supplier: { select: { name: true } } },
  });
  if (!elsewhere) return;
  const a = elsewhere.expiryDate.toISOString().slice(0, 10);
  const b = expiry.toISOString().slice(0, 10);
  if (a !== b) {
    throw new ApiError(
      400,
      `Batch ${batchNo} of ${medName} is already on the shelf from ${elsewhere.supplier.name} expiring ${a}, but this one says ${b}. Same batch number, two expiry dates - check the strip.`
    );
  }
}

/** Receive stock (a purchase). Creates/tops-up a batch and writes the ledger. */
export async function addBatch(
  actor: AuthUser,
  input: {
    medicineId: string; supplierId: string; batchNo: string; expiryDate: string;
    /** In PACKS, as bought. Converted to dispensing units below. */
    quantity: number;
    /** Printed pack label ("15T"). Sets how many units a pack holds. */
    pack?: string;
    /** Explicit override, for when the label can't be read. */
    packSize?: number;
    mrp: number; purchasePrice?: number; supplierRef?: string;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  if (input.quantity <= 0) throw new ApiError(400, "Quantity must be at least 1");

  const expiry = new Date(input.expiryDate);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (expiry < today) throw new ApiError(400, "That batch has already expired");

  const med = await prisma.medicine.findUnique({ where: { id: input.medicineId }, select: { id: true, name: true } });
  if (!med) throw new ApiError(404, "Medicine not found");

  const supplier = await assertReceivableSupplier(input.supplierId);
  await assertConsistentExpiry(input.medicineId, input.batchNo.trim(), expiry, input.supplierId, med.name);

  // Packs in, units on the shelf. See lib/pharmacy/pack.
  const packSize = Math.max(1, Math.floor(input.packSize ?? parsePack(input.pack).size));
  const units = packsToUnits(input.quantity, packSize);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Batch identity is medicine + batch number + SUPPLIER. The same batch from
    // this same distributor tops up; the same batch from a different one is a
    // separate consignment and gets its own row.
    const batch = await tx.stockBatch.upsert({
      where: {
        medicineId_batchNo_supplierId: {
          medicineId: input.medicineId, batchNo: input.batchNo.trim(), supplierId: input.supplierId,
        },
      },
      update: {
        quantity: { increment: units },
        packSize,
        mrp: input.mrp.toFixed(2),
        ...(input.pack?.trim() ? { pack: input.pack.trim() } : {}),
        ...(input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice.toFixed(2) } : {}),
      },
      create: {
        medicineId: input.medicineId,
        supplierId: input.supplierId,
        batchNo: input.batchNo.trim(),
        expiryDate: expiry,
        quantity: units,
        packSize,
        pack: input.pack?.trim() || null,
        mrp: input.mrp.toFixed(2),
        purchasePrice: input.purchasePrice !== undefined ? input.purchasePrice.toFixed(2) : null,
      },
      select: { id: true },
    });

    await tx.stockTransaction.create({
      data: {
        batchId: batch.id, type: "PURCHASE", qty: units,
        refId: input.supplierRef?.trim() || null,
        reason: "Stock received", performedById: actor.id,
      },
    });

    await logAudit(actor, { action: "STOCK_RECEIVED", targetTable: "StockBatch", targetId: batch.id, meta: { medicine: med.name, qty: input.quantity, batchNo: input.batchNo }, ...ctx }, tx);
  });
}

export interface BulkBatchRow {
  medicineId?: string;
  medicine?: string;
  /// create the medicine (by name) if it isn't already in the catalog
  createNew?: boolean;
  hsn?: string;
  gstRatePct?: number;
  batchNo: string;
  expiryDate: string;
  /// In PACKS, as invoiced. Multiplied by packSize to reach the shelf.
  quantity: number;
  /// Printed pack label ("15T"); packSize overrides it when known explicitly.
  pack?: string;
  packSize?: number;
  /// FREE GOODS, IN PACKS - the "10+1 free" schemes that are standard in Indian
  /// pharma distribution. Real stock that costs nothing, so it reaches the shelf
  /// like any other pack but is held separately to keep landed cost honest.
  freeQty?: number;
  /// The invoice's OMrp column - the manufacturer's short code (ARIS, AVEN).
  oMrp?: string;
  mrp: number;
  purchasePrice?: number;
  supplierRef?: string;
}
export interface BulkBatchResult { row: number; medicine: string; batchNo: string; ok: boolean; error?: string; created?: boolean; }

/**
 * Receive many batches at once - from a parsed spreadsheet or a keyed-in
 * scanned invoice. Each row is committed on its own, so one bad line (a
 * medicine that isn't in the catalog, an expired date) fails alone and the
 * rest still land. Returns a per-row report so the counter can see exactly
 * what went in and what didn't.
 */
export async function bulkAddBatches(
  actor: AuthUser,
  input: { supplierId: string; invoiceNo?: string; invoiceDate?: string; rows: BulkBatchRow[] },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ created: number; createdMedicines: number; supplierName: string; results: BulkBatchResult[] }> {
  // One invoice, one supplier. Checked once up front rather than per row, so a
  // bad supplier fails the whole import instead of half-importing it.
  const supplier = await assertReceivableSupplier(input.supplierId);
  const rows = input.rows;
  const invoiceNo = input.invoiceNo?.trim() || null;

  const meds = await prisma.medicine.findMany({
    where: { active: true },
    select: { id: true, name: true, genericName: true, defaultPack: true, defaultPackSize: true },
  });
  const byName = new Map<string, { id: string; name: string }>();
  for (const m of meds) {
    byName.set(m.name.trim().toLowerCase(), { id: m.id, name: m.name });
    if (m.genericName) byName.set(m.genericName.trim().toLowerCase(), { id: m.id, name: m.name });
  }
  const byId = new Map(meds.map((m) => [m.id, m.name]));
  /** The product master's own idea of how this thing is packed - the fallback
   *  when an invoice line does not say, and the cross-check when it does. */
  const medDefaults = new Map(
    meds.map((m) => [m.id, { defaultPack: m.defaultPack, defaultPackSize: m.defaultPackSize }])
  );
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const results: BulkBatchResult[] = [];
  let created = 0;
  let createdMedicines = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const label = (r.medicine || r.medicineId || "").toString();
    try {
      let medId = r.medicineId;
      let medName = label;
      let medNew = false;
      if (medId) {
        const nm = byId.get(medId);
        if (!nm) throw new Error("Medicine not found in catalog");
        medName = nm;
      } else {
        const nameKey = (r.medicine || "").trim().toLowerCase();
        const found = byName.get(nameKey);
        if (found) {
          medId = found.id; medName = found.name;
        } else if (r.createNew && (r.medicine || "").trim().length > 1) {
          // New product off the invoice - create it, then stock it. name is unique.
          //
          // THE PACK IT ARRIVED IN BECOMES THE PRODUCT'S DEFAULT. This is the
          // only moment the information is to hand: the invoice line says "15T"
          // and that is very likely how this product is always sold. Recorded
          // now, the next delivery whose pack column is blank or misread has
          // something to fall back on and be checked against.
          //
          // The dispensing unit comes from the same label - "15T" is tablets,
          // "200ML" is ml. Defaulting every new product to the literal string
          // "unit" is why this catalogue has rows reading "3 units" of a syrup.
          const nm = r.medicine!.trim();
          const spec = parsePack(r.pack);
          const med = await prisma.medicine.upsert({
            where: { name: nm },
            update: {},
            create: {
              name: nm,
              hsnCode: r.hsn?.trim() || null,
              gstRatePct: (r.gstRatePct ?? 5).toFixed(2),
              unit: spec.known ? spec.unit : "unit",
              defaultPack: r.pack?.trim() || null,
              defaultPackSize: spec.known ? spec.size : 1,
            },
            select: { id: true },
          });
          medId = med.id; medName = nm;
          if (!byId.has(med.id)) {
            createdMedicines++; medNew = true;
            byId.set(med.id, nm); byName.set(nameKey, { id: med.id, name: nm });
            medDefaults.set(med.id, {
              defaultPack: r.pack?.trim() || null,
              defaultPackSize: spec.known ? spec.size : 1,
            });
            await logAudit(actor, { action: "MEDICINE_CREATED", targetTable: "Medicine", targetId: med.id, meta: { name: nm, source: "invoice-import" }, ...ctx });
          }
        } else {
          throw new Error(`"${r.medicine}" is not in the catalog`);
        }
      }

      // Rows are counted in PACKS, like the invoice they were keyed from.
      const packs = Math.floor(r.quantity);
      if (!(packs > 0)) throw new Error("Quantity must be at least 1");
      const freePacks = Math.max(0, Math.floor(r.freeQty ?? 0));

      /**
       * THE PACK SIZE, IN ORDER OF WHO ACTUALLY KNOWS.
       *
       * An explicit packSize wins - the screen worked it out and showed the
       * pharmacist the resulting shelf count. Then the label on this invoice
       * line. Then the PRODUCT'S OWN default pack, which is what rescues a row
       * whose pack column the invoice left blank or the OCR could not read.
       *
       * Falling back to 1 without consulting the master is how a strip of ten
       * becomes one tablet on the shelf, priced at the whole strip's MRP.
       */
      const master = medDefaults.get(medId!);
      const fromRow = r.packSize ?? (r.pack ? parsePack(r.pack).size : undefined);
      const packSize = Math.max(
        1,
        Math.floor(fromRow && fromRow > 1 ? fromRow : (master?.defaultPackSize ?? 1))
      );
      // Free goods reach the shelf too - they are stock, they just cost nothing.
      const qty = packsToUnits(packs + freePacks, packSize);
      const freeUnits = packsToUnits(freePacks, packSize);
      const expiry = new Date(r.expiryDate);
      if (Number.isNaN(expiry.getTime())) throw new Error("Invalid expiry date");
      if (expiry < today) throw new Error("Batch has already expired");

      await assertConsistentExpiry(medId!, r.batchNo.trim(), expiry, input.supplierId, medName);

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Same batch from THIS supplier tops up; the same batch number from a
        // different distributor is a separate consignment with its own row.
        const batch = await tx.stockBatch.upsert({
          where: {
            medicineId_batchNo_supplierId: { medicineId: medId!, batchNo: r.batchNo.trim(), supplierId: input.supplierId },
          },
          update: {
            quantity: { increment: qty },
            packSize,
            mrp: r.mrp.toFixed(2),
            ...(r.pack?.trim() ? { pack: r.pack.trim() } : {}),
            // Free goods accumulate with the stock they arrived alongside, so a
            // second consignment on the same batch does not erase the first
            // delivery's scheme units and overstate the landed cost.
            ...(freeUnits > 0 ? { freeQty: { increment: freeUnits } } : {}),
            ...(r.oMrp?.trim() ? { oMrp: r.oMrp.trim() } : {}),
            ...(r.purchasePrice !== undefined ? { purchasePrice: r.purchasePrice.toFixed(2) } : {}),
          },
          create: {
            medicineId: medId!,
            supplierId: input.supplierId,
            batchNo: r.batchNo.trim(),
            expiryDate: expiry,
            quantity: qty,
            packSize,
            // The label the invoice printed, or the product's own if it was
            // silent. Never a number dressed up as a label.
            pack: r.pack?.trim() || master?.defaultPack || null,
            freeQty: freeUnits,
            oMrp: r.oMrp?.trim() || null,
            mrp: r.mrp.toFixed(2),
            purchasePrice: r.purchasePrice !== undefined ? r.purchasePrice.toFixed(2) : null,
          },
          select: { id: true },
        });
        await tx.stockTransaction.create({
          data: {
            batchId: batch.id, type: "PURCHASE", qty,
            // The invoice is the document this stock arrived on - it belongs on
            // the ledger row, not just in someone's memory of the import.
            refId: invoiceNo ?? r.supplierRef?.trim() ?? null,
            reason: invoiceNo
              ? `Received from ${supplier.name} · invoice ${invoiceNo}`
              : `Received from ${supplier.name}`,
            performedById: actor.id,
          },
        });
        await logAudit(actor, { action: "STOCK_RECEIVED", targetTable: "StockBatch", targetId: batch.id, meta: { medicine: medName, qty, batchNo: r.batchNo, supplier: supplier.name, invoiceNo, source: "invoice-import" }, ...ctx }, tx);
      });

      created++;
      results.push({ row: i + 1, medicine: medName, batchNo: r.batchNo, ok: true, created: medNew });
    } catch (e) {
      results.push({ row: i + 1, medicine: label, batchNo: r.batchNo || "", ok: false, error: e instanceof Error ? e.message : "Failed" });
    }
  }

  return { created, createdMedicines, supplierName: supplier.name, results };
}

/** Manual stock correction (damage, count mismatch, expiry write-off). */
export async function adjustStock(
  actor: AuthUser,
  input: { batchId: string; delta: number; reason: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  if (!input.reason?.trim()) throw new ApiError(400, "A reason is required for a stock adjustment");
  if (input.delta === 0) throw new ApiError(400, "Adjustment can't be zero");

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const batch = await tx.stockBatch.findUnique({ where: { id: input.batchId }, select: { id: true, quantity: true } });
    if (!batch) throw new ApiError(404, "Batch not found");
    if (batch.quantity + input.delta < 0) throw new ApiError(400, "That would take stock below zero");

    await tx.stockBatch.update({ where: { id: input.batchId }, data: { quantity: { increment: input.delta } } });
    await tx.stockTransaction.create({
      data: { batchId: input.batchId, type: "ADJUSTMENT", qty: input.delta, reason: input.reason.trim(), performedById: actor.id },
    });
    await logAudit(actor, { action: "STOCK_ADJUSTED", targetTable: "StockBatch", targetId: input.batchId, meta: { delta: input.delta, reason: input.reason }, ...ctx }, tx);
  });
}

/**
 * FEFO - First Expiry, First Out. The correct rule for pharmacy: always dispense
 * the batch that expires soonest, so stock doesn't die on the shelf. A single
 * line may span several batches if one doesn't cover the quantity.
 */
async function pickBatchesFEFO(
  tx: Prisma.TransactionClient,
  medicineId: string,
  qtyNeeded: number
): Promise<{ batchId: string; batchNo: string; qty: number; mrp: number; packSize: number; packMrp: number }[]> {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const batches = await tx.stockBatch.findMany({
    where: { medicineId, quantity: { gt: 0 }, expiryDate: { gte: today } },
    orderBy: { expiryDate: "asc" }, // soonest expiry first
    select: { id: true, batchNo: true, quantity: true, mrp: true, packSize: true },
  });

  const picks: { batchId: string; batchNo: string; qty: number; mrp: number; packSize: number; packMrp: number }[] = [];
  let remaining = qtyNeeded;

  type B = { id: string; batchNo: string; quantity: number; mrp: { toString(): string }; packSize: number };
  for (const b of batches as B[]) {
    if (remaining <= 0) break;
    // quantity is in dispensing units, so this take is in units too.
    const take = Math.min(remaining, b.quantity);
    const packMrp = Number(b.mrp.toString());
    picks.push({
      batchId: b.id,
      batchNo: b.batchNo,
      qty: take,
      // THE PRICE A PATIENT ACTUALLY PAYS. mrp is printed PER PACK; billing it
      // per tablet charged Rs 18.59 for one paracetamol out of a Rs 18.59 strip.
      mrp: perUnitPrice(packMrp, b.packSize),
      packSize: b.packSize,
      packMrp,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    const med = await tx.medicine.findUnique({ where: { id: medicineId }, select: { name: true } });
    const have = qtyNeeded - remaining;
    throw new ApiError(400, `Not enough stock for ${med?.name ?? "that medicine"} - need ${qtyNeeded}, only ${have} available`);
  }
  return picks;
}

/**
 * Dispense against a scanned prescription (or as a walk-in OTC sale).
 * Decrements stock FEFO, writes a ledger row per batch, and raises a TAXABLE
 * GST invoice - medicines are 5%/12%, unlike diagnostics which are exempt.
 */
export async function dispense(
  actor: AuthUser,
  input: {
    patientId: string;
    prescriptionUploadId?: string;
    items: { medicineId: string; qty: number }[];
    discountAmount?: number;
    /** Set when the patient is taking less than was prescribed - recorded on the bill. */
    shortSupplyReason?: string;
    payment?: { mode: "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER"; amount: number; reference?: string };
    payments?: { mode: "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER"; amount: number; reference?: string }[];
  },
  ctx: { ipAddress?: string; userAgent?: string }
) {
  if (!input.items.length) throw new ApiError(400, "Add at least one medicine");

  // Resolve batches + build bill lines inside a transaction so stock can't race.
  const lines = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const built: BillLineInput[] = [];

    for (const item of input.items) {
      if (item.qty <= 0) throw new ApiError(400, "Quantity must be at least 1");

      const med = await tx.medicine.findUnique({
        where: { id: item.medicineId },
        select: {
          id: true, name: true, unit: true, hsnCode: true, gstRatePct: true,
          // DUAL READ ON A TAX DOCUMENT. Once a product's HSN lives on the
          // master, the legacy column may legitimately be blank - and an
          // invoice line that lost its HSN because of a data-entry improvement
          // is a GST return that no longer reconciles.
          hsn: { select: { code: true } },
          unitRef: { select: { name: true } },
        },
      });
      if (!med) throw new ApiError(404, "Medicine not found");
      const medHsn = resolveMaster(med.hsn?.code, med.hsnCode).value;
      // Never blank: this is interpolated into the printed line description.
      const medUnit = resolveMaster(med.unitRef?.name, med.unit).value ?? "unit";

      const picks = await pickBatchesFEFO(tx, item.medicineId, item.qty);

      for (const p of picks) {
        // decrement stock
        await tx.stockBatch.update({ where: { id: p.batchId }, data: { quantity: { decrement: p.qty } } });
        // ledger row - full traceability of which batch went to which patient
        await tx.stockTransaction.create({
          data: { batchId: p.batchId, type: "DISPENSE", qty: -p.qty, reason: "Dispensed", performedById: actor.id },
        });
        // one bill line per batch, so the invoice shows the exact batch
        built.push({
          description: p.packSize > 1
            ? `${med.name} · ${p.qty} ${medUnit}${p.qty === 1 ? "" : "s"} @ ₹${p.mrp} (pack of ${p.packSize} · MRP ₹${p.packMrp}) · Batch ${p.batchNo}`
            : `${med.name} (${medUnit}) · Batch ${p.batchNo}`,
          qty: p.qty,
          unitPrice: p.mrp, // Indian pharmacies bill at printed MRP
          // The product's own rate stays the authority - the HSN's default
          // seeds it, never overrides it. See effectiveGstRate.
          gstRatePct: Number(med.gstRatePct.toString()),
          hsnSac: medHsn ?? undefined,
          batchId: p.batchId,
        });
      }
    }
    return built;
  });

  // ── Is this patient lying in a bed upstairs? ────────────────────────────────
  // An admitted patient does NOT pay at the medicine counter. The medicine goes
  // on their room tab and settles in the discharge bill. Billing them here would
  // make them pay twice - once at the window, once at discharge.
  const liveAdmission = await prisma.admission.findFirst({
    where: { patientId: input.patientId, status: "ADMITTED" },
    select: { id: true, ipNumber: true },
  });

  // AN INPATIENT'S MEDICINES GET THEIR OWN PHARMACY BILL.
  //
  // They used to dissolve into anonymous AdmissionCharge rows on the room tab.
  // The medicine was billed - eventually, at discharge - but the pharmacy had no
  // bill of its own, so it could not answer "what does bed 12 owe us", the
  // family had nothing itemised to check, and a ward dispense left no pharmacy
  // document behind at all.
  //
  // Now it is a real PHARMACY invoice carrying `admissionId`. Three consequences,
  // all deliberate:
  //
  //   * it is a PHARMACY bill, not an IPD one - pharmacy, labs and the stay are
  //     billed separately, each settled on its own;
  //   * it is left UNPAID (status PENDING) when the patient is in a bed, because
  //     the family settles on the way out, not at the ward door - that is the
  //     "bill me at discharge" the relatives actually ask for;
  //   * it is linked to the admission, so reception and the discharge desk can
  //     see it outstanding and nobody walks out owing the pharmacy money.
  //
  // No payment is recorded here even if one was passed: a bedside dispense has
  // nobody standing at the till.
  const invoice = await createInvoice(
    actor,
    {
      patientId: input.patientId,
      source: "PHARMACY",
      prescriptionUploadId: input.prescriptionUploadId,
      ...(liveAdmission ? { admissionId: liveAdmission.id } : {}),
      lines,
      discountAmount: input.discountAmount,
      notes: [
        input.shortSupplyReason ? `Short supply: ${input.shortSupplyReason}` : null,
        liveAdmission ? `Inpatient ${liveAdmission.ipNumber} - due at discharge` : null,
      ].filter(Boolean).join(" · ") || undefined,
      ...(liveAdmission ? {} : { payment: input.payment, payments: input.payments }),
    },
    ctx
  );

  if (liveAdmission) {
    if (input.prescriptionUploadId) {
      await prisma.prescriptionUpload.update({
        where: { id: input.prescriptionUploadId },
        data: { status: "DISPENSED", dispensedAt: new Date(), dispensedById: actor.id },
      });
    }
    await logAudit(actor, {
      action: "PHARMACY_BILLED_TO_INPATIENT", targetTable: "Admission", targetId: liveAdmission.id,
      meta: { ipNumber: liveAdmission.ipNumber, lines: lines.length, receiptNo: invoice.receiptNo, due: invoice.balanceDue },
      ...ctx,
    });

    // A ward dispense creates a DUE. Reception's ward screen and the counter's
    // own dues list both have to move, or somebody discharges a patient against
    // a balance that appeared thirty seconds ago.
    await publishLive(
      [TOPICS.PHARMACY, TOPICS.RECEPTION, TOPICS.IPD, TOPICS.ADMIN],
      EVENTS.INVOICE_RAISED
    );

    // `chargedToRoom` is kept in the shape so the counter can still say "don't
    // take money now" - but there IS an invoice behind it now, and it is due.
    return { chargedToRoom: true as const, ipNumber: liveAdmission.ipNumber, invoice };
  }

  // Close the loop on the scanned prescription.
  if (input.prescriptionUploadId) {
    await prisma.prescriptionUpload.update({
      where: { id: input.prescriptionUploadId },
      data: { status: "DISPENSED", dispensedAt: new Date(), dispensedById: actor.id },
    });
  }

  await logAudit(actor, { action: "MEDICINES_DISPENSED", targetTable: "Invoice", targetId: invoice.id, meta: { lines: lines.length, prescriptionUploadId: input.prescriptionUploadId ?? null }, ...ctx });

  // Reception watches this to see a chit clear off the queue; stock levels moved
  // too, so the counter's own alerts are stale as of now.
  const waiting = await prisma.prescriptionUpload.count({ where: { status: "SENT_TO_PHARMACY" } });
  await publishLive(
    [TOPICS.PHARMACY, TOPICS.RECEPTION, TOPICS.ADMIN],
    EVENTS.PRESCRIPTION_DISPENSED,
    waiting
  );
  return { chargedToRoom: false as const, ipNumber: null, invoice };
}

/** The pharmacy work queue: scans reception has dispatched here. */
export async function pharmacyRxQueue(status?: "SENT_TO_PHARMACY" | "DISPENSED"): Promise<{
  id: string; appointmentId: string | null; fileUrl: string | null; fileName: string | null; mimeType: string | null; title: string | null; doctorName: string | null;
  status: string; sentToPharmacyAt: string | null; dispensedAt: string | null; createdAt: string;
  patient: { id: string; displayId: string; fullName: string; phone: string; age: number | null };
  items: { medicineName: string; medicineId: string | null; qty: number; dosage: string | null }[];
}[]> {
  const rows = await prisma.prescriptionUpload.findMany({
    where: { status: status ?? "SENT_TO_PHARMACY" },
    orderBy: { sentToPharmacyAt: "desc" },
    take: 60,
    select: {
      id: true, appointmentId: true, fileUrl: true, fileName: true, mimeType: true, title: true, doctorName: true,
      status: true, sentToPharmacyAt: true, dispensedAt: true, createdAt: true,
      patient: { select: { id: true, displayId: true, fullName: true, phone: true, age: true } },
      items: { select: { medicineName: true, medicineId: true, qty: true, dosage: true } },
    },
  });
  return rows.map((r: {
    id: string; appointmentId: string | null; fileUrl: string | null; fileName: string | null; mimeType: string | null; title: string | null; doctorName: string | null;
    status: string; sentToPharmacyAt: Date | null; dispensedAt: Date | null; createdAt: Date;
    patient: { id: string; displayId: string; fullName: string; phone: string; age: number | null };
    items: { medicineName: string; medicineId: string | null; qty: number; dosage: string | null }[];
  }) => ({
    id: r.id, appointmentId: r.appointmentId, fileUrl: r.fileUrl, fileName: r.fileName, mimeType: r.mimeType, title: r.title, doctorName: r.doctorName,
    status: r.status,
    sentToPharmacyAt: r.sentToPharmacyAt ? r.sentToPharmacyAt.toISOString() : null,
    dispensedAt: r.dispensedAt ? r.dispensedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    patient: r.patient,
    items: r.items,
  }));
}

/** Batches for one medicine (FEFO order) - what the pharmacist sees on the shelf. */
export async function medicineBatches(medicineId: string) {
  const rows = await prisma.stockBatch.findMany({
    where: { medicineId },
    orderBy: { expiryDate: "asc" },
    select: {
      id: true, batchNo: true, expiryDate: true, quantity: true, mrp: true, purchasePrice: true,
      // The distributor's own columns, so the shelf reads like the bill it
      // arrived on rather than a re-interpretation of it.
      pack: true, packSize: true, freeQty: true, oMrp: true,
      // Dual-read, same rule as everywhere else: once a product's HSN lives on
      // the master the legacy column may be blank, and this panel would show an
      // empty HSN next to a stock row showing the right one.
      medicine: { select: { hsnCode: true, gstRatePct: true, hsn: { select: { code: true } } } },
      supplier: { select: { id: true, name: true } },
      // The receipt this batch arrived on - the answer to "where did this come
      // from?" when a recall notice names a batch number.
      grnItems: {
        orderBy: { goodsReceipt: { createdAt: "desc" } },
        take: 1,
        select: { goodsReceipt: { select: { id: true, grnNumber: true, invoiceNo: true, createdAt: true } } },
      },
    },
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  type BatchRow = {
    id: string; batchNo: string; expiryDate: Date; quantity: number;
    mrp: { toString(): string }; purchasePrice: { toString(): string } | null;
    pack: string | null; packSize: number; freeQty: number; oMrp: string | null;
    medicine: { hsnCode: string | null; gstRatePct: { toString(): string }; hsn: { code: string } | null };
    supplier: { id: string; name: string } | null;
    grnItems: { goodsReceipt: { id: string; grnNumber: string; invoiceNo: string | null; createdAt: Date } }[];
  };
  return (rows as BatchRow[]).map((b) => {
    const mrp = Number(b.mrp.toString());
    const rate = b.purchasePrice != null ? Number(b.purchasePrice.toString()) : null;
    const margin = rate != null ? mrp - rate : null;
    const grn = b.grnItems[0]?.goodsReceipt ?? null;
    return {
      id: b.id, batchNo: b.batchNo,
      expiryDate: b.expiryDate.toISOString().slice(0, 10),
      quantity: b.quantity,
      pack: b.pack,
      packSize: b.packSize,
      /// Whole packs still unopened, and what a per-unit sale actually costs.
      packsOnHand: Math.floor(b.quantity / Math.max(1, b.packSize)),
      looseUnits: b.quantity % Math.max(1, b.packSize),
      unitMrp: perUnitPrice(mrp, b.packSize).toFixed(2),
      unitRate: rate != null ? perUnitPrice(rate, b.packSize).toFixed(2) : null,
      freeQty: b.freeQty,
      oMrp: b.oMrp,
      hsn: resolveMaster(b.medicine.hsn?.code, b.medicine.hsnCode).value,
      gstRatePct: b.medicine.gstRatePct.toString(),
      mrp: b.mrp.toString(),
      rate: rate != null ? rate.toFixed(2) : null,
      margin: margin != null ? margin.toFixed(2) : null,
      marginPct: rate != null && mrp > 0 ? Math.round(((mrp - rate) / mrp) * 1000) / 10 : null,
      expired: b.expiryDate < today,
      supplierId: b.supplier?.id ?? null,
      supplierName: b.supplier?.name ?? null,
      grnId: grn?.id ?? null,
      grnNumber: grn?.grnNumber ?? null,
      supplierInvoiceNo: grn?.invoiceNo ?? null,
      receivedAt: grn ? grn.createdAt.toISOString() : null,
    };
  });
}

/**
 * Pharmacy profit numbers - the ONE implementation. pharmacyStats() and the admin
 * pharmacy tab both read it rather than each doing the arithmetic themselves,
 * because when this existed twice the two copies drifted and one of them valued
 * the entire shelf at fifteen times its worth.
 *
 * THE UNIT RULE, which is the whole difficulty here:
 *   InvoiceItem.unitPrice   - price of ONE DISPENSING UNIT (a tablet, a ml)
 *   StockBatch.quantity     - DISPENSING UNITS on the shelf
 *   StockBatch.mrp          - price of a WHOLE PACK, as printed on the carton
 *   StockBatch.purchasePrice- cost of a WHOLE PACK, as invoiced
 *
 * So every pack-priced figure must be divided by packSize before it meets a
 * unit-counted one. Getting this wrong doesn't crash - it just quietly reports a
 * ₹6 sale of paracetamol as a ₹750 loss.
 */
export async function pharmacyProfitSummary(): Promise<{
  profitToday: string; marginPct: number;
  stockValueCost: string; stockValueMrp: string; potentialProfit: string;
}> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const [todayItems, batches] = await Promise.all([
    prisma.invoiceItem.findMany({
      where: { batchId: { not: null }, invoice: { source: "PHARMACY", createdAt: { gte: today, lt: tomorrow }, status: { not: "CANCELLED" } } },
      select: { qty: true, unitPrice: true, batch: { select: { purchasePrice: true, packSize: true } } },
    }),
    prisma.stockBatch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { gte: today } },
      select: { quantity: true, mrp: true, purchasePrice: true, packSize: true },
    }),
  ]);

  let profitToday = 0, costedRevenue = 0;
  for (const it of todayItems as { qty: number; unitPrice: { toString(): string }; batch: { purchasePrice: { toString(): string } | null; packSize: number } | null }[]) {
    const pp = it.batch?.purchasePrice;
    if (pp == null) continue;
    const up = Number(it.unitPrice.toString());
    const costPerUnit = perUnitPrice(Number(pp.toString()), it.batch!.packSize);
    profitToday = r2(profitToday + (up - costPerUnit) * it.qty);
    costedRevenue = r2(costedRevenue + up * it.qty);
  }
  const marginPct = costedRevenue > 0 ? Math.round((profitToday / costedRevenue) * 1000) / 10 : 0;

  let stockValueCost = 0, stockValueMrp = 0;
  for (const b of batches as { quantity: number; mrp: { toString(): string }; purchasePrice: { toString(): string } | null; packSize: number }[]) {
    stockValueMrp = r2(stockValueMrp + b.quantity * perUnitPrice(Number(b.mrp.toString()), b.packSize));
    if (b.purchasePrice != null) {
      stockValueCost = r2(stockValueCost + b.quantity * perUnitPrice(Number(b.purchasePrice.toString()), b.packSize));
    }
  }
  const potentialProfit = r2(stockValueMrp - stockValueCost);

  return {
    profitToday: profitToday.toFixed(2), marginPct,
    stockValueCost: stockValueCost.toFixed(2), stockValueMrp: stockValueMrp.toFixed(2), potentialProfit: potentialProfit.toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// MONEY THE PHARMACY HAS DISPENSED BUT NOT YET COLLECTED
//
// An inpatient's medicine leaves this counter unpaid on purpose - the family
// settles on the way out. That is a deliberate debt, but a debt nobody is
// looking at is a debt that walks out of the building. This is the list that
// makes it visible: every pharmacy bill still carrying a balance, with the
// ward ones first, because those are the ones a discharge is waiting on.
// ---------------------------------------------------------------------------

/**
 * The dues list is now the shared one - see counterDues in billing.service for
 * the grouping and why the lab needed exactly the same screen. Kept as aliases
 * so callers importing these names still compile.
 */
export type PharmacyDue = CounterDue;
export type PharmacyIpdDue = CounterIpdDue;

export async function pharmacyDues(): Promise<CounterDues> {
  return counterDues("PHARMACY");
}

/** Dashboard: queue depth, stock health, expiry risk, today's revenue. */
export async function pharmacyStats(): Promise<{
  pendingRx: number; dispensedToday: number; revenueToday: string;
  lowStock: number; expiringSoon: number; expired: number;
  /** Realized gross profit today = sum of (MRP - purchase rate) x qty on dispensed lines with a known rate. */
  profitToday: string; marginPct: number;
  /** Unrealized margin sitting in current stock. */
  stockValueCost: string; stockValueMrp: string; potentialProfit: string;
  collections: ModeTotal[];
  /** Dispensed but not paid for - the counter's own debtors. See pharmacyDues(). */
  duesCount: number; duesTotal: string; duesIpdCount: number; duesIpdTotal: string;
}> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  // Same admin-set horizon the alerts screen uses - the dashboard count and the
  // list behind it must never disagree about what "expiring soon" means.
  const { expiryAlertDays } = await getSettings();
  const horizon = new Date(today); horizon.setDate(today.getDate() + expiryAlertDays);

  const [pendingRx, dispensedToday, invoices, meds, expiringSoon, expired, profit] = await Promise.all([
    prisma.prescriptionUpload.count({ where: { status: "SENT_TO_PHARMACY" } }),
    prisma.prescriptionUpload.count({ where: { status: "DISPENSED", dispensedAt: { gte: today, lt: tomorrow } } }),
    prisma.invoice.findMany({
      where: { source: "PHARMACY", createdAt: { gte: today, lt: tomorrow }, status: { not: "CANCELLED" } },
      select: { totalAmount: true },
    }),
    prisma.medicine.findMany({
      where: { active: true },
      select: {
        reorderThreshold: true,
        batches: { where: { quantity: { gt: 0 }, expiryDate: { gte: today } }, select: { quantity: true } },
      },
    }),
    prisma.stockBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { gte: today, lt: horizon } } }),
    prisma.stockBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { lt: today } } }),
    // Profit and stock valuation are NOT recomputed here - see pharmacyProfitSummary
    // for why there is exactly one copy of that arithmetic.
    pharmacyProfitSummary(),
  ]);

  const revenue = invoices.reduce((s: number, i: { totalAmount: { toString(): string } }) => r2(s + Number(i.totalAmount.toString())), 0);
  type MedB = { reorderThreshold: number; batches: { quantity: number }[] };
  const lowStock = (meds as MedB[])
    .filter((m) => m.batches.reduce((s, b) => s + b.quantity, 0) <= m.reorderThreshold).length;

  // What the pharmacy till took today, split by payment type.
  const collections = await collectionByMode({ sources: ["PHARMACY"] });
  // ...and what it dispensed today or any other day without being paid.
  const dues = await pharmacyDues();

  return {
    pendingRx, dispensedToday, revenueToday: revenue.toFixed(2),
    lowStock, expiringSoon, expired,
    ...profit,
    collections: collections.modes,
    duesCount: dues.count, duesTotal: dues.totalDue,
    duesIpdCount: dues.ipdCount, duesIpdTotal: dues.ipdTotal,
  };
}

/** Expiry & reorder watchlist - the report a pharmacist actually acts on. */
export async function stockAlerts(): Promise<{
  expiring: { batchId: string; medicine: string; batchNo: string; expiryDate: string; quantity: number; daysLeft: number }[];
  lowStock: { medicineId: string; name: string; inStock: number; reorderThreshold: number }[];
}> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  // How far ahead counts as "expiring soon" is an admin setting - a counter that
  // reorders weekly wants a different horizon from one that buys twice a year.
  const { expiryAlertDays } = await getSettings();
  const horizon = new Date(today); horizon.setDate(today.getDate() + expiryAlertDays);

  const [batches, meds] = await Promise.all([
    prisma.stockBatch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { lt: horizon } },
      orderBy: { expiryDate: "asc" }, take: 50,
      select: { id: true, batchNo: true, expiryDate: true, quantity: true, medicine: { select: { name: true } } },
    }),
    prisma.medicine.findMany({
      where: { active: true },
      select: {
        id: true, name: true, reorderThreshold: true,
        batches: { where: { quantity: { gt: 0 }, expiryDate: { gte: today } }, select: { quantity: true } },
      },
    }),
  ]);

  return {
    expiring: (batches as { id: string; batchNo: string; expiryDate: Date; quantity: number; medicine: { name: string } }[]).map((b) => ({
      batchId: b.id, medicine: b.medicine.name, batchNo: b.batchNo,
      expiryDate: b.expiryDate.toISOString().slice(0, 10),
      quantity: b.quantity,
      daysLeft: Math.round((b.expiryDate.getTime() - today.getTime()) / 86400000),
    })),
    lowStock: (meds as { id: string; name: string; reorderThreshold: number; batches: { quantity: number }[] }[])
      .map((m) => ({ medicineId: m.id, name: m.name, inStock: m.batches.reduce((s, b) => s + b.quantity, 0), reorderThreshold: m.reorderThreshold }))
      .filter((m) => m.inStock <= m.reorderThreshold),
  };
}
