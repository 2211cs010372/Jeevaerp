import { prisma } from "@/lib/prisma";
import { r2 } from "@/server/billing/calc";
import { localDateISO } from "@/lib/date";
import { perUnitPrice } from "@/lib/pharmacy/pack";
import { pharmacyStats, stockAlerts, pharmacyDues } from "./pharmacy.service";
import {
  procurementStats, reorderSuggestions, listGoodsReceipts, listPurchaseOrders,
} from "./procurement.service";

/**
 * THE PHARMACY, SEEN FROM THE OWNER'S CHAIR.
 *
 * The pharmacist has eight screens because they act on eight different things.
 * The owner has one question - "is the pharmacy healthy, and is anything about
 * to bite me" - and needs the answer without walking the counter's whole nav.
 *
 * This composes what already exists rather than re-querying it. Every number here
 * is produced by the same function that produces it in the pharmacy portal, so
 * the two screens cannot disagree - a management report that quietly computes
 * stock value its own way is how two departments end up with two truths.
 *
 * The only genuinely new work is the trend and the movers: what the counter earns
 * over time and what actually sells, which nothing in the system answered before.
 */

export interface PharmacyTrendPoint {
  date: string;
  revenue: number;
  /** MRP − purchase rate on lines whose batch has a known cost. */
  profit: number;
  bills: number;
}

export interface MedicineMover {
  medicineId: string | null;
  name: string;
  /** Dispensing units sold - tablets, ml. Not packs. */
  units: number;
  revenue: number;
  profit: number;
  /** Null when no line in the window had a costed batch. */
  marginPct: number | null;
}

/**
 * Revenue, profit and volume for the last `days` days of pharmacy sales, in one
 * pass. Costed against the batch each line actually came from, so the margin is
 * the real one and not an average applied after the fact.
 */
async function salesAnalytics(days: number): Promise<{
  trend: PharmacyTrendPoint[];
  movers: MedicineMover[];
  window: { revenue: number; profit: number; marginPct: number | null; bills: number; units: number };
}> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = new Date(today); from.setDate(today.getDate() - (days - 1));

  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: { source: "PHARMACY", status: { not: "CANCELLED" }, createdAt: { gte: from } },
    },
    select: {
      description: true, qty: true, unitPrice: true, amount: true,
      // A pharmacy line's medicine is reached through the batch it came out of -
      // there is no direct medicineId on the line, and the batch is also where
      // the true cost of THAT delivery lives.
      batch: { select: { purchasePrice: true, packSize: true, medicine: { select: { id: true, name: true } } } },
      invoice: { select: { id: true, createdAt: true } },
    },
  });

  type It = {
    description: string; qty: number;
    unitPrice: { toString(): string }; amount: { toString(): string };
    batch: {
      purchasePrice: { toString(): string } | null;
      packSize: number;
      medicine: { id: string; name: string } | null;
    } | null;
    invoice: { id: string; createdAt: Date };
  };

  const dayAcc = new Map<string, { revenue: number; profit: number; bills: Set<string> }>();
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(today); day.setDate(today.getDate() - d);
    dayAcc.set(localDateISO(day), { revenue: 0, profit: 0, bills: new Set() });
  }

  const moverAcc = new Map<string, MedicineMover & { costedRevenue: number }>();
  let windowRevenue = 0, windowProfit = 0, windowCosted = 0, windowUnits = 0;
  const windowBills = new Set<string>();

  for (const it of items as It[]) {
    // A bill raised at 10 PM belongs to that evening, not to UTC tomorrow.
    const key = localDateISO(it.invoice.createdAt);
    const line = r2(Number(it.amount.toString()));
    // unitPrice is PER TABLET; purchasePrice is PER STRIP. Both sides of the
    // subtraction have to be in the same unit or the margin is nonsense.
    const cost = it.batch?.purchasePrice;
    const costPerUnit = cost == null ? null : perUnitPrice(Number(cost.toString()), it.batch!.packSize);
    const profit = costPerUnit == null ? 0 : r2((Number(it.unitPrice.toString()) - costPerUnit) * it.qty);
    const costedRevenue = costPerUnit == null ? 0 : r2(Number(it.unitPrice.toString()) * it.qty);

    const bucket = dayAcc.get(key);
    if (bucket) {
      bucket.revenue = r2(bucket.revenue + line);
      bucket.profit = r2(bucket.profit + profit);
      bucket.bills.add(it.invoice.id);
    }

    windowRevenue = r2(windowRevenue + line);
    windowProfit = r2(windowProfit + profit);
    windowCosted = r2(windowCosted + costedRevenue);
    windowUnits += it.qty;
    windowBills.add(it.invoice.id);

    // Group by medicine where the line is traceable to a batch; otherwise fall
    // back to the printed description, so a sale billed without a batch link
    // still shows up as itself rather than being silently dropped from "what sells".
    const med = it.batch?.medicine ?? null;
    const label = med?.name ?? it.description.split("·")[0].trim();
    const mkey = med?.id ?? `desc:${label}`;
    const cur = moverAcc.get(mkey) ?? {
      medicineId: med?.id ?? null,
      name: label,
      units: 0, revenue: 0, profit: 0, marginPct: null, costedRevenue: 0,
    };
    cur.units += it.qty;
    cur.revenue = r2(cur.revenue + line);
    cur.profit = r2(cur.profit + profit);
    cur.costedRevenue = r2(cur.costedRevenue + costedRevenue);
    moverAcc.set(mkey, cur);
  }

  const movers = [...moverAcc.values()]
    .map(({ costedRevenue, ...m }) => ({
      ...m,
      marginPct: costedRevenue > 0 ? Math.round((m.profit / costedRevenue) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 15);

  return {
    trend: [...dayAcc].map(([date, v]) => ({ date, revenue: v.revenue, profit: v.profit, bills: v.bills.size })),
    movers,
    window: {
      revenue: windowRevenue,
      profit: windowProfit,
      marginPct: windowCosted > 0 ? Math.round((windowProfit / windowCosted) * 1000) / 10 : null,
      bills: windowBills.size,
      units: windowUnits,
    },
  };
}

export async function pharmacyOverview() {
  const [counter, procurement, alerts, reorder, receipts, purchaseOrders, dues, sales] =
    await Promise.all([
      pharmacyStats(),
      procurementStats(),
      stockAlerts(),
      reorderSuggestions(),
      // "New orders received" - deliveries booked in over the last month.
      listGoodsReceipts({ days: 30 }),
      listPurchaseOrders({ status: "OPEN" }),
      pharmacyDues(),
      salesAnalytics(14),
    ]);

  return {
    counter,
    procurement,
    alerts,
    reorder,
    receipts,
    purchaseOrders,
    dues,
    trend: sales.trend,
    movers: sales.movers,
    window: sales.window,
  };
}

export type PharmacyOverview = Awaited<ReturnType<typeof pharmacyOverview>>;
