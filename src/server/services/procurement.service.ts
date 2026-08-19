import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { nextId } from "@/lib/ids";
import { parsePack, packsToUnits } from "@/lib/pharmacy/pack";
import { logAudit } from "./audit.service";
import { notifySupplierPo, notifyStockReceived } from "./notify.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import {
  effectiveUnitCost, invoiceVariance, lineTax, lineValue, orderTotals, receiptTotal,
  round2, suggestedOrderQty,
} from "@/lib/pharmacy/procurement-math";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Procurement: the inbound half of the pharmacy.
//
// Dispensing could only ever take stock away. Everything that PUT it there was
// a pharmacist typing a batch number into a box, which meant the shelf had no
// answer to the three questions that actually get asked:
//
//   "Who sold us this?"            - a recall, a drug inspector
//   "What did we agree to pay?"    - a disputed distributor invoice
//   "What's on its way?"           - so we don't order it twice, or run out
//
// The chain is supplier -> purchase order -> goods receipt -> batch. A goods
// receipt is the ONLY way supplier stock reaches the shelf, and it is never
// edited after posting: corrections are a purchase return or a stock
// adjustment, each of which leaves its own row with a name on it.
// ---------------------------------------------------------------------------

const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dec = (n: number) => n.toFixed(2);

/** Dates arrive as YYYY-MM-DD and must land as a plain date, not a timezone. */
function asDate(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, "Invalid date");
  return d;
}

// ===========================================================================
// Suppliers
// ===========================================================================

export interface SupplierDTO {
  id: string; name: string; contactPerson: string | null; phone: string | null;
  email: string | null; address: string | null; gstin: string | null;
  drugLicenseNo: string | null; paymentTermDays: number; active: boolean; notes: string | null;
  /** Live counts, so the list answers "is this supplier actually in use?" */
  openOrders: number; medicinesSupplied: number;
  lastReceiptAt: string | null;
}

export async function listSuppliers(opts?: { includeInactive?: boolean; query?: string }): Promise<SupplierDTO[]> {
  const rows = await prisma.supplier.findMany({
    where: {
      ...(opts?.includeInactive ? {} : { active: true }),
      ...(opts?.query
        ? { OR: [
            { name: { contains: opts.query, mode: "insensitive" as const } },
            { contactPerson: { contains: opts.query, mode: "insensitive" as const } },
          ] }
        : {}),
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: 200,
    select: {
      id: true, name: true, contactPerson: true, phone: true, email: true, address: true,
      gstin: true, drugLicenseNo: true, paymentTermDays: true, active: true, notes: true,
      _count: { select: { preferredFor: true } },
      purchaseOrders: {
        where: { status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } },
        select: { id: true },
      },
      goodsReceipts: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  return rows.map((s) => ({
    id: s.id, name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email,
    address: s.address, gstin: s.gstin, drugLicenseNo: s.drugLicenseNo,
    paymentTermDays: s.paymentTermDays, active: s.active, notes: s.notes,
    openOrders: s.purchaseOrders.length,
    medicinesSupplied: s._count.preferredFor,
    lastReceiptAt: s.goodsReceipts[0]?.createdAt.toISOString() ?? null,
  }));
}

export async function upsertSupplier(
  actor: AuthUser,
  input: {
    id?: string; name: string; contactPerson?: string; phone?: string; email?: string;
    address?: string; gstin?: string; drugLicenseNo?: string; paymentTermDays?: number;
    active?: boolean; notes?: string;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ id: string }> {
  const data = {
    name: input.name.trim(),
    contactPerson: input.contactPerson?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    address: input.address?.trim() || null,
    gstin: input.gstin?.trim().toUpperCase() || null,
    drugLicenseNo: input.drugLicenseNo?.trim().toUpperCase() || null,
    paymentTermDays: input.paymentTermDays ?? 30,
    active: input.active ?? true,
    notes: input.notes?.trim() || null,
  };

  if (input.id) {
    // A supplier with live orders can't be switched off underneath them - the
    // orders would still be out there with nobody owning them.
    if (data.active === false) {
      const open = await prisma.purchaseOrder.count({
        where: { supplierId: input.id, status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } },
      });
      if (open > 0) {
        throw new ApiError(400, `${data.name} still has ${open} open purchase order${open === 1 ? "" : "s"}. Close or cancel them first.`);
      }
    }
    const s = await prisma.supplier.update({ where: { id: input.id }, data, select: { id: true } });
    await logAudit(actor, { action: "SUPPLIER_UPDATED", targetTable: "Supplier", targetId: s.id, meta: { name: data.name, active: data.active }, ...ctx });
    return s;
  }

  const s = await prisma.supplier.create({ data, select: { id: true } });
  await logAudit(actor, { action: "SUPPLIER_CREATED", targetTable: "Supplier", targetId: s.id, meta: { name: data.name }, ...ctx });
  return s;
}

/** One distributor's trading history - what we've bought, what's open, what they owe us. */
export async function supplierDetail(id: string) {
  const s = await prisma.supplier.findUnique({
    where: { id },
    select: {
      id: true, name: true, contactPerson: true, phone: true, email: true, address: true,
      gstin: true, drugLicenseNo: true, paymentTermDays: true, active: true, notes: true,
      purchaseOrders: {
        orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, poNumber: true, status: true, totalAmount: true, expectedDate: true, createdAt: true },
      },
      goodsReceipts: {
        orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, grnNumber: true, invoiceNo: true, receivedValue: true, invoiceAmount: true, createdAt: true },
      },
      purchaseReturns: {
        orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, returnNo: true, status: true, claimValue: true, creditedAmount: true, createdAt: true },
      },
    },
  });
  if (!s) throw new ApiError(404, "Supplier not found");

  const purchasedTotal = s.goodsReceipts.reduce((t, g) => round2(t + Number(g.receivedValue.toString())), 0);
  // Credit claimed but not yet settled - money this distributor owes the hospital.
  const creditOutstanding = s.purchaseReturns
    .filter((r) => r.status === "SENT")
    .reduce((t, r) => round2(t + Number(r.claimValue.toString())), 0);

  return {
    id: s.id, name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email,
    address: s.address, gstin: s.gstin, drugLicenseNo: s.drugLicenseNo,
    paymentTermDays: s.paymentTermDays, active: s.active, notes: s.notes,
    purchasedTotal: dec(purchasedTotal),
    creditOutstanding: dec(creditOutstanding),
    purchaseOrders: s.purchaseOrders.map((p) => ({
      id: p.id, poNumber: p.poNumber, status: p.status,
      totalAmount: p.totalAmount.toString(),
      expectedDate: p.expectedDate ? iso(p.expectedDate) : null,
      createdAt: p.createdAt.toISOString(),
    })),
    goodsReceipts: s.goodsReceipts.map((g) => ({
      id: g.id, grnNumber: g.grnNumber, invoiceNo: g.invoiceNo,
      receivedValue: g.receivedValue.toString(),
      invoiceAmount: g.invoiceAmount ? g.invoiceAmount.toString() : null,
      createdAt: g.createdAt.toISOString(),
    })),
    purchaseReturns: s.purchaseReturns.map((r) => ({
      id: r.id, returnNo: r.returnNo, status: r.status,
      claimValue: r.claimValue.toString(),
      creditedAmount: r.creditedAmount ? r.creditedAmount.toString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ===========================================================================
// Reorder - turning the alert list into an order
// ===========================================================================

export interface ReorderLine {
  medicineId: string; name: string; unit: string;
  /** ON HAND, in dispensing units (tablets, ml) - what the shelf holds. */
  inStock: number;
  /** Dispensing units per pack, from the last delivery. Orders are in packs. */
  packSize: number;
  /** The pack label that packSize came from ("15T"), for the screen. */
  packLabel: string | null;
  reorderThreshold: number; reorderQty: number | null;
  /** Already ordered and not yet delivered - the reason not to order twice. */
  onOrder: number;
  /** HOW MUCH TO ORDER, in PACKS - the unit a distributor actually sells in. */
  suggestedQty: number;
  /** What those packs come to in dispensing units, so the shortfall is legible. */
  suggestedUnits: number;
  /** Last rate we actually paid PER PACK, so the draft PO isn't priced from air. */
  lastUnitCost: string | null;
  gstRatePct: string;
  supplierId: string | null;
  supplierName: string | null;
  /** True when the shelf is empty right now - this is a patient turned away today. */
  outOfStock: boolean;
}

/**
 * What to buy, grouped by who we buy it from.
 *
 * The alerts screen already said "these 14 are low". That is a to-do list, not
 * a decision - the pharmacist still had to work out how much, from whom, at what
 * price, and then key it all in somewhere else. This returns the order itself,
 * already priced at the last rate paid and already netted off against stock
 * that is on its way.
 */
export async function reorderSuggestions(): Promise<{
  suppliers: { supplierId: string | null; supplierName: string; lines: ReorderLine[]; estimatedValue: string }[];
  totalLines: number;
}> {
  const today = today0();

  const meds = await prisma.medicine.findMany({
    where: { active: true },
    select: {
      id: true, name: true, unit: true, defaultPackSize: true, reorderThreshold: true, reorderQty: true, gstRatePct: true,
      preferredSupplier: { select: { id: true, name: true } },
      batches: {
        where: { quantity: { gt: 0 }, expiryDate: { gte: today } },
        // packSize comes along so a shortfall in units can be rounded into
        // whole packs - a distributor sells strips, not loose tablets.
        select: { quantity: true, packSize: true, pack: true },
      },
      // Most recent rate actually paid - the honest starting price for a new order.
      grnItems: {
        orderBy: { goodsReceipt: { createdAt: "desc" } },
        take: 1,
        select: { unitCost: true },
      },
      // Units on a PO that has been sent but hasn't fully landed.
      poItems: {
        where: { purchaseOrder: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] } } },
        select: { qtyOrdered: true, qtyReceived: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const lines: ReorderLine[] = [];
  for (const m of meds) {
    const inStock = m.batches.reduce((s, b) => s + b.quantity, 0);
    const onOrder = m.poItems.reduce((s, p) => s + Math.max(0, p.qtyOrdered - p.qtyReceived), 0);
    if (inStock > m.reorderThreshold) continue;

    // The shortfall is computed in UNITS - that is what the shelf and the
    // threshold are both counted in.
    const shortfallUnits = suggestedOrderQty({
      inStock, reorderThreshold: m.reorderThreshold, reorderQty: m.reorderQty, onOrder,
    });
    // Fully covered by stock already on its way - nothing to decide.
    if (shortfallUnits <= 0) continue;

    // Then rounded UP into whole packs, because that is the only thing a
    // distributor will sell. Ordering 40 tablets of a 15-strip means 3 strips.
    // Prefer what is physically on the shelf; fall back to the product's own
    // default, which receiveGoods keeps current. Out of stock is exactly when
    // this matters most, and that is when `batches` is empty.
    const onShelf = m.batches.find((b) => b.packSize > 1);
    const packSize = Math.max(1, onShelf?.packSize ?? m.defaultPackSize ?? 1);
    const suggested = Math.max(1, Math.ceil(shortfallUnits / packSize));

    lines.push({
      medicineId: m.id, name: m.name, unit: m.unit,
      inStock, packSize, packLabel: onShelf?.pack ?? null,
      reorderThreshold: m.reorderThreshold, reorderQty: m.reorderQty,
      onOrder, suggestedQty: suggested, suggestedUnits: suggested * packSize,
      lastUnitCost: m.grnItems[0] ? m.grnItems[0].unitCost.toString() : null,
      gstRatePct: m.gstRatePct.toString(),
      supplierId: m.preferredSupplier?.id ?? null,
      supplierName: m.preferredSupplier?.name ?? null,
      outOfStock: inStock === 0,
    });
  }

  // Group by distributor: one trip, one order, one delivery.
  const groups = new Map<string, { supplierId: string | null; supplierName: string; lines: ReorderLine[] }>();
  for (const l of lines) {
    const key = l.supplierId ?? "__none__";
    if (!groups.has(key)) {
      groups.set(key, {
        supplierId: l.supplierId,
        supplierName: l.supplierName ?? "No supplier set",
        lines: [],
      });
    }
    groups.get(key)!.lines.push(l);
  }

  const suppliers = [...groups.values()]
    .map((g) => ({
      ...g,
      // Out-of-stock first: those are patients being turned away today.
      lines: g.lines.sort((a, b) => Number(b.outOfStock) - Number(a.outOfStock) || a.name.localeCompare(b.name)),
      estimatedValue: dec(
        g.lines.reduce((t, l) => round2(t + lineValue(l.suggestedQty, Number(l.lastUnitCost ?? 0))), 0)
      ),
    }))
    // Unassigned last - it's a data-hygiene bucket, not an order you can place.
    .sort((a, b) => (a.supplierId === null ? 1 : b.supplierId === null ? -1 : a.supplierName.localeCompare(b.supplierName)));

  return { suppliers, totalLines: lines.length };
}

// ===========================================================================
// Purchase orders
// ===========================================================================

async function recalcOrderTotals(tx: Prisma.TransactionClient, purchaseOrderId: string): Promise<void> {
  const items = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    select: { qtyOrdered: true, unitCost: true, gstRatePct: true },
  });
  const t = orderTotals(items.map((i) => ({
    qtyOrdered: i.qtyOrdered,
    unitCost: Number(i.unitCost.toString()),
    gstRatePct: Number(i.gstRatePct.toString()),
  })));
  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { subtotal: dec(t.subtotal), taxAmount: dec(t.taxAmount), totalAmount: dec(t.totalAmount) },
  });
}

export interface PoLineInput {
  medicineId: string; qtyOrdered: number; unitCost: number; gstRatePct?: number; freeQty?: number;
}

export async function createPurchaseOrder(
  actor: AuthUser,
  input: { supplierId: string; expectedDate?: string; notes?: string; items: PoLineInput[]; send?: boolean },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ id: string; poNumber: string }> {
  if (!input.items.length) throw new ApiError(400, "A purchase order needs at least one medicine");

  // One line per medicine - two lines for the same drug at two rates is how a
  // PO stops matching the delivery note.
  const seen = new Set<string>();
  for (const i of input.items) {
    if (seen.has(i.medicineId)) throw new ApiError(400, "The same medicine appears twice - merge those lines");
    seen.add(i.medicineId);
    if (i.qtyOrdered <= 0) throw new ApiError(400, "Order quantity must be at least 1");
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true, active: true } });
  if (!supplier) throw new ApiError(404, "Supplier not found");
  if (!supplier.active) throw new ApiError(400, `${supplier.name} is no longer an active supplier`);

  const meds = await prisma.medicine.findMany({ where: { id: { in: [...seen] } }, select: { id: true } });
  if (meds.length !== seen.size) throw new ApiError(400, "One of those medicines isn't in the catalog");

  const result = await prisma.$transaction(async (tx) => {
    const poNumber = await nextId("PO", { tx });
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: input.supplierId,
        status: input.send ? "SENT" : "DRAFT",
        sentAt: input.send ? new Date() : null,
        expectedDate: input.expectedDate ? asDate(input.expectedDate) : null,
        notes: input.notes?.trim() || null,
        createdById: actor.id,
        items: {
          create: input.items.map((i) => ({
            medicineId: i.medicineId,
            qtyOrdered: Math.floor(i.qtyOrdered),
            unitCost: dec(i.unitCost),
            gstRatePct: dec(i.gstRatePct ?? 0),
            freeQty: Math.max(0, Math.floor(i.freeQty ?? 0)),
          })),
        },
      },
      select: { id: true, poNumber: true },
    });
    await recalcOrderTotals(tx, po.id);
    return po;
  });

  await logAudit(actor, {
    action: input.send ? "PO_CREATED_AND_SENT" : "PO_CREATED",
    targetTable: "PurchaseOrder", targetId: result.id,
    meta: { poNumber: result.poNumber, supplier: supplier.name, lines: input.items.length }, ...ctx,
  });
  return result;
}

/**
 * Raise one draft order per distributor straight off the reorder screen.
 * Lines with no supplier are skipped and reported, rather than silently dropped -
 * an order that quietly loses half its lines is worse than one that refuses.
 */
export async function createPurchaseOrdersFromReorder(
  actor: AuthUser,
  input: {
    send?: boolean;
    groups: { supplierId: string; expectedDate?: string; items: PoLineInput[] }[];
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ created: { poNumber: string; supplier: string; lines: number; totalAmount: string }[] }> {
  if (!input.groups.length) throw new ApiError(400, "Nothing selected to order");

  const created: { poNumber: string; supplier: string; lines: number; totalAmount: string }[] = [];
  for (const g of input.groups) {
    if (!g.items.length) continue;
    const po = await createPurchaseOrder(
      actor,
      { supplierId: g.supplierId, expectedDate: g.expectedDate, items: g.items, send: input.send, notes: "Raised from reorder list" },
      ctx
    );
    const row = await prisma.purchaseOrder.findUnique({
      where: { id: po.id },
      select: { totalAmount: true, supplier: { select: { name: true } }, _count: { select: { items: true } } },
    });
    created.push({
      poNumber: po.poNumber,
      supplier: row?.supplier.name ?? "",
      lines: row?._count.items ?? g.items.length,
      totalAmount: row?.totalAmount.toString() ?? "0.00",
    });
  }
  return { created };
}

/** Edit a draft. Once an order is with the distributor its lines are frozen. */
export async function updatePurchaseOrder(
  actor: AuthUser,
  input: { id: string; expectedDate?: string | null; notes?: string; items?: PoLineInput[] },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: input.id }, select: { id: true, status: true, poNumber: true } });
  if (!po) throw new ApiError(404, "Purchase order not found");
  if (po.status !== "DRAFT") {
    throw new ApiError(400, `${po.poNumber} has already been sent to the supplier - its lines can't be changed. Cancel it and raise a new one.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: input.id },
      data: {
        ...(input.expectedDate !== undefined
          ? { expectedDate: input.expectedDate ? asDate(input.expectedDate) : null }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
      },
    });

    if (input.items) {
      if (!input.items.length) throw new ApiError(400, "A purchase order needs at least one medicine");
      const seen = new Set<string>();
      for (const i of input.items) {
        if (seen.has(i.medicineId)) throw new ApiError(400, "The same medicine appears twice - merge those lines");
        seen.add(i.medicineId);
        if (i.qtyOrdered <= 0) throw new ApiError(400, "Order quantity must be at least 1");
      }
      // Nothing has been received against a draft, so replacing the lines
      // wholesale can't orphan a receipt.
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: input.id } });
      await tx.purchaseOrderItem.createMany({
        data: input.items.map((i) => ({
          purchaseOrderId: input.id,
          medicineId: i.medicineId,
          qtyOrdered: Math.floor(i.qtyOrdered),
          unitCost: dec(i.unitCost),
          gstRatePct: dec(i.gstRatePct ?? 0),
          freeQty: Math.max(0, Math.floor(i.freeQty ?? 0)),
        })),
      });
    }
    await recalcOrderTotals(tx, input.id);
  });

  await logAudit(actor, { action: "PO_UPDATED", targetTable: "PurchaseOrder", targetId: input.id, meta: { poNumber: po.poNumber }, ...ctx });
}

export async function sendPurchaseOrder(
  actor: AuthUser,
  id: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true, status: true, poNumber: true, _count: { select: { items: true } },
      supplier: { select: { name: true, phone: true } },
    },
  });
  if (!po) throw new ApiError(404, "Purchase order not found");
  if (po.status !== "DRAFT") throw new ApiError(400, `${po.poNumber} has already been sent`);
  if (po._count.items === 0) throw new ApiError(400, "That order has no lines on it");

  await prisma.purchaseOrder.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
  await logAudit(actor, { action: "PO_SENT", targetTable: "PurchaseOrder", targetId: id, meta: { poNumber: po.poNumber }, ...ctx });

  // Tell the distributor an order is waiting. Fires once - the DRAFT guard above
  // means a second "Send" is a 400, so a supplier is never texted twice for the
  // same PO no matter how many times the button is pressed.
  //
  // Supplier.phone is optional in the schema and plenty of distributors are on
  // record with a landline, so this is frequently a no-op. That is correct: the
  // PO document, not the text, is the order.
  await notifySupplierPo(po.supplier.phone, {
    supplierName: po.supplier.name,
    poNumber: po.poNumber,
    lineCount: po._count.items,
  });
}

export async function cancelPurchaseOrder(
  actor: AuthUser,
  input: { id: string; reason: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, poNumber: true, items: { select: { qtyReceived: true } } },
  });
  if (!po) throw new ApiError(404, "Purchase order not found");
  if (po.status === "CANCELLED") throw new ApiError(400, "That order is already cancelled");
  if (po.status === "RECEIVED") throw new ApiError(400, "That order has been fully received - it can't be cancelled");
  // Part-delivered stock is already on the shelf and already owed for. Cancelling
  // would leave a receipt pointing at an order that claims nothing was ordered.
  if (po.items.some((i) => i.qtyReceived > 0)) {
    throw new ApiError(400, `Part of ${po.poNumber} has already been delivered. Close it short instead of cancelling.`);
  }

  await prisma.purchaseOrder.update({
    where: { id: input.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason.trim() },
  });
  await logAudit(actor, { action: "PO_CANCELLED", targetTable: "PurchaseOrder", targetId: input.id, meta: { poNumber: po.poNumber, reason: input.reason }, ...ctx });
}

/**
 * Accept that the rest is never coming.
 *
 * Distributors short-supply constantly. Without this a partly-delivered order
 * sits "open" forever, and the reorder engine keeps subtracting phantom stock
 * that is on its way - so the medicine never gets reordered and quietly runs out.
 */
export async function closePurchaseOrderShort(
  actor: AuthUser,
  input: { id: string; reason: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: input.id }, select: { id: true, status: true, poNumber: true } });
  if (!po) throw new ApiError(404, "Purchase order not found");
  if (po.status !== "SENT" && po.status !== "PARTIALLY_RECEIVED") {
    throw new ApiError(400, "Only an open order can be closed short");
  }

  await prisma.purchaseOrder.update({
    where: { id: input.id },
    data: { status: "RECEIVED", closedAt: new Date(), notes: undefined, cancelReason: `Closed short: ${input.reason.trim()}` },
  });
  await logAudit(actor, { action: "PO_CLOSED_SHORT", targetTable: "PurchaseOrder", targetId: input.id, meta: { poNumber: po.poNumber, reason: input.reason }, ...ctx });
}

export async function listPurchaseOrders(filter?: { status?: string; supplierId?: string; query?: string }) {
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      ...(filter?.status && filter.status !== "ALL"
        ? filter.status === "OPEN"
          ? { status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } }
          : { status: filter.status as Prisma.EnumPurchaseOrderStatusFilter["equals"] }
        : {}),
      ...(filter?.supplierId ? { supplierId: filter.supplierId } : {}),
      ...(filter?.query ? { poNumber: { contains: filter.query, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, poNumber: true, status: true, expectedDate: true, totalAmount: true, createdAt: true, sentAt: true,
      supplier: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      items: { select: { qtyOrdered: true, qtyReceived: true } },
    },
  });

  const today = today0();
  return rows.map((p) => {
    const ordered = p.items.reduce((s, i) => s + i.qtyOrdered, 0);
    const received = p.items.reduce((s, i) => s + Math.min(i.qtyReceived, i.qtyOrdered), 0);
    const open = p.status === "SENT" || p.status === "PARTIALLY_RECEIVED";
    return {
      id: p.id, poNumber: p.poNumber, status: p.status,
      supplierId: p.supplier.id, supplierName: p.supplier.name,
      totalAmount: p.totalAmount.toString(),
      expectedDate: p.expectedDate ? iso(p.expectedDate) : null,
      createdAt: p.createdAt.toISOString(),
      sentAt: p.sentAt ? p.sentAt.toISOString() : null,
      createdByName: p.createdBy.name,
      lines: p.items.length,
      qtyOrdered: ordered,
      qtyReceived: received,
      fulfilledPct: ordered > 0 ? Math.round((received / ordered) * 100) : 0,
      /** Past its promised date and still not here - the only PO worth chasing. */
      overdue: open && !!p.expectedDate && p.expectedDate < today,
      daysLate: open && p.expectedDate && p.expectedDate < today
        ? Math.round((today.getTime() - p.expectedDate.getTime()) / 86400000)
        : 0,
    };
  });
}

export async function purchaseOrderDetail(id: string) {
  const p = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true, poNumber: true, status: true, expectedDate: true, notes: true, cancelReason: true,
      subtotal: true, taxAmount: true, totalAmount: true,
      createdAt: true, sentAt: true, closedAt: true, cancelledAt: true,
      supplier: { select: { id: true, name: true, phone: true, email: true, gstin: true, drugLicenseNo: true, address: true, paymentTermDays: true } },
      createdBy: { select: { name: true } },
      items: {
        orderBy: { medicine: { name: "asc" } },
        select: {
          id: true, qtyOrdered: true, qtyReceived: true, unitCost: true, gstRatePct: true, freeQty: true,
          medicine: { select: { id: true, name: true, unit: true, hsnCode: true } },
        },
      },
      receipts: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, grnNumber: true, invoiceNo: true, receivedValue: true, createdAt: true,
          receivedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!p) throw new ApiError(404, "Purchase order not found");

  return {
    id: p.id, poNumber: p.poNumber, status: p.status,
    expectedDate: p.expectedDate ? iso(p.expectedDate) : null,
    notes: p.notes, cancelReason: p.cancelReason,
    subtotal: p.subtotal.toString(), taxAmount: p.taxAmount.toString(), totalAmount: p.totalAmount.toString(),
    createdAt: p.createdAt.toISOString(),
    sentAt: p.sentAt ? p.sentAt.toISOString() : null,
    closedAt: p.closedAt ? p.closedAt.toISOString() : null,
    cancelledAt: p.cancelledAt ? p.cancelledAt.toISOString() : null,
    createdByName: p.createdBy.name,
    supplier: p.supplier,
    items: p.items.map((i) => ({
      id: i.id,
      medicineId: i.medicine.id, name: i.medicine.name, unit: i.medicine.unit, hsnCode: i.medicine.hsnCode,
      qtyOrdered: i.qtyOrdered, qtyReceived: i.qtyReceived,
      qtyPending: Math.max(0, i.qtyOrdered - i.qtyReceived),
      unitCost: i.unitCost.toString(), gstRatePct: i.gstRatePct.toString(), freeQty: i.freeQty,
      lineValue: dec(lineValue(i.qtyOrdered, Number(i.unitCost.toString()))),
    })),
    receipts: p.receipts.map((g) => ({
      id: g.id, grnNumber: g.grnNumber, invoiceNo: g.invoiceNo,
      receivedValue: g.receivedValue.toString(),
      createdAt: g.createdAt.toISOString(),
      receivedByName: g.receivedBy.name,
    })),
  };
}

// ===========================================================================
// Goods receipt - the only door supplier stock comes through
// ===========================================================================

export interface GrnLineInput {
  /** Empty when this line is for a product not yet in the catalogue - see
   *  `newMedicineName` below. One of the two must be present. */
  medicineId?: string;
  /** Book in something the catalogue has never seen. A distributor's delivery
   *  routinely contains a product nobody has stocked before, and forcing the
   *  pharmacist to leave the receipt, create it, and start again is how a
   *  delivery ends up half-entered. */
  newMedicineName?: string;
  purchaseOrderItemId?: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  freeQty?: number;
  unitCost: number;
  mrp: number;
  /** As printed on the distributor's bill. All optional - a hand-written
   *  delivery note carries none of them, and stock must still reach the shelf. */
  pack?: string;
  /** Dispensing units per pack. Overrides whatever `pack` parses to, for the
   *  cases where the label is unreadable and the pharmacist knows the answer. */
  packSize?: number;
  oMrp?: string;
  hsn?: string;
  gstRatePct?: number;
}

/**
 * Receive a delivery.
 *
 * Everything here happens in ONE transaction, because a half-posted GRN is the
 * worst possible state: stock on the shelf that no document explains, or a
 * document claiming stock that isn't there.
 *
 * What it does per line:
 *   - refuses expired and same-day-expiry stock outright (it can never be sold)
 *   - refuses a batch number that already exists for that medicine with a
 *     DIFFERENT expiry - that is either a keying error or two real batches
 *     sharing a number, and silently merging them corrupts FEFO forever
 *   - creates or tops up the batch, stamping the supplier on it
 *   - stores the EFFECTIVE unit cost (free goods folded in), so every margin
 *     figure downstream is true
 *   - writes the stock ledger row that the quantity is a side effect of
 *   - advances the purchase order's fulfilment
 */
export async function receiveGoods(
  actor: AuthUser,
  input: {
    supplierId: string;
    purchaseOrderId?: string;
    invoiceNo?: string;
    invoiceDate?: string;
    invoiceAmount?: number;
    notes?: string;
    items: GrnLineInput[];
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{
  id: string; grnNumber: string;
  /** Goods only, ex-GST - the cost basis. */
  receivedValue: string;
  /** Tax charged on those goods. */
  receivedTax: string;
  /** receivedValue + receivedTax. What the supplier's bill should total. */
  receivedTotal: string;
  variance: number | null; mismatch: boolean;
  /** Products this delivery added to the catalogue, so the desk is told. */
  createdMedicines: { id: string; name: string }[];
}> {
  if (!input.items.length) throw new ApiError(400, "Nothing to receive - add at least one line");

  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true, active: true } });
  if (!supplier) throw new ApiError(404, "Supplier not found");
  if (!supplier.active) throw new ApiError(400, `${supplier.name} is no longer an active supplier`);

  const today = today0();

  // ── Validate every line BEFORE touching stock ────────────────────────────
  // A delivery is checked against the carton at the counter; the system should
  // reject the whole note the same way, not accept six lines and then refuse
  // the seventh with three batches already on the shelf.
  for (const it of input.items) {
    if (it.qty <= 0) throw new ApiError(400, "Received quantity must be at least 1");
    if ((it.freeQty ?? 0) < 0) throw new ApiError(400, "Free quantity can't be negative");
    const exp = asDate(it.expiryDate);
    if (exp <= today) {
      // A new-product line carries no `medicineId` - the catalogue row is only
      // created inside the transaction below, and the validator deliberately
      // accepts a name instead. Look up only when there is an id to look up,
      // and otherwise name the product from what the pharmacist typed, so an
      // expired batch is refused with the same sentence either way.
      const med = it.medicineId
        ? await prisma.medicine.findUnique({ where: { id: it.medicineId }, select: { name: true } })
        : null;
      const label = med?.name ?? (it.newMedicineName?.trim() || "That medicine");
      throw new ApiError(400, `${label} batch ${it.batchNo} expires ${it.expiryDate} - don't take it in, send it back with the delivery.`);
    }
  }

  let po: { id: string; status: string; poNumber: string; supplierId: string } | null = null;
  if (input.purchaseOrderId) {
    const found = await prisma.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      select: { id: true, status: true, poNumber: true, supplierId: true },
    });
    if (!found) throw new ApiError(404, "Purchase order not found");
    if (found.supplierId !== input.supplierId) throw new ApiError(400, "That purchase order belongs to a different supplier");
    if (found.status === "CANCELLED") throw new ApiError(400, `${found.poNumber} was cancelled - it can't receive stock`);
    if (found.status === "DRAFT") throw new ApiError(400, `${found.poNumber} hasn't been sent to the supplier yet`);
    po = found;
  }

  const result = await prisma.$transaction(async (tx) => {
    const grnNumber = await nextId("GRN", { tx });
    let receivedValue = 0;
    let receivedTax = 0;
    const createdMedicines: { id: string; name: string }[] = [];

    const grn = await tx.goodsReceipt.create({
      data: {
        grnNumber,
        supplierId: input.supplierId,
        purchaseOrderId: po?.id ?? null,
        invoiceNo: input.invoiceNo?.trim() || null,
        invoiceDate: input.invoiceDate ? asDate(input.invoiceDate) : null,
        invoiceAmount: input.invoiceAmount !== undefined ? dec(input.invoiceAmount) : null,
        notes: input.notes?.trim() || null,
        receivedById: actor.id,
      },
      select: { id: true, grnNumber: true },
    });

    for (const it of input.items) {
      const medSelect = { id: true, name: true, hsnCode: true, gstRatePct: true, defaultPackSize: true } as const;

      let med = it.medicineId
        ? await tx.medicine.findUnique({ where: { id: it.medicineId }, select: medSelect })
        : null;

      // A product the catalogue has never seen. Created here rather than sent
      // away to a separate screen - but matched by name first, because two
      // spellings of the same drug on two shelves is a dispensing hazard, not
      // a tidiness problem.
      if (!med && it.newMedicineName?.trim()) {
        const name = it.newMedicineName.trim().replace(/\s+/g, " ");
        med = await tx.medicine.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: medSelect });
        if (!med) {
          med = await tx.medicine.create({
            data: {
              name,
              // Seeded from the invoice where it said so; the pharmacist can
              // correct any of it afterwards from the stock screen.
              hsnCode: it.hsn?.trim() || null,
              ...(it.gstRatePct !== undefined ? { gstRatePct: it.gstRatePct.toFixed(2) } : {}),
              unit: parsePack(it.pack).unit,
            },
            select: medSelect,
          });
          createdMedicines.push({ id: med.id, name: med.name });
          await logAudit(actor, {
            action: "MEDICINE_CREATED", targetTable: "Medicine", targetId: med.id,
            meta: { name: med.name, source: "goods-receipt", grn: grnNumber }, ...ctx,
          }, tx);
        }
      }
      if (!med) throw new ApiError(404, "Medicine not found - pick one, or give a name for a new product");

      // Units per pack for THIS line. An explicit value wins; otherwise it is
      // read off the printed pack label, and an unreadable label falls back to
      // 1 (loose units) rather than guessing - a wrong multiplier would inflate
      // the whole shelf invisibly.
      const packSize = Math.max(1, Math.floor(it.packSize ?? parsePack(it.pack).size));

      // HSN and GST% belong to the PRODUCT, not the consignment, so they go on
      // the medicine - but only to fill a blank. The catalogue is the hospital's
      // own tax position; a distributor's bill may differ, and letting each
      // delivery rewrite it would make the rate flap with whoever supplied last.
      //
      // The pack size is different: it is remembered on the product because
      // reorder needs it when the shelf is EMPTY - which is exactly when there
      // is no batch left to read it from, and exactly when reordering matters.
      const learnPack = packSize > 1 && packSize !== med.defaultPackSize;

      if (learnPack || (it.hsn?.trim() && !med.hsnCode) || (it.gstRatePct !== undefined && Number(med.gstRatePct) === 0)) {
        await tx.medicine.update({
          where: { id: med.id },
          data: {
            ...(learnPack ? { defaultPackSize: packSize } : {}),
            ...(it.hsn?.trim() && !med.hsnCode ? { hsnCode: it.hsn.trim() } : {}),
            ...(it.gstRatePct !== undefined && Number(med.gstRatePct) === 0 ? { gstRatePct: it.gstRatePct.toFixed(2) } : {}),
          },
        });
      }

      const batchNo = it.batchNo.trim();
      const expiry = asDate(it.expiryDate);
      // The invoice counts PACKS. The shelf counts UNITS.
      // "PACK 15T · QTY 3" is 45 tablets, not 3. (packSize resolved above.)
      const packsBought = Math.floor(it.qty);
      const packsFree = Math.max(0, Math.floor(it.freeQty ?? 0));
      const qty = packsBought;                       // packs, for costing
      const free = packsFree;                        // packs, for costing
      const units = packsToUnits(packsBought + packsFree, packSize);
      const freeUnits = packsToUnits(packsFree, packSize);

      // Landed cost per unit, free goods folded in. This is what makes the
      // pharmacy's profit figures honest - see procurement-math.
      const landed = effectiveUnitCost(qty, free, it.unitCost);

      // A batch is identified by medicine + batch number + SUPPLIER. The same
      // manufacturer batch bought from two distributors is two consignments,
      // and they stay two rows: one recall, one return and one landed cost each.
      const existing = await tx.stockBatch.findUnique({
        where: {
          medicineId_batchNo_supplierId: { medicineId: med.id, batchNo, supplierId: input.supplierId },
        },
        select: { id: true, expiryDate: true },
      });

      // Batch numbers come off the manufacturer's strip, so the same number on
      // the same medicine must carry the same expiry no matter who delivered
      // it. A mismatch is a typing error, and letting it through would put two
      // different expiries into FEFO under one number.
      const elsewhere = await tx.stockBatch.findFirst({
        where: { medicineId: med.id, batchNo, supplierId: { not: input.supplierId } },
        select: { expiryDate: true, supplier: { select: { name: true } } },
      });
      if (elsewhere && iso(elsewhere.expiryDate) !== iso(expiry)) {
        throw new ApiError(
          400,
          `Batch ${batchNo} of ${med.name} is already on the shelf from ${elsewhere.supplier.name} expiring ${iso(elsewhere.expiryDate)}, but this delivery says ${iso(expiry)}. Same batch number, two expiry dates - check the strip before receiving.`
        );
      }

      let batchId: string;
      if (existing) {
        if (iso(existing.expiryDate) !== iso(expiry)) {
          throw new ApiError(
            400,
            `Batch ${batchNo} of ${med.name} is already on the shelf expiring ${iso(existing.expiryDate)}, but this delivery says ${iso(expiry)}. Check the strip before receiving - merging them would break expiry-first dispensing.`
          );
        }
        // Same supplier, same batch, second delivery: genuinely the same
        // consignment continuing, so quantity and the latest landed cost merge.
        await tx.stockBatch.update({
          where: { id: existing.id },
          data: {
            quantity: { increment: units },
            mrp: dec(it.mrp),
            purchasePrice: dec(landed),
            freeQty: { increment: freeUnits },
            packSize,
            // Only overwrite a label when this delivery actually carried one -
            // a blank column on today's bill shouldn't erase what the last one
            // told us about the same consignment.
            ...(it.pack?.trim() ? { pack: it.pack.trim() } : {}),
            ...(it.oMrp?.trim() ? { oMrp: it.oMrp.trim() } : {}),
          },
        });
        batchId = existing.id;
      } else {
        const b = await tx.stockBatch.create({
          data: {
            medicineId: med.id,
            batchNo,
            expiryDate: expiry,
            quantity: units,
            mrp: dec(it.mrp),
            purchasePrice: dec(landed),
            supplierId: input.supplierId,
            freeQty: freeUnits,
            packSize,
            pack: it.pack?.trim() || null,
            oMrp: it.oMrp?.trim() || null,
          },
          select: { id: true },
        });
        batchId = b.id;
      }

      // The ledger row. Quantity above is the side effect; this is the record.
      await tx.stockTransaction.create({
        data: {
          batchId, type: "PURCHASE", qty: units,
          refId: grn.grnNumber,
          reason: input.invoiceNo?.trim()
            ? `Received from ${supplier.name} · invoice ${input.invoiceNo.trim()}`
            : `Received from ${supplier.name}`,
          performedById: actor.id,
        },
      });

      // Advance the order's fulfilment, if this line came off one.
      let poItemId: string | null = null;
      if (po) {
        const poItem = it.purchaseOrderItemId
          ? await tx.purchaseOrderItem.findUnique({ where: { id: it.purchaseOrderItemId }, select: { id: true, purchaseOrderId: true } })
          : await tx.purchaseOrderItem.findUnique({
              where: { purchaseOrderId_medicineId: { purchaseOrderId: po.id, medicineId: med.id } },
              select: { id: true, purchaseOrderId: true },
            });
        // An unordered extra in the carton is normal and is still real stock -
        // it's received, just not matched to a line.
        if (poItem && poItem.purchaseOrderId === po.id) {
          poItemId = poItem.id;
          // PACKS, not units. A PO is placed in packs ("order 3 strips"), so
          // crediting it with 45 tablets would mark a 3-pack order as
          // fifteen-fold over-delivered the moment it arrived.
          await tx.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: { qtyReceived: { increment: packsBought + packsFree } },
          });
        }
      }

      // THE RATE TAX IS CHARGED AT ON THIS LINE. What the delivery note says
      // wins, because that is what the supplier actually billed; the catalogue
      // rate is the fallback for a line the desk did not type a rate on. Falling
      // back to 0 instead would put the whole tax back into the variance, which
      // is the bug this line exists to close.
      const gstRatePct = it.gstRatePct ?? Number(med.gstRatePct.toString());

      await tx.goodsReceiptItem.create({
        data: {
          goodsReceiptId: grn.id,
          purchaseOrderItemId: poItemId,
          medicineId: med.id,
          batchId,
          batchNo,
          expiryDate: expiry,
          qty,
          freeQty: free,
          unitCost: dec(it.unitCost),
          mrp: dec(it.mrp),
          gstRatePct: dec(gstRatePct),
        },
      });

      // Tax rides on the SAME base as the goods value - paid packs at the
      // invoice rate, free goods excluded. Any other base and the two numbers
      // stop adding up to the bill they are checked against.
      receivedValue = round2(receivedValue + lineValue(qty, it.unitCost));
      receivedTax = round2(receivedTax + lineTax(qty, it.unitCost, gstRatePct));
    }

    await tx.goodsReceipt.update({
      where: { id: grn.id },
      data: { receivedValue: dec(receivedValue), receivedTax: dec(receivedTax) },
    });

    // Re-derive the order's status from its lines - never trust a running flag.
    if (po) {
      const items = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
        select: { qtyOrdered: true, qtyReceived: true },
      });
      const complete = items.every((i) => i.qtyReceived >= i.qtyOrdered);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: complete
          ? { status: "RECEIVED", closedAt: new Date() }
          : { status: "PARTIALLY_RECEIVED" },
      });
    }

    return { id: grn.id, grnNumber: grn.grnNumber, receivedValue, receivedTax, createdMedicines };
  });

  // Checked against the GST-INCLUSIVE total, because that is the figure printed
  // on the distributor's invoice the desk just typed in.
  const receivedTotal = receiptTotal(result.receivedValue, result.receivedTax);
  const v = invoiceVariance(input.invoiceAmount, receivedTotal);

  await logAudit(actor, {
    action: "GOODS_RECEIVED", targetTable: "GoodsReceipt", targetId: result.id,
    meta: {
      grnNumber: result.grnNumber, supplier: supplier.name, lines: input.items.length,
      poNumber: po?.poNumber ?? null, receivedValue: dec(result.receivedValue),
      receivedTax: dec(result.receivedTax), receivedTotal: dec(receivedTotal),
      invoiceAmount: input.invoiceAmount ?? null, variance: v?.variance ?? null,
    },
    ...ctx,
  });

  // Stock just went up. The alerts screen, the reorder list and the admin
  // pharmacy tab were all computed against the shelf as it was a minute ago.
  await publishLive([TOPICS.PHARMACY, TOPICS.ADMIN], EVENTS.STOCK_RECEIVED);

  // The owner's copy. Deliberately not sent to the pharmacy: the pharmacist is
  // the person who just typed this in. Goods received is the moment inventory
  // and money move in opposite directions, and the person who reconciles those
  // is usually not in the building.
  await notifyStockReceived({
    grnNumber: result.grnNumber,
    supplierName: supplier.name,
    value: result.receivedValue,
  });

  return {
    id: result.id,
    grnNumber: result.grnNumber,
    receivedValue: dec(result.receivedValue),
    receivedTax: dec(result.receivedTax),
    receivedTotal: dec(receivedTotal),
    variance: v?.variance ?? null,
    mismatch: v?.mismatch ?? false,
    createdMedicines: result.createdMedicines,
  };
}

export async function listGoodsReceipts(filter?: { supplierId?: string; query?: string; days?: number }) {
  const since = filter?.days ? new Date(Date.now() - filter.days * 86400000) : undefined;
  const rows = await prisma.goodsReceipt.findMany({
    where: {
      ...(filter?.supplierId ? { supplierId: filter.supplierId } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(filter?.query
        ? { OR: [
            { grnNumber: { contains: filter.query, mode: "insensitive" as const } },
            { invoiceNo: { contains: filter.query, mode: "insensitive" as const } },
          ] }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, grnNumber: true, invoiceNo: true, invoiceDate: true, invoiceAmount: true,
      receivedValue: true, receivedTax: true, createdAt: true,
      supplier: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      receivedBy: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return rows.map((g) => {
    // Same comparison as the posting path: goods PLUS tax against the bill.
    const receivedTotal = receiptTotal(Number(g.receivedValue.toString()), Number(g.receivedTax.toString()));
    const v = invoiceVariance(g.invoiceAmount ? Number(g.invoiceAmount.toString()) : null, receivedTotal);
    return {
      id: g.id, grnNumber: g.grnNumber, invoiceNo: g.invoiceNo,
      invoiceDate: g.invoiceDate ? iso(g.invoiceDate) : null,
      invoiceAmount: g.invoiceAmount ? g.invoiceAmount.toString() : null,
      receivedValue: g.receivedValue.toString(),
      receivedTax: g.receivedTax.toString(),
      receivedTotal: receivedTotal.toFixed(2),
      variance: v?.variance ?? null,
      mismatch: v?.mismatch ?? false,
      createdAt: g.createdAt.toISOString(),
      supplierId: g.supplier.id, supplierName: g.supplier.name,
      poId: g.purchaseOrder?.id ?? null, poNumber: g.purchaseOrder?.poNumber ?? null,
      receivedByName: g.receivedBy.name,
      lines: g._count.items,
    };
  });
}

export async function goodsReceiptDetail(id: string) {
  const g = await prisma.goodsReceipt.findUnique({
    where: { id },
    select: {
      id: true, grnNumber: true, invoiceNo: true, invoiceDate: true, invoiceAmount: true,
      receivedValue: true, receivedTax: true, notes: true, createdAt: true,
      supplier: { select: { id: true, name: true, gstin: true, drugLicenseNo: true, phone: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      receivedBy: { select: { name: true } },
      items: {
        select: {
          id: true, batchNo: true, expiryDate: true, qty: true, freeQty: true, unitCost: true, mrp: true,
          gstRatePct: true,
          medicine: { select: { id: true, name: true, unit: true } },
          batchId: true,
          // The correction screen needs to know what the shelf currently holds
          // and what it is allowed to change: a pack size cannot move once the
          // batch has been billed, and an identity cannot move once anything
          // else references it. Answering that here means the screen can grey
          // the field out rather than letting a pharmacist type a correction
          // the server is going to reject.
          batch: {
            select: {
              id: true, quantity: true, packSize: true, pack: true,
              _count: { select: { invoiceItems: true, grnItems: true, returnItems: true } },
            },
          },
        },
      },
    },
  });
  if (!g) throw new ApiError(404, "Goods receipt not found");

  // Same comparison as the posting path and the list: goods PLUS tax against
  // the bill. Three call sites, one rule - they must not drift apart.
  const receivedTotal = receiptTotal(Number(g.receivedValue.toString()), Number(g.receivedTax.toString()));
  const v = invoiceVariance(g.invoiceAmount ? Number(g.invoiceAmount.toString()) : null, receivedTotal);

  return {
    id: g.id, grnNumber: g.grnNumber, invoiceNo: g.invoiceNo,
    invoiceDate: g.invoiceDate ? iso(g.invoiceDate) : null,
    invoiceAmount: g.invoiceAmount ? g.invoiceAmount.toString() : null,
    receivedValue: g.receivedValue.toString(),
    receivedTax: g.receivedTax.toString(),
    receivedTotal: receivedTotal.toFixed(2),
    variance: v?.variance ?? null,
    mismatch: v?.mismatch ?? false,
    notes: g.notes,
    createdAt: g.createdAt.toISOString(),
    supplier: g.supplier,
    poId: g.purchaseOrder?.id ?? null, poNumber: g.purchaseOrder?.poNumber ?? null,
    receivedByName: g.receivedBy.name,
    items: g.items.map((i) => {
      const cost = Number(i.unitCost.toString());
      const mrp = Number(i.mrp.toString());
      const landed = effectiveUnitCost(i.qty, i.freeQty, cost);
      return {
        id: i.id, batchId: i.batchId,
        medicineId: i.medicine.id, name: i.medicine.name, unit: i.medicine.unit,
        batchNo: i.batchNo, expiryDate: iso(i.expiryDate),
        qty: i.qty, freeQty: i.freeQty,
        unitCost: i.unitCost.toString(),
        landedCost: dec(landed),
        mrp: i.mrp.toString(),
        lineValue: dec(lineValue(i.qty, cost)),
        gstRatePct: i.gstRatePct.toString(),
        lineTax: dec(lineTax(i.qty, cost, Number(i.gstRatePct.toString()))),
        marginPct: mrp > 0 ? Math.round(((mrp - landed) / mrp) * 1000) / 10 : null,
        pack: i.batch?.pack ?? null,
        packSize: i.batch?.packSize ?? 1,
        onShelf: i.batch?.quantity ?? null,
        /** Units this line put on the shelf - what a correction moves. */
        unitsReceived: i.batch ? packsToUnits(i.qty + i.freeQty, i.batch.packSize) : null,
        /** Billed already: the pack size is load-bearing for issued invoices. */
        billed: (i.batch?._count.invoiceItems ?? 0) > 0,
        /** Anything else references this batch, so its identity is pinned. */
        identityPinned:
          (i.batch?._count.grnItems ?? 0) > 1 ||
          (i.batch?._count.invoiceItems ?? 0) > 0 ||
          (i.batch?._count.returnItems ?? 0) > 0,
      };
    }),
  };
}

// ===========================================================================
// Purchase returns - stock going back up the chain
// ===========================================================================

/**
 * Send stock back to the distributor.
 *
 * The stock page already offered "Returned to supplier" as a write-off reason,
 * which dropped the shelf count and told nobody. That is a straight loss of
 * money the hospital is owed - near-expiry credit is a routine and material
 * part of pharmacy economics. This decrements the batch AND raises a claim that
 * can be chased until the credit note lands.
 */
export async function createPurchaseReturn(
  actor: AuthUser,
  input: {
    supplierId: string;
    reason: string;
    notes?: string;
    send?: boolean;
    items: { batchId: string; qty: number }[];
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ id: string; returnNo: string; claimValue: string }> {
  if (!input.items.length) throw new ApiError(400, "Nothing to return");

  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true } });
  if (!supplier) throw new ApiError(404, "Supplier not found");

  const result = await prisma.$transaction(async (tx) => {
    const returnNo = await nextId("PRETURN", { tx });
    let claimValue = 0;

    const ret = await tx.purchaseReturn.create({
      data: {
        returnNo,
        supplierId: input.supplierId,
        status: input.send ? "SENT" : "DRAFT",
        sentAt: input.send ? new Date() : null,
        reason: input.reason.trim(),
        notes: input.notes?.trim() || null,
        createdById: actor.id,
      },
      select: { id: true, returnNo: true },
    });

    for (const it of input.items) {
      if (it.qty <= 0) throw new ApiError(400, "Return quantity must be at least 1");

      const batch = await tx.stockBatch.findUnique({
        where: { id: it.batchId },
        select: { id: true, batchNo: true, quantity: true, purchasePrice: true, medicineId: true, medicine: { select: { name: true } } },
      });
      if (!batch) throw new ApiError(404, "Batch not found");
      if (batch.quantity < it.qty) {
        throw new ApiError(400, `Batch ${batch.batchNo} of ${batch.medicine.name} has only ${batch.quantity} on the shelf - you can't return ${it.qty}`);
      }

      // Claim at what we paid. A batch with no recorded rate claims nothing
      // rather than guessing from MRP - inventing a number here is how a
      // credit note gets disputed.
      const unitCost = batch.purchasePrice != null ? Number(batch.purchasePrice.toString()) : 0;

      await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity: { decrement: it.qty } } });
      await tx.stockTransaction.create({
        data: {
          batchId: batch.id, type: "PURCHASE_RETURN", qty: -it.qty,
          refId: ret.returnNo,
          reason: `Returned to ${supplier.name} · ${input.reason.trim()}`,
          performedById: actor.id,
        },
      });
      await tx.purchaseReturnItem.create({
        data: {
          purchaseReturnId: ret.id,
          medicineId: batch.medicineId,
          batchId: batch.id,
          batchNo: batch.batchNo,
          qty: it.qty,
          unitCost: dec(unitCost),
        },
      });

      claimValue = round2(claimValue + lineValue(it.qty, unitCost));
    }

    await tx.purchaseReturn.update({ where: { id: ret.id }, data: { claimValue: dec(claimValue) } });
    return { id: ret.id, returnNo: ret.returnNo, claimValue };
  });

  await logAudit(actor, {
    action: "PURCHASE_RETURN_RAISED", targetTable: "PurchaseReturn", targetId: result.id,
    meta: { returnNo: result.returnNo, supplier: supplier.name, lines: input.items.length, claimValue: dec(result.claimValue), reason: input.reason },
    ...ctx,
  });

  return { id: result.id, returnNo: result.returnNo, claimValue: dec(result.claimValue) };
}

/** Move a return along: sent to the distributor, credited, or refused. */
export async function updatePurchaseReturnStatus(
  actor: AuthUser,
  input: { id: string; status: "SENT" | "CREDITED" | "REJECTED"; creditNoteNo?: string; creditedAmount?: number; notes?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const ret = await prisma.purchaseReturn.findUnique({ where: { id: input.id }, select: { id: true, returnNo: true, status: true, claimValue: true } });
  if (!ret) throw new ApiError(404, "Purchase return not found");
  if (ret.status === "CREDITED") throw new ApiError(400, `${ret.returnNo} has already been credited`);
  if (input.status === "CREDITED" && input.creditedAmount === undefined) {
    throw new ApiError(400, "Record how much the distributor actually credited");
  }

  await prisma.purchaseReturn.update({
    where: { id: input.id },
    data: {
      status: input.status,
      ...(input.status === "SENT" ? { sentAt: new Date() } : {}),
      ...(input.status === "CREDITED"
        ? {
            settledAt: new Date(),
            creditNoteNo: input.creditNoteNo?.trim() || null,
            creditedAmount: dec(input.creditedAmount!),
          }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
    },
  });

  await logAudit(actor, {
    action: `PURCHASE_RETURN_${input.status}`, targetTable: "PurchaseReturn", targetId: input.id,
    meta: {
      returnNo: ret.returnNo,
      claimValue: ret.claimValue.toString(),
      creditedAmount: input.creditedAmount ?? null,
      creditNoteNo: input.creditNoteNo ?? null,
    },
    ...ctx,
  });
}

export async function listPurchaseReturns(filter?: { status?: string; supplierId?: string }) {
  const rows = await prisma.purchaseReturn.findMany({
    where: {
      ...(filter?.status && filter.status !== "ALL"
        ? { status: filter.status as Prisma.EnumPurchaseReturnStatusFilter["equals"] }
        : {}),
      ...(filter?.supplierId ? { supplierId: filter.supplierId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, returnNo: true, status: true, reason: true, claimValue: true, creditedAmount: true,
      creditNoteNo: true, createdAt: true, sentAt: true, settledAt: true,
      supplier: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      items: {
        select: { qty: true, batchNo: true, medicine: { select: { name: true, unit: true } } },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id, returnNo: r.returnNo, status: r.status, reason: r.reason,
    claimValue: r.claimValue.toString(),
    creditedAmount: r.creditedAmount ? r.creditedAmount.toString() : null,
    creditNoteNo: r.creditNoteNo,
    /** What the distributor knocked off the claim. Amber money. */
    shortfall: r.creditedAmount
      ? dec(round2(Number(r.claimValue.toString()) - Number(r.creditedAmount.toString())))
      : null,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    settledAt: r.settledAt ? r.settledAt.toISOString() : null,
    supplierId: r.supplier.id, supplierName: r.supplier.name,
    createdByName: r.createdBy.name,
    items: r.items.map((i) => ({ name: i.medicine.name, unit: i.medicine.unit, batchNo: i.batchNo, qty: i.qty })),
  }));
}

// ===========================================================================
// Dashboard
// ===========================================================================

/** The five numbers a pharmacy manager opens the procurement screen to see. */
export async function procurementStats(): Promise<{
  openOrders: number; overdueOrders: number; onOrderValue: string;
  reorderLines: number; outOfStockLines: number;
  receiptsThisMonth: number; purchaseValueThisMonth: string;
  creditOutstanding: string; suppliers: number;
  invoiceMismatches: number;
}> {
  const today = today0();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [openPos, monthReceipts, openReturns, suppliers, reorder] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } },
      select: { totalAmount: true, expectedDate: true, status: true },
    }),
    prisma.goodsReceipt.findMany({
      where: { createdAt: { gte: monthStart } },
      select: { receivedValue: true, receivedTax: true, invoiceAmount: true },
    }),
    prisma.purchaseReturn.findMany({
      where: { status: "SENT" },
      select: { claimValue: true },
    }),
    prisma.supplier.count({ where: { active: true } }),
    reorderSuggestions(),
  ]);

  const onOrderValue = openPos.reduce((t, p) => round2(t + Number(p.totalAmount.toString())), 0);
  const overdueOrders = openPos.filter(
    (p) => (p.status === "SENT" || p.status === "PARTIALLY_RECEIVED") && p.expectedDate && p.expectedDate < today
  ).length;

  const purchaseValueThisMonth = monthReceipts.reduce((t, g) => round2(t + Number(g.receivedValue.toString())), 0);
  // The dashboard's mismatch COUNT has to use the same rule as the screens it
  // sends people to. Counting on goods value alone made this tile report every
  // taxable delivery of the month as a query to chase.
  const invoiceMismatches = monthReceipts.filter((g) => {
    const total = receiptTotal(Number(g.receivedValue.toString()), Number(g.receivedTax.toString()));
    const v = invoiceVariance(g.invoiceAmount ? Number(g.invoiceAmount.toString()) : null, total);
    return v?.mismatch ?? false;
  }).length;

  const creditOutstanding = openReturns.reduce((t, r) => round2(t + Number(r.claimValue.toString())), 0);
  const allLines = reorder.suppliers.flatMap((s) => s.lines);

  return {
    openOrders: openPos.length,
    overdueOrders,
    onOrderValue: dec(onOrderValue),
    reorderLines: allLines.length,
    outOfStockLines: allLines.filter((l) => l.outOfStock).length,
    receiptsThisMonth: monthReceipts.length,
    purchaseValueThisMonth: dec(purchaseValueThisMonth),
    creditOutstanding: dec(creditOutstanding),
    suppliers,
    invoiceMismatches,
  };
}

// ===========================================================================
// Correcting a receipt already posted
// ===========================================================================

export interface GrnCorrectionLine {
  id: string;
  batchNo?: string;
  expiryDate?: string;
  qty?: number;
  freeQty?: number;
  unitCost?: number;
  mrp?: number;
  pack?: string;
  packSize?: number;
}

/**
 * CROSS-CHECK A DELIVERY AGAINST THE PAPER BILL, THEN FIX WHAT WAS TYPED WRONG.
 *
 * Receiving happens with a delivery man waiting and a phone ringing. The
 * quantity comes off the wrong row of a fifteen-line invoice; the free-goods
 * column is missed; a pack label is read as "157" instead of "15T". None of
 * these are noticed at the counter - they are noticed an hour later with the
 * invoice flat on the desk. Until now the only repair was an adjustment on the
 * stock page, which moved the shelf and left the receipt still claiming
 * something else. The GRN and the batch then disagreed permanently, and the GRN
 * is the document the supplier gets paid against.
 *
 * So the correction moves both, or neither.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS THE POINT:
 *
 *   - A correction that would push the shelf below zero. The stock has gone
 *     somewhere; saying less arrived does not bring it back.
 *   - A pack-size change on a batch that has already been billed. Those invoice
 *     lines priced their quantity against the old pack size, and re-basing it
 *     underneath them makes issued bills disagree with the shelf. A bill a
 *     family is holding is not something this may quietly contradict.
 *   - A batch number or expiry change on a batch with other history - a second
 *     delivery into it, a sale, a return. That is not a correction; it is
 *     moving an identity under rows that already reference it.
 *
 * The PURCHASE ledger row is never rewritten. The difference is posted as an
 * ADJUSTMENT naming the GRN and carrying the pharmacist's reason, so a year
 * later the batch still shows what arrived, what was corrected, and why.
 */
export async function correctGoodsReceipt(
  actor: AuthUser,
  grnId: string,
  input: {
    invoiceNo?: string;
    invoiceDate?: string;
    invoiceAmount?: number;
    notes?: string;
    reason: string;
    items: GrnCorrectionLine[];
  },
  ctx: { ipAddress?: string; userAgent?: string },
): Promise<{ grnNumber: string; changed: string[] }> {
  const changed: string[] = [];

  const grnNumber = await prisma.$transaction(async (tx) => {
    const grn = await tx.goodsReceipt.findUnique({
      where: { id: grnId },
      select: {
        id: true, grnNumber: true, supplierId: true,
        items: {
          select: {
            id: true, batchId: true, batchNo: true, expiryDate: true, qty: true, freeQty: true,
            unitCost: true, mrp: true, gstRatePct: true,
            medicine: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!grn) throw new ApiError(404, "Goods receipt not found");

    for (const edit of input.items) {
      const line = grn.items.find((i) => i.id === edit.id);
      if (!line) throw new ApiError(404, `That line is not on ${grn.grnNumber}`);

      const batch = line.batchId
        ? await tx.stockBatch.findUnique({
            where: { id: line.batchId },
            select: {
              id: true, quantity: true, packSize: true, batchNo: true, expiryDate: true,
              _count: { select: { invoiceItems: true, grnItems: true, returnItems: true } },
            },
          })
        : null;

      const oldPackSize = batch?.packSize ?? 1;
      const newPackSize = Math.max(1, Math.floor(
        edit.packSize ?? (edit.pack !== undefined ? parsePack(edit.pack).size : oldPackSize),
      ));
      const newQty = edit.qty ?? line.qty;
      const newFree = edit.freeQty ?? line.freeQty;
      const newCost = edit.unitCost ?? Number(line.unitCost.toString());
      const newMrp = edit.mrp ?? Number(line.mrp.toString());

      const oldUnits = packsToUnits(line.qty + line.freeQty, oldPackSize);
      const newUnits = packsToUnits(newQty + newFree, newPackSize);
      const delta = newUnits - oldUnits;

      if (batch) {
        if (newPackSize !== oldPackSize && batch._count.invoiceItems > 0) {
          throw new ApiError(
            409,
            `${line.medicine.name} has already been billed from batch ${batch.batchNo}. Changing the pack size now would re-price those bills. Correct the bills first, or adjust the shelf on the stock page.`,
          );
        }

        const wantsIdentityChange =
          (edit.batchNo !== undefined && edit.batchNo.trim() !== batch.batchNo) ||
          (edit.expiryDate !== undefined && iso(asDate(edit.expiryDate)) !== iso(batch.expiryDate));

        if (wantsIdentityChange) {
          const soleSource =
            batch._count.grnItems <= 1 && batch._count.invoiceItems === 0 && batch._count.returnItems === 0;
          if (!soleSource) {
            throw new ApiError(
              409,
              `Batch ${batch.batchNo} of ${line.medicine.name} has other history - another delivery, a sale or a return references it. A batch number or expiry cannot be moved underneath those. Reverse this line and receive it again.`,
            );
          }
          if (edit.expiryDate !== undefined) {
            // The rule the receive path enforces: one batch number, one expiry.
            const elsewhere = await tx.stockBatch.findFirst({
              where: {
                medicineId: line.medicine.id,
                batchNo: edit.batchNo?.trim() ?? batch.batchNo,
                id: { not: batch.id },
              },
              select: { expiryDate: true, supplier: { select: { name: true } } },
            });
            if (elsewhere && iso(elsewhere.expiryDate) !== iso(asDate(edit.expiryDate))) {
              throw new ApiError(
                400,
                `That batch number is already on the shelf from ${elsewhere.supplier.name} expiring ${iso(elsewhere.expiryDate)}. Same batch number, two expiry dates - check the strip.`,
              );
            }
          }
        }

        const nextQuantity = batch.quantity + delta;
        if (nextQuantity < 0) {
          throw new ApiError(
            409,
            `${line.medicine.name} would go to ${nextQuantity} on the shelf - ${Math.abs(delta)} fewer units than there are. The stock has already moved, so adjust it on the stock page and say where it went.`,
          );
        }

        await tx.stockBatch.update({
          where: { id: batch.id },
          data: {
            quantity: nextQuantity,
            packSize: newPackSize,
            freeQty: packsToUnits(newFree, newPackSize),
            mrp: dec(newMrp),
            purchasePrice: dec(effectiveUnitCost(newQty, newFree, newCost)),
            ...(edit.pack !== undefined ? { pack: edit.pack.trim() || null } : {}),
            ...(edit.batchNo !== undefined ? { batchNo: edit.batchNo.trim() } : {}),
            ...(edit.expiryDate !== undefined ? { expiryDate: asDate(edit.expiryDate) } : {}),
          },
        });

        // The shelf moved, so the ledger says so - in its own row, beside the
        // receipt it corrects, never by editing that receipt.
        if (delta !== 0) {
          await tx.stockTransaction.create({
            data: {
              batchId: batch.id,
              type: "ADJUSTMENT",
              qty: delta,
              refId: grn.grnNumber,
              reason: `${grn.grnNumber} corrected: ${oldUnits} to ${newUnits} units (${line.qty}+${line.freeQty} x ${oldPackSize} became ${newQty}+${newFree} x ${newPackSize}). ${input.reason.trim()}`,
              performedById: actor.id,
            },
          });
        }
      }

      await tx.goodsReceiptItem.update({
        where: { id: line.id },
        data: {
          qty: newQty,
          freeQty: newFree,
          unitCost: dec(newCost),
          mrp: dec(newMrp),
          ...(edit.batchNo !== undefined ? { batchNo: edit.batchNo.trim() } : {}),
          ...(edit.expiryDate !== undefined ? { expiryDate: asDate(edit.expiryDate) } : {}),
        },
      });

      if (delta !== 0
        || newCost !== Number(line.unitCost.toString())
        || newMrp !== Number(line.mrp.toString())) {
        changed.push(
          `${line.medicine.name}: ${line.qty}+${line.freeQty} to ${newQty}+${newFree}`
          + (delta ? ` (${delta > 0 ? "+" : ""}${delta} on the shelf)` : ""),
        );
      }
    }

    // The receipt's totals are DERIVED, so they are recomputed from what the
    // lines now say rather than patched. A total that drifts from its own lines
    // is what makes a supplier's ledger unarguable.
    const after = await tx.goodsReceiptItem.findMany({
      where: { goodsReceiptId: grn.id },
      select: { qty: true, unitCost: true, gstRatePct: true },
    });
    const value = after.reduce((s, i) => s + lineValue(i.qty, Number(i.unitCost.toString())), 0);
    const tax = after.reduce(
      (s, i) => s + lineTax(i.qty, Number(i.unitCost.toString()), Number(i.gstRatePct.toString())),
      0,
    );

    await tx.goodsReceipt.update({
      where: { id: grn.id },
      data: {
        receivedValue: dec(value),
        receivedTax: dec(tax),
        ...(input.invoiceNo !== undefined ? { invoiceNo: input.invoiceNo.trim() || null } : {}),
        ...(input.invoiceDate !== undefined ? { invoiceDate: asDate(input.invoiceDate) } : {}),
        ...(input.invoiceAmount !== undefined ? { invoiceAmount: dec(input.invoiceAmount) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
      },
    });

    return grn.grnNumber;
  });

  await logAudit(actor, {
    action: "GRN_CORRECTED",
    targetTable: "GoodsReceipt",
    targetId: grnId,
    meta: { grnNumber, reason: input.reason.trim(), changed },
    ...ctx,
  });
  await publishLive([TOPICS.PHARMACY, TOPICS.ADMIN], EVENTS.STOCK_CHANGED);
  return { grnNumber, changed };
}
