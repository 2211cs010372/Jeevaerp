import { prisma } from "@/lib/prisma";
import { r2 } from "@/server/billing/calc";
import { localDateISO } from "@/lib/date";
import { perUnitPrice } from "@/lib/pharmacy/pack";
import { resolveMaster, type MasterSource } from "@/lib/pharmacy/masters";
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

// ---------------------------------------------------------------------------
// THE SAME SALES, GROUPED BY WHAT THE PRODUCT *IS*
//
// "What actually sells" answers it per product, which is the right question for
// a shelf and the wrong one for a decision. An owner deciding what to stock,
// which company to negotiate with, or what to file a GST return against is
// asking about a GROUP - and until now nothing in the system could add a group
// up.
//
// The awkward part is that master data is half-migrated by design (see
// lib/pharmacy/masters): every descriptor exists as a master link AND as the
// free-text column it replaces, and most products are still on the text. A
// report that grouped only by linked masters would quietly omit most of the
// pharmacy's revenue and still look plausible, which is the worst way for a
// report to be wrong. So every dimension resolves master -> legacy text ->
// UNCLASSIFIED, and the unclassified bucket is a real row with a real total.
// The groups always add back up to the window's revenue.
// ---------------------------------------------------------------------------

/** The product attributes worth totalling sales against. */
export const SALES_DIMENSIONS = ["category", "generic", "manufacturer", "hsn"] as const;
export type SalesDimension = (typeof SALES_DIMENSIONS)[number];

export const SALES_DIMENSION_META: Record<
  SalesDimension,
  { label: string; blurb: string }
> = {
  category: {
    label: "Category",
    blurb: "Therapeutic or shelf grouping - what kind of medicine earns the counter its money.",
  },
  generic: {
    label: "Generic / salt",
    blurb: "What is actually in the product. Two brands of the same salt add up here as one line.",
  },
  manufacturer: {
    label: "Manufacturer",
    blurb: "Who makes it, not who supplies it. This is the number to take into a distributor negotiation.",
  },
  hsn: {
    label: "HSN code",
    blurb:
      "Grouped by the HSN and GST rate ACTUALLY BILLED on each line, not by the product's master today - a tax document cannot be rewritten by a later edit to the catalogue.",
  },
};

export interface MasterGroup {
  /** Stable identity for the row. Not an id - groups can come from free text. */
  key: string;
  name: string;
  /**
   * Where the label came from. The screens use this to show how much of the
   * catalogue is still on free text, because "what is left to link" is the only
   * question that makes the changeover finishable.
   */
  source: MasterSource;
  /** Dispensing units sold - tablets, ml. Not packs. */
  units: number;
  revenue: number;
  profit: number;
  /** Null when no line in this group had a costed batch. */
  marginPct: number | null;
  /** Distinct products that sold under this group. */
  products: number;
  /**
   * HSN only: the distinct GST rates actually billed under this code, sorted.
   * More than one is not a rounding artefact - it means the same classification
   * went out at two rates, which is a filing problem somebody has to resolve.
   * Empty for every other dimension.
   */
  rates: number[];
}

/**
 * Revenue, profit and volume for the last `days` days of pharmacy sales, in one
 * pass. Costed against the batch each line actually came from, so the margin is
 * the real one and not an average applied after the fact.
 */
async function salesAnalytics(days: number): Promise<{
  trend: PharmacyTrendPoint[];
  movers: MedicineMover[];
  byMaster: Record<SalesDimension, MasterGroup[]>;
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
      // Snapshotted on the line at the moment of sale. For the HSN breakdown
      // these BEAT the medicine's masters, deliberately - see the dimension's
      // blurb. What went on the tax invoice is what the return is filed on.
      hsnSac: true, gstRatePct: true,
      // A pharmacy line's medicine is reached through the batch it came out of -
      // there is no direct medicineId on the line, and the batch is also where
      // the true cost of THAT delivery lives.
      batch: {
        select: {
          purchasePrice: true, packSize: true,
          // Both sides of every descriptor: the master link and the free-text
          // column it supersedes. One extra join layer on a query that was
          // already being run, rather than a second pass over the same sales.
          medicine: {
            select: {
              id: true, name: true,
              category: { select: { name: true } },
              generic: { select: { name: true } },
              genericName: true,
              manufacturerRef: { select: { name: true } },
              manufacturer: true,
              hsn: { select: { code: true } },
              hsnCode: true,
            },
          },
        },
      },
      invoice: { select: { id: true, createdAt: true } },
    },
  });

  type Med = {
    id: string; name: string;
    category: { name: string } | null;
    generic: { name: string } | null;
    genericName: string | null;
    manufacturerRef: { name: string } | null;
    manufacturer: string | null;
    hsn: { code: string } | null;
    hsnCode: string | null;
  };
  type It = {
    description: string; qty: number;
    unitPrice: { toString(): string }; amount: { toString(): string };
    hsnSac: string | null; gstRatePct: { toString(): string };
    batch: {
      purchasePrice: { toString(): string } | null;
      packSize: number;
      medicine: Med | null;
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

  /**
   * How each dimension reads a sold line.
   *
   * Everything goes through resolveMaster so the master/legacy precedence is the
   * one written down once in lib/pharmacy/masters, not re-guessed here. HSN is
   * the exception that proves it: the line's own snapshotted hsnSac wins over
   * both, because the report is about what was billed, not about what the
   * catalogue says today.
   */
  const DIMENSION_OF: Record<SalesDimension, (it: It, med: Med | null) => { value: string | null; source: MasterSource }> = {
    category: (_it, med) => resolveMaster(med?.category?.name, null),
    generic: (_it, med) => resolveMaster(med?.generic?.name, med?.genericName),
    manufacturer: (_it, med) => resolveMaster(med?.manufacturerRef?.name, med?.manufacturer),
    hsn: (it, med) => {
      const billed = (it.hsnSac ?? "").trim();
      if (billed) return { value: billed, source: "master" };
      return resolveMaster(med?.hsn?.code, med?.hsnCode);
    },
  };

  type GroupAcc = Omit<MasterGroup, "rates"> & { costedRevenue: number; productKeys: Set<string>; rateSet: Set<number> };
  const masterAcc: Record<SalesDimension, Map<string, GroupAcc>> = {
    category: new Map(), generic: new Map(), manufacturer: new Map(), hsn: new Map(),
  };

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

    // The same line, totalled against what the product IS. Every dimension gets
    // a row for this line - an unresolvable one lands in UNCLASSIFIED rather
    // than being skipped, which is what keeps each dimension adding back up to
    // windowRevenue.
    const rate = Number(it.gstRatePct.toString());
    for (const dim of SALES_DIMENSIONS) {
      const { value, source } = DIMENSION_OF[dim](it, med);
      const gkey = value ?? " unclassified";
      const g = masterAcc[dim].get(gkey) ?? {
        key: gkey,
        name: value ?? "Unclassified",
        source,
        units: 0, revenue: 0, profit: 0, marginPct: null, products: 0,
        costedRevenue: 0, productKeys: new Set<string>(), rateSet: new Set<number>(),
      };
      g.units += it.qty;
      g.revenue = r2(g.revenue + line);
      g.profit = r2(g.profit + profit);
      g.costedRevenue = r2(g.costedRevenue + costedRevenue);
      g.productKeys.add(mkey);
      if (dim === "hsn") g.rateSet.add(rate);
      masterAcc[dim].set(gkey, g);
    }
  }

  const movers = [...moverAcc.values()]
    .map(({ costedRevenue, ...m }) => ({
      ...m,
      marginPct: costedRevenue > 0 ? Math.round((m.profit / costedRevenue) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 15);

  // Not sliced, unlike movers. A group list that silently dropped its tail would
  // stop summing to the window total, and the whole point of the unclassified
  // bucket is that this report reconciles.
  const byMaster = Object.fromEntries(
    SALES_DIMENSIONS.map((dim) => [
      dim,
      [...masterAcc[dim].values()]
        .map(({ costedRevenue, productKeys, rateSet, ...g }): MasterGroup => ({
          ...g,
          products: productKeys.size,
          marginPct: costedRevenue > 0 ? Math.round((g.profit / costedRevenue) * 1000) / 10 : null,
          rates: [...rateSet].sort((a, b) => a - b),
        }))
        // Unclassified sorts last however big it is - it is a gap in the
        // catalogue, not the pharmacy's best-selling category.
        .sort((a, b) =>
          (a.source === "none" ? 1 : 0) - (b.source === "none" ? 1 : 0) || b.revenue - a.revenue
        ),
    ])
  ) as Record<SalesDimension, MasterGroup[]>;

  return {
    trend: [...dayAcc].map(([date, v]) => ({ date, revenue: v.revenue, profit: v.profit, bills: v.bills.size })),
    movers,
    byMaster,
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
    byMaster: sales.byMaster,
    window: sales.window,
  };
}

export type PharmacyOverview = Awaited<ReturnType<typeof pharmacyOverview>>;
