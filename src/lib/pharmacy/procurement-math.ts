/**
 * Procurement arithmetic - pure, no Prisma, no React.
 *
 * The inbound side of the pharmacy has exactly two sums that must be right, and
 * both of them are quietly wrong in most small-hospital systems:
 *
 *   1. What a unit actually COST us, once free goods are counted.
 *   2. How much to reorder, so the shelf comes back up to cover rather than to
 *      one box above the panic line.
 *
 * They live here so they can be tested without a database.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The landed cost of ONE unit, after free goods.
 *
 * Indian distribution runs on schemes: "10+1", "20+3". If you record the
 * invoice rate as the cost, every free unit shows up as pure margin on the day
 * it's sold and the real margin is overstated for the whole batch. 10 strips at
 * ₹100 with 1 free is 11 strips for ₹1000 - ₹90.91 each, not ₹100.
 *
 * This is the number that goes on StockBatch.purchasePrice, because that is
 * what every profit figure in the pharmacy is computed against.
 */
export function effectiveUnitCost(qty: number, freeQty: number, unitCost: number): number {
  const total = qty + freeQty;
  if (total <= 0) return 0;
  return round2((qty * unitCost) / total);
}

/** Invoice value of a line: free goods are free, so they don't count. */
export function lineValue(qty: number, unitCost: number): number {
  return round2(qty * unitCost);
}

/** Tax on a purchase line, at the supplier's rate. */
export function lineTax(qty: number, unitCost: number, gstRatePct: number): number {
  return round2((qty * unitCost * gstRatePct) / 100);
}

export interface OrderTotals {
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
}

/** Purchase-order totals at quoted rates. Indicative until the GRN lands. */
export function orderTotals(
  lines: { qtyOrdered: number; unitCost: number; gstRatePct?: number }[]
): OrderTotals {
  let subtotal = 0;
  let taxAmount = 0;
  for (const l of lines) {
    subtotal = round2(subtotal + lineValue(l.qtyOrdered, l.unitCost));
    taxAmount = round2(taxAmount + lineTax(l.qtyOrdered, l.unitCost, l.gstRatePct ?? 0));
  }
  return { subtotal, taxAmount, totalAmount: round2(subtotal + taxAmount) };
}

/**
 * How much to buy to bring a medicine back to cover.
 *
 * Ordering "up to the threshold" is the classic mistake - it lands you back on
 * the reorder line the same week and you order again. The target is a month's
 * cover: an explicit `reorderQty` when the pharmacist has set one, otherwise
 * 3x the threshold, which is what the stock meter already draws as "comfortable".
 *
 * Anything already on an unreceived purchase order is subtracted, so opening the
 * reorder screen twice before the delivery arrives doesn't order it twice.
 */
export function suggestedOrderQty(args: {
  inStock: number;
  reorderThreshold: number;
  reorderQty?: number | null;
  /** Units already ordered and not yet received. */
  onOrder?: number;
}): number {
  const target = args.reorderQty && args.reorderQty > 0
    ? args.reorderQty
    : Math.max(1, args.reorderThreshold * 3);
  const have = args.inStock + (args.onOrder ?? 0);
  return Math.max(0, target - have);
}

/**
 * Days of cover left at the observed burn rate. Null when nothing has moved -
 * a medicine nobody has dispensed has no meaningful run-out date, and inventing
 * one would put fiction on a screen a pharmacist trusts.
 */
export function daysOfCover(inStock: number, dispensedPerDay: number): number | null {
  if (dispensedPerDay <= 0) return null;
  return Math.floor(inStock / dispensedPerDay);
}

/**
 * Does the supplier's invoice agree with what came out of the carton?
 *
 * A tolerance exists because rounding on a 12-line invoice legitimately drifts a
 * rupee or two. Anything past that is a short supply, a rate change nobody
 * agreed to, or a keying error - all three of which cost money and all three of
 * which are invisible unless someone subtracts.
 */
export function invoiceVariance(
  invoiceAmount: number | null | undefined,
  receivedValue: number,
  tolerance = 1
): { variance: number; mismatch: boolean } | null {
  if (invoiceAmount == null) return null;
  const variance = round2(invoiceAmount - receivedValue);
  return { variance, mismatch: Math.abs(variance) > tolerance };
}
